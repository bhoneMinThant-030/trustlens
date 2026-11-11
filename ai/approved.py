"""
Approved answers: wording a reviewer has approved, reused word for word when a
new question asks the same thing. An approved answer skips Model A and Model B,
because a human has already checked it.

Node keeps approved answers in SQLite (approved_answers) and sends them with
each request:
    "approvedAnswers": [{"id", "version", "category", "question", "answer"}]
The Lambda never reads a database. No list, or an empty one, means no matching.

Matching: the new question's embedding is compared with the embedding of each
approved question. The best match is used if its score is at least
APPROVED_MATCH_MIN (default 0.85). Each approved question is embedded once per
running Lambda and remembered.
"""
import os

from retrieve import dot

MAX_ITEMS = 200
MAX_QUESTION_CHARS = 2000

_vectors = {}  # (id, version, question) -> embedding, cached per running Lambda


def clean(items):
    """Keep only well-formed items from the request. Broken ones are skipped."""
    if not isinstance(items, list):
        return []
    out = []
    for item in items[:MAX_ITEMS]:
        if not isinstance(item, dict):
            continue
        fields = [item.get("id"), item.get("question"), item.get("answer")]
        if not all(isinstance(f, str) and f.strip() for f in fields):
            continue
        out.append({
            "id": item["id"].strip(),
            "version": str(item.get("version") or ""),
            "category": item.get("category"),
            "question": item["question"].strip()[:MAX_QUESTION_CHARS],
            "answer": item["answer"].strip(),
        })
    return out


def find_match(question_vector, items, embed):
    """Compare the question with every approved question.

    Returns (best_score, item). item is None when the best score is below the
    threshold. best_score is None when there are no items."""
    if not items:
        return None, None
    min_score = float(os.getenv("APPROVED_MATCH_MIN", "0.85"))
    best_score, best_item = None, None
    for item in items:
        key = (item["id"], item["version"], item["question"])
        if key not in _vectors:
            _vectors[key] = embed(item["question"])
        score = dot(question_vector, _vectors[key])
        if best_score is None or score > best_score:
            best_score, best_item = score, item
    return best_score, (best_item if best_score >= min_score else None)
