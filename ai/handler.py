"""
TrustLens AI service. AWS Lambda entry point: handler.lambda_handler

Node invokes this function with
    {"requestId": "...", "question": "...", "approvedAnswers": [...]}
(approvedAnswers is optional) and gets back the JSON in docs/api-contract.md
(section 1, Node -> Lambda).

What happens for one question:
  1. Embed the question (Titan).
  2. Approved answers: if one of those Node sent matches closely, return its
     wording as is and skip both models. See approved.py.
  3. Retrieve the closest passages from the knowledge-base index.
  4. Model A (ANSWER_MODEL_ID) drafts a reply from those passages only.
  5. Retrieve again using the draft, so the checker also sees passages that
     could contradict it, plus the current version of any outdated passage.
  6. Model B (CHECKER_MODEL_ID) splits the draft into claims, labels each
     one supported, contradicted or insufficient_evidence, and quotes the
     passage words behind each label. The code checks every quote really is
     in a passage: if Model B cited the wrong passage, the citation moves to
     the right one; if the quote is in none, the claim drops to
     insufficient_evidence. If Model A says "I do not have this information",
     Model B is skipped.
  7. Score. A claim is verified only when a current, official passage
     supports it. confidence = verified claims / all claims, or 0 if Model B
     says the draft does not answer the question.
     Check that fixed safety wording was not changed.

Model A is treated as the agent being evaluated: by default it sees passage
text only, not authority or version, the way a plain RAG agent would. Judging
authority and freshness is TrustLens's job (Model B and the scoring).
Set ANSWER_SHOWS_METADATA=true to let Model A see them too.

Settings are environment variables (set on the Lambda, or ai/.env locally).
"""
import itertools
import json
import os
import re
import time
import traceback
from pathlib import Path

import approved
import checks
import llm
import retrieve

PROMPTS = Path(__file__).resolve().parent / "prompts"

CATEGORIES = [
    "applying-eligibility", "card-types-benefits", "fees-charges", "rewards-cashback",
    "payments-billing", "instalments-balance-transfer", "lost-stolen-fraud", "uncategorised",
]
LABELS = {"supported", "contradicted", "insufficient_evidence"}
MAX_QUESTION_CHARS = 2000
MAX_CLAIMS = 15
MAX_ALSO_FOUND = 3  # uncited sources listed after the cited ones
EXCERPT_CHARS = 1200

NO_SOURCE_ANSWER = ("I could not find this in the approved OCBC information available to me, "
                    "so I have not drafted an answer.")
# Model A is told to reply with exactly this when the passages do not answer the question.
NOT_FOUND_REPLY = "I do not have this information."

DEFAULT_REASONS = {
    "supported": "The cited passage states this.",
    "contradicted": "The cited passage states something different.",
    "insufficient_evidence": "No passage confirms or contradicts this.",
}


class ServiceError(Exception):
    def __init__(self, code, message):
        super().__init__(message)
        self.code = code


# ---------- entry point ----------

def lambda_handler(event, context=None):
    started = time.monotonic()
    event = event if isinstance(event, dict) else {}
    request_id = str(event.get("requestId") or "")
    try:
        question = _read_question(event)
        approved_items = approved.clean(event.get("approvedAnswers"))
        result = {"requestId": request_id, **answer_question(question, approved_items)}
        result["meta"]["latencyMs"] = int((time.monotonic() - started) * 1000)
        _log({"requestId": request_id, "type": result["type"], "confidence": result["confidence"],
              "claims": len(result["claims"]), "latencyMs": result["meta"]["latencyMs"]})
        return result
    except ServiceError as e:
        return _error(request_id, e.code, str(e))
    except llm.BedrockError as e:
        return _error(request_id, "BEDROCK_ERROR", str(e))
    except retrieve.IndexNotFound as e:
        return _error(request_id, "INDEX_NOT_FOUND", str(e))
    except retrieve.IndexMismatch as e:
        return _error(request_id, "INDEX_MISMATCH", str(e))
    except Exception as e:  # anything unexpected: log the stack trace, return a clean error
        traceback.print_exc()
        return _error(request_id, "INTERNAL_ERROR", f"{type(e).__name__}: {e}")


def answer_question(question, approved_items=()):
    answer_model = _require("ANSWER_MODEL_ID")
    checker_model = _require("CHECKER_MODEL_ID")
    top_k = _setting("TOP_K", 6, int)
    min_score = _setting("MIN_SCORE", 0.2, float)

    index = retrieve.load()  # fail on a missing index before paying for any model call
    meta = {"answerModel": answer_model, "checkerModel": checker_model,
            "indexCreatedAt": index["createdAt"], "retrieval": [], "approvedBestScore": None}

    q_vec = llm.embed(question)

    best_score, match = _match_approved(q_vec, approved_items)
    meta["approvedBestScore"] = round(best_score, 3) if best_score is not None else None
    if match:
        return _approved_response(match, best_score, meta)

    q_hits = retrieve.search(q_vec, top_k, min_score)
    meta["retrieval"] = [{"id": c["id"], "score": round(s, 3)} for s, c in q_hits]
    if not q_hits:
        return _no_source_response(meta)

    draft = llm.chat(answer_model, _answer_system(), _answer_message(question, q_hits),
                     max_tokens=600, temperature=0.2)
    if not draft:
        raise llm.BedrockError(f"{answer_model} returned an empty answer")
    if _is_not_found(draft):
        # Nothing to check, so skip Model B (saves a call and about 3 s).
        return _no_source_response(meta, "The passages found do not answer this question.",
                                   _category(None, q_hits))

    a_hits = retrieve.search(llm.embed(draft), top_k, min_score)
    evidence = _evidence(q_hits, a_hits, q_vec)
    by_id = {c["id"]: c for c in evidence}

    verdict = _run_checker(checker_model, question, draft, evidence)
    claims = _claims(verdict.get("claims"), by_id)
    answers = verdict.get("answersQuestion")

    confidence = _confidence(claims, by_id)
    if answers is False:
        # True facts that answer a different question are not a trustworthy answer.
        confidence = 0.0

    return {
        "type": "generated",
        "answer": draft,
        "category": _category(verdict.get("category"), q_hits),
        "confidence": confidence,
        "safetyTextAltered": checks.safety_text_altered(draft),
        "claims": claims,
        "sources": _sources(claims, q_hits, by_id),
        "relevance": {
            "answersQuestion": answers if isinstance(answers, bool) else None,
            "reason": str(verdict.get("relevanceReason") or "").strip()[:300],
        },
        "meta": meta,
    }


# ---------- request and settings ----------

def _read_question(event):
    question = event.get("question")
    if not isinstance(question, str) or not question.strip():
        raise ServiceError("BAD_REQUEST", "question is required and must be a non-empty string")
    question = question.strip()
    if len(question) > MAX_QUESTION_CHARS:
        raise ServiceError("BAD_REQUEST", f"question is longer than {MAX_QUESTION_CHARS} characters")
    return question


def _require(name):
    value = os.getenv(name)
    if not value:
        raise ServiceError("INTERNAL_ERROR", f"Environment variable {name} is not set")
    return value


def _setting(name, default, cast):
    value = os.getenv(name)
    return cast(value) if value not in (None, "") else default


def _prompt(name):
    return (PROMPTS / name).read_text(encoding="utf-8")


# ---------- Model A: draft the answer ----------

def _answer_system():
    return _prompt("answer.txt").replace("{SAFETY_TEXT}", checks.FIXED_SAFETY_TEXTS[0])


def _answer_message(question, hits):
    show_meta = os.getenv("ANSWER_SHOWS_METADATA", "false").lower() == "true"
    blocks = []
    for _, c in hits:
        head = f"[{c['id']}] {c['title']}"
        if show_meta:
            status = "current" if c.get("isCurrent", True) else "outdated"
            head += f" ({c['authority']}, {status}, effective {c['effectiveDate']})"
        blocks.append(f"{head}\n{c['text']}")
    return f"Customer question:\n{question}\n\nPassages:\n\n" + "\n\n".join(blocks)


# ---------- evidence for the checker ----------

def _evidence(q_hits, a_hits, q_vec):
    """Passages found by the question and by the draft, plus the current
    version of any outdated passage, so the checker can spot stale facts."""
    limit = _setting("MAX_EVIDENCE", 12, int)
    seen, out = set(), []

    def add(chunk):
        if chunk["id"] not in seen:
            seen.add(chunk["id"])
            out.append(chunk)

    for pair in itertools.zip_longest(q_hits, a_hits):
        for hit in pair:
            if hit and len(out) < limit:
                add(hit[1])

    for chunk in list(out):
        if not chunk.get("isCurrent", True):
            doc_id = chunk["docId"]
            current = retrieve.search(
                q_vec, 1, where=lambda c, d=doc_id: c["docId"] == d and c.get("isCurrent", True))
            if current:
                add(current[0][1])
    return out


# ---------- Model B: check the claims ----------

def _run_checker(model, question, draft, evidence):
    system = _prompt("check.txt").replace("{CATEGORIES}", ", ".join(CATEGORIES))
    message = _checker_message(question, draft, evidence)
    data = _parse_json(llm.chat(model, system, message, max_tokens=2000, temperature=0))
    if data is None:  # one retry with a firmer instruction
        retry = message + "\n\nReturn only the JSON object described above, with no other text."
        data = _parse_json(llm.chat(model, system, retry, max_tokens=2000, temperature=0))
    if data is None or not isinstance(data.get("claims"), list):
        raise llm.BedrockError(f"{model} did not return valid JSON for the claim check")
    return data


def _checker_message(question, draft, evidence):
    blocks = []
    for c in evidence:
        if c.get("isCurrent", True):
            status = "current"
        else:
            status = f"outdated (replaced by version {c.get('newerVersion')})"
        blocks.append(
            f"[{c['id']}] {c['title']}\n"
            f"authority: {c['authority']} | version: {c['version']} | "
            f"effective: {c['effectiveDate']} | status: {status}\n{c['text']}")
    return (f"Customer question:\n{question}\n\nDraft answer:\n{draft}\n\n"
            f"Evidence passages:\n\n" + "\n\n".join(blocks))


def _parse_json(text):
    if not text:
        return None
    text = re.sub(r"^```(?:json)?\s*|\s*```$", "", text.strip())
    start, end = text.find("{"), text.rfind("}")
    if start < 0 or end <= start:
        return None
    try:
        value = json.loads(text[start:end + 1])
    except json.JSONDecodeError:
        return None
    return value if isinstance(value, dict) else None


def _claims(raw, by_id):
    """Clean the checker's claims into the contract shape. Never trust its citations blindly:
    a supported or contradicted claim must quote words that are really in a passage.
    If the quote is not in the cited passage but is in another one, the citation is
    moved there. If it is in none, the claim is downgraded to insufficient_evidence."""
    out = []
    for item in raw or []:
        if not isinstance(item, dict):
            continue
        text = str(item.get("text") or "").strip()
        if not text or _is_not_found(text):
            continue  # "I do not have this information" is not a claim
        label = item.get("label") if item.get("label") in LABELS else "insufficient_evidence"
        source_id = item.get("sourceId") if item.get("sourceId") in by_id else None
        quote = str(item.get("quote") or "").strip()[:400]
        reason = str(item.get("reason") or "").strip()[:300]
        problem = None

        if label != "insufficient_evidence":
            if not quote:
                problem = "No quote from a passage was given"
            elif source_id is None or not checks.quote_found(quote, by_id[source_id]["text"]):
                source_id = _find_quote(quote, by_id, official_only=(label == "contradicted"))
                if source_id is None:
                    problem = f'The quoted words were not found in any passage: "{quote[:120]}"'
            if problem:
                label = "insufficient_evidence"
        if label == "insufficient_evidence":
            source_id, quote = None, None

        reason = reason or DEFAULT_REASONS[label]
        if problem:
            reason = f"{reason} ({problem}, so this claim is not verified.)"

        source = by_id.get(source_id)
        out.append({
            "id": f"c{len(out) + 1}",
            "text": text,
            "label": label,
            "sourceId": source_id,
            "quote": quote,
            "outdated": bool(source and not source.get("isCurrent", True)),
            "reason": reason,
        })
        if len(out) == MAX_CLAIMS:
            break
    return out


def _find_quote(quote, by_id, official_only):
    """The passage that really contains the quote, preferring current official ones.
    A contradiction only counts against a current official passage."""
    found = [c for c in by_id.values() if checks.quote_found(quote, c["text"])]
    if official_only:
        found = [c for c in found if _is_trusted(c)]
    found.sort(key=lambda c: not _is_trusted(c))
    return found[0]["id"] if found else None


def _is_not_found(text):
    return (checks._norm(text).startswith(checks._norm(NOT_FOUND_REPLY))
            and len(text) <= len(NOT_FOUND_REPLY) + 60)


# ---------- scoring and output ----------

def _is_trusted(chunk):
    return chunk.get("isCurrent", True) and chunk.get("authority") == "official"


def _confidence(claims, by_id):
    """Verified claims / all claims. No claims means nothing could be verified: 0."""
    if not claims:
        return 0.0
    verified = sum(1 for c in claims
                   if c["label"] == "supported" and c["sourceId"] and _is_trusted(by_id[c["sourceId"]]))
    return round(verified / len(claims), 2)


def _category(value, q_hits):
    if value in CATEGORIES:
        return value
    if q_hits and q_hits[0][0] >= 0.35:
        return q_hits[0][1]["category"]
    return "uncategorised"


def _sources(claims, q_hits, by_id):
    """Every cited passage first (in claim order), then at most MAX_ALSO_FOUND
    uncited passages that matched the question well (score >= ALSO_FOUND_MIN).
    Weak matches are left out so they don't distract the reviewer."""
    min_score = _setting("ALSO_FOUND_MIN", 0.40, float)
    cited = []
    for c in claims:
        if c["sourceId"] and c["sourceId"] not in cited:
            cited.append(c["sourceId"])
    also_found = []
    for score, chunk in q_hits:  # best first
        if len(also_found) >= MAX_ALSO_FOUND or score < min_score:
            break
        if chunk["id"] not in cited and chunk["id"] not in also_found:
            also_found.append(chunk["id"])
            by_id.setdefault(chunk["id"], chunk)
    return ([_source(by_id[i], cited=True) for i in cited]
            + [_source(by_id[i], cited=False) for i in also_found])


def _source(c, cited):
    outdated = not c.get("isCurrent", True)
    return {
        "id": c["id"],
        "docId": c["docId"],
        "title": c["title"],
        "version": c["version"],
        "effectiveDate": c["effectiveDate"],
        "authority": c["authority"],
        "category": c["category"],
        "cited": cited,
        "outdated": outdated,
        "newerVersion": c.get("newerVersion") if outdated else None,
        "excerpt": _excerpt(c["text"]),
        "url": c.get("sourceUrl") or None,
    }


def _excerpt(text):
    body = text.split("\n\n", 1)[-1].strip()  # drop the "Title - Section" line
    return body if len(body) <= EXCERPT_CHARS else body[:EXCERPT_CHARS].rstrip() + "..."


def _match_approved(q_vec, items):
    """(best score, matching item or None). A problem with the approved list
    must never block the officer, so any error means: answer normally."""
    if not items:
        return None, None
    try:
        return approved.find_match(q_vec, items, llm.embed)
    except Exception as e:
        _log({"warning": "approved_match_skipped", "error": f"{type(e).__name__}: {e}"})
        return None, None


def _approved_response(item, score, meta):
    return {
        "type": "approved",
        "answer": item["answer"],
        "category": item.get("category") if item.get("category") in CATEGORIES else "uncategorised",
        "confidence": None,
        "safetyTextAltered": False,
        "approvedAnswer": {"id": item["id"], "version": str(item.get("version", "")),
                           "matchScore": round(score, 2)},
        "claims": [],
        "sources": [],
        "relevance": {"answersQuestion": None, "reason": ""},
        "meta": meta,
    }


def _no_source_response(meta, reason="No passage in the knowledge base matched the question.",
                        category="uncategorised"):
    return {
        "type": "generated",
        "answer": NO_SOURCE_ANSWER,
        "category": category,
        "confidence": 0.0,
        "safetyTextAltered": False,
        "claims": [],
        "sources": [],
        "relevance": {"answersQuestion": False, "reason": reason},
        "meta": meta,
    }


def _error(request_id, code, message):
    _log({"requestId": request_id, "error": code, "message": message})
    return {"requestId": request_id, "error": {"code": code, "message": message}}


def _log(record):
    print(json.dumps(record, ensure_ascii=False))  # one line per request in CloudWatch
