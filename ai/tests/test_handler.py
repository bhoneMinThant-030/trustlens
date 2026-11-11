"""
Offline tests for the Lambda handler. No AWS calls, no cost.

Run from the repo root:
  python -m unittest discover -s ai/tests -v

Bedrock is replaced by fakes: embeddings are word-hash vectors, and the two
models return scripted replies. The index is built from the real knowledge
base with ai/ingest.py, so retrieval runs over the real chunks and metadata.
"""
import hashlib
import json
import math
import os
import re
import sys
import tempfile
import unittest
from pathlib import Path
from unittest import mock

AI_DIR = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(AI_DIR))

import approved  # noqa: E402
import checks  # noqa: E402
import handler  # noqa: E402
import ingest  # noqa: E402
import llm  # noqa: E402
import retrieve  # noqa: E402

DIMS = 1024
SAFETY = checks.FIXED_SAFETY_TEXTS[0]
TOP_KEYS = {"requestId", "type", "answer", "category", "confidence", "safetyTextAltered",
            "claims", "sources", "relevance", "meta"}
CLAIM_KEYS = {"id", "text", "label", "sourceId", "quote", "outdated", "reason"}
SOURCE_KEYS = {"id", "docId", "title", "version", "effectiveDate", "authority", "category",
               "cited", "outdated", "newerVersion",
               "excerpt", "url"}


def fake_embed(text):
    v = [0.0] * DIMS
    for word in re.findall(r"[a-z0-9$]+", text.lower()):
        v[int(hashlib.md5(word.encode()).hexdigest(), 16) % DIMS] += 1.0
    n = math.sqrt(sum(x * x for x in v)) or 1.0
    return [x / n for x in v]


def evidence_ids(message):
    """IDs of the passages the checker was shown, in order."""
    return re.findall(r"^\[([^\]]+)\]", message.split("Evidence passages:", 1)[-1], re.M)


class Fakes:
    """Scripted Model A and Model B."""

    def __init__(self, draft, checker):
        self.draft = draft
        self.checker = checker  # function(evidence_ids, chunks_by_id) -> reply text
        self.calls = []

    def chat(self, model_id, system, user, max_tokens, temperature):
        self.calls.append(model_id)
        if model_id == "test-answer":
            return self.draft
        by_id = {c["id"]: c for c in retrieve.load()["chunks"]}
        return add_real_quotes(self.checker(evidence_ids(user), by_id), by_id)


def passage_words(chunk, n=12):
    """The first n words of a passage body: a quote that really is in it."""
    return " ".join(chunk["text"].split("\n\n", 1)[-1].split()[:n])


def add_real_quotes(reply, by_id):
    """Like a well-behaved Model B: fill in a real quote for every cited claim
    that does not set one. Tests that need a bad quote set it explicitly."""
    try:
        data = json.loads(reply)
    except (TypeError, ValueError):
        return reply
    for c in data.get("claims", []):
        if isinstance(c, dict) and "quote" not in c and c.get("sourceId") in by_id:
            c["quote"] = passage_words(by_id[c["sourceId"]])
    return json.dumps(data)


def claim(text, label, source_id, reason="test", **extra):
    return {"text": text, "label": label, "sourceId": source_id, "reason": reason, **extra}


def verdict(claims, answers=True, category="fees-charges"):
    return json.dumps({"claims": claims, "answersQuestion": answers,
                       "relevanceReason": "test", "category": category})


def first(ids, by_id, **where):
    for i in ids:
        if all(by_id[i].get(k) == v for k, v in where.items()):
            return i
    raise AssertionError(f"No evidence passage with {where}; evidence was {ids}")


class HandlerTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        _, chunks = ingest.build()
        for c in chunks:
            c["embedding"] = fake_embed(c["text"])
        cls.tmp = tempfile.TemporaryDirectory()
        cls.index_path = os.path.join(cls.tmp.name, "index.json")
        with open(cls.index_path, "w", encoding="utf-8") as f:
            json.dump({"createdAt": "test", "embeddingModel": "test-embed", "dimensions": DIMS,
                       "documents": [], "chunks": chunks}, f)

    @classmethod
    def tearDownClass(cls):
        cls.tmp.cleanup()

    def setUp(self):
        self.env = mock.patch.dict(os.environ, {
            "EMBEDDING_MODEL_ID": "test-embed", "EMBEDDING_DIMENSIONS": str(DIMS),
            "ANSWER_MODEL_ID": "test-answer", "CHECKER_MODEL_ID": "test-checker",
            "INDEX_PATH": self.index_path, "MIN_SCORE": "0.05",
        })
        self.env.start()
        retrieve.reset()
        approved._vectors.clear()
        mock.patch.object(llm, "embed", side_effect=fake_embed).start()
        mock.patch.object(handler, "_log").start()  # keep test output quiet

    def tearDown(self):
        mock.patch.stopall()
        retrieve.reset()

    def ask(self, question, fakes, approved_answers=None):
        event = {"requestId": "t1", "question": question}
        if approved_answers is not None:
            event["approvedAnswers"] = approved_answers
        with mock.patch.object(llm, "chat", side_effect=fakes.chat):
            return handler.lambda_handler(event)

    # ----- normal answers and scoring -----

    def test_supported_by_current_official_source_is_verified(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            return verdict([claim("The late payment fee is S$100.", "supported", sid)])
        r = self.ask("What is the late payment fee on my credit card?",
                     Fakes("The late payment fee is S$100.", checker))
        self.assertNotIn("error", r)
        self.assertEqual(r["type"], "generated")
        self.assertEqual(r["confidence"], 1.0)
        self.assertEqual(r["claims"][0]["label"], "supported")
        self.assertFalse(r["claims"][0]["outdated"])
        self.assertEqual(r["category"], "fees-charges")

    def test_contract_shape(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            return verdict([claim("a", "supported", sid), claim("b", "insufficient_evidence", None)])
        r = self.ask("What is the late payment fee?", Fakes("Draft.", checker))
        self.assertEqual(set(r), TOP_KEYS)
        self.assertEqual(r["requestId"], "t1")
        for c in r["claims"]:
            self.assertEqual(set(c), CLAIM_KEYS)
        for s in r["sources"]:
            self.assertEqual(set(s), SOURCE_KEYS)
        cited = {c["sourceId"] for c in r["claims"] if c["sourceId"]}
        self.assertTrue(cited <= {s["id"] for s in r["sources"]}, "every cited source is listed")
        self.assertEqual([c["id"] for c in r["claims"]], ["c1", "c2"])
        self.assertEqual(r["confidence"], 0.5)
        self.assertIn("latencyMs", r["meta"])
        json.dumps(r)  # must be serialisable for Lambda

    def test_outdated_source_is_flagged_and_not_verified(self):
        def checker(ids, by_id):
            old = first(ids, by_id, docId="paylite-instalment-plan", isCurrent=False)
            return verdict([claim("PayLite can run for 24 months.", "supported", old)])
        r = self.ask("Can I repay PayLite over 24 months with a 1% to 3% fee?",
                     Fakes("PayLite can run for 24 months.", checker))
        self.assertTrue(r["claims"][0]["outdated"])
        self.assertEqual(r["confidence"], 0.0)

    def test_checker_sees_current_version_of_an_outdated_passage(self):
        seen = {}

        def checker(ids, by_id):
            seen["ids"] = ids
            return verdict([])
        self.ask("Can I repay PayLite over 24 months with a 1% to 3% fee?", Fakes("Draft.", checker))
        index = {c["id"]: c for c in retrieve.load()["chunks"]}
        outdated_docs = {index[i]["docId"] for i in seen["ids"] if not index[i]["isCurrent"]}
        self.assertTrue(outdated_docs, "test question should surface an outdated passage")
        for doc in outdated_docs:
            self.assertTrue(any(index[i]["docId"] == doc and index[i]["isCurrent"] for i in seen["ids"]),
                            f"current version of {doc} missing from evidence")

    def test_unofficial_source_is_not_verified(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, authority="unofficial")
            return verdict([claim("The cashback cap is S$250.", "supported", sid)])
        r = self.ask("What is the monthly cashback cap on the OCBC 365 card staff quick reference?",
                     Fakes("The cashback cap is S$250.", checker))
        self.assertEqual(r["confidence"], 0.0)
        src = next(s for s in r["sources"] if s["id"] == r["claims"][0]["sourceId"])
        self.assertEqual(src["authority"], "unofficial")
        self.assertIsNone(src["url"])

    def test_contradiction_is_kept(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, authority="official", isCurrent=True)
            return verdict([claim("The cap is S$250.", "contradicted", sid),
                            claim("Minimum spend is S$800.", "supported", sid)])
        r = self.ask("What is the 365 card cashback cap?", Fakes("Draft.", checker))
        self.assertEqual([c["label"] for c in r["claims"]], ["contradicted", "supported"])
        self.assertEqual(r["confidence"], 0.5)

    def test_supported_with_made_up_source_is_downgraded(self):
        def checker(ids, by_id):
            return verdict([claim("Fee is S$100.", "supported", "not-a-real-id@1#1")])
        r = self.ask("What is the late payment fee?", Fakes("Fee is S$100.", checker))
        c = r["claims"][0]
        self.assertEqual(c["label"], "insufficient_evidence")
        self.assertIsNone(c["sourceId"])
        self.assertEqual(r["confidence"], 0.0)

    def test_bad_labels_and_empty_claims_are_cleaned(self):
        def checker(ids, by_id):
            return verdict([{"text": "x", "label": "probably"}, {"text": "  "}, "junk"])
        r = self.ask("What is the late payment fee?", Fakes("Draft.", checker))
        self.assertEqual(len(r["claims"]), 1)
        self.assertEqual(r["claims"][0]["label"], "insufficient_evidence")

    def test_no_claims_scores_zero(self):
        r = self.ask("What is the late payment fee?",
                     Fakes("I do not have this information.", lambda ids, by_id: verdict([])))
        self.assertEqual(r["confidence"], 0.0)

    def test_unknown_category_falls_back(self):
        r = self.ask("What is the late payment fee on my credit card?",
                     Fakes("Draft.", lambda ids, by_id: verdict([], category="space-travel")))
        self.assertIn(r["category"], handler.CATEGORIES)

    def test_relevance_is_passed_through(self):
        r = self.ask("What is the late payment fee?",
                     Fakes("Draft.", lambda ids, by_id: verdict([], answers=False)))
        self.assertIs(r["relevance"]["answersQuestion"], False)

    # ----- citation quotes and relevance (added after the first real run) -----

    def test_made_up_quote_is_downgraded(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            return verdict([claim("Fee is S$100.", "supported", sid,
                                  quote="late fees are refunded in full every December")])
        r = self.ask("What is the late payment fee?", Fakes("Fee is S$100.", checker))
        c = r["claims"][0]
        self.assertEqual(c["label"], "insufficient_evidence")
        self.assertIsNone(c["sourceId"])
        self.assertIsNone(c["quote"])
        self.assertIn("not found in any passage", c["reason"])
        self.assertEqual(r["confidence"], 0.0)

    def test_quote_from_another_passage_moves_the_citation(self):
        # Model B cites the official page but quotes the unofficial contact-centre note.
        def checker(ids, by_id):
            official = first(ids, by_id, docId="credit-card-billing-and-interest", isCurrent=True)
            first(ids, by_id, docId="billing-contact-centre-notes")  # must be in the evidence
            return verdict([claim("The first late charge each year is waived.", "supported", official,
                                  quote="the first late charge each year is waived automatically")])
        r = self.ask("What is the late payment fee?", Fakes("Draft.", checker))
        c = r["claims"][0]
        self.assertEqual(c["label"], "supported")
        self.assertTrue(c["sourceId"].startswith("billing-contact-centre-notes@"))
        self.assertEqual(r["confidence"], 0.0, "unofficial support is not verified")

    def test_contradiction_cannot_move_to_an_unofficial_passage(self):
        def checker(ids, by_id):
            official = first(ids, by_id, docId="credit-card-billing-and-interest", isCurrent=True)
            return verdict([claim("The late charge is S$100.", "contradicted", official,
                                  quote="the first late charge each year is waived automatically")])
        r = self.ask("What is the late payment fee?", Fakes("Draft.", checker))
        self.assertEqual(r["claims"][0]["label"], "insufficient_evidence")

    def test_draft_saying_no_information_skips_the_checker(self):
        fakes = Fakes("I do not have this information.", lambda ids, by_id: verdict([]))
        r = self.ask("Can I get a chargeback on a crypto purchase?", fakes)
        self.assertEqual(fakes.calls, ["test-answer"])
        self.assertEqual(r["answer"], handler.NO_SOURCE_ANSWER)
        self.assertEqual(r["claims"], [])
        self.assertEqual(r["confidence"], 0.0)
        self.assertIs(r["relevance"]["answersQuestion"], False)

    def test_no_information_sentence_is_not_a_claim(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            return verdict([claim("I do not have this information.", "insufficient_evidence", None),
                            claim("Fee is S$100.", "supported", sid)])
        r = self.ask("What is the late payment fee?", Fakes("Fee is S$100. More text here.", checker))
        self.assertEqual([c["text"] for c in r["claims"]], ["Fee is S$100."])

    def test_missing_reason_gets_a_default(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            return verdict([claim("Fee is S$100.", "supported", sid, reason="")])
        r = self.ask("What is the late payment fee?", Fakes("Fee is S$100.", checker))
        self.assertEqual(r["claims"][0]["reason"], handler.DEFAULT_REASONS["supported"])

    def test_real_otp_case_merged_list_items(self):
        # The real OTP run: the draft merged list items 1 and 2 of the scam passage.
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="impersonation-scams", isCurrent=True)
            return verdict([claim(
                "If you suspect a scam, hang up and verify independently through the official "
                "website, app, or hotline.", "supported", sid,
                quote="Hang up and do not call numbers or click links from suspicious messages. "
                      "2. Verify independently through the official website, app or hotline.")],
                category="lost-stolen-fraud")
        r = self.ask("Someone from OCBC called and asked for my OTP. What should I do?",
                     Fakes("Draft.", checker))
        self.assertEqual(r["claims"][0]["label"], "supported")
        self.assertEqual(r["claims"][0]["sourceId"], "impersonation-scams@2026.11#3")

    def test_not_mentioned_is_not_a_contradiction(self):
        # The real late-fee run: "contradicted" because the passage did not mention it.
        def checker(ids, by_id):
            sid = first(ids, by_id, authority="official", isCurrent=True)
            return verdict([claim("The first late charge each year is waived.", "contradicted", sid,
                                  quote=None, reason="The passage does not mention this.")])
        r = self.ask("What is the late payment fee?", Fakes("Draft.", checker))
        self.assertEqual(r["claims"][0]["label"], "insufficient_evidence")

    def test_real_quote_with_small_differences_is_accepted(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            words = passage_words(by_id[sid], 14).split()
            words[2] = "CHANGED"  # one changed word, plus different case and punctuation
            return verdict([claim("x", "supported", sid, quote=" ".join(words).upper() + "!!")])
        r = self.ask("What is the late payment fee?", Fakes("Draft.", checker))
        self.assertEqual(r["claims"][0]["label"], "supported")
        self.assertTrue(r["claims"][0]["quote"])

    def test_answer_to_a_different_question_scores_zero(self):
        # The real crypto run: true facts about cashback, but the customer asked about chargebacks.
        def checker(ids, by_id):
            sid = first(ids, by_id, authority="official", isCurrent=True)
            return verdict([claim("Crypto does not earn cashback.", "supported", sid)], answers=False)
        r = self.ask("Can I get a chargeback on a crypto purchase?", Fakes("Draft.", checker))
        self.assertEqual(r["claims"][0]["label"], "supported")
        self.assertEqual(r["confidence"], 0.0)
        self.assertIs(r["relevance"]["answersQuestion"], False)

    def test_unknown_relevance_keeps_the_score(self):
        def checker(ids, by_id):
            sid = first(ids, by_id, docId="credit-card-fees-schedule", isCurrent=True)
            return verdict([claim("Fee is S$100.", "supported", sid)], answers=None)
        r = self.ask("What is the late payment fee?", Fakes("Fee is S$100.", checker))
        self.assertEqual(r["confidence"], 1.0)

    # ----- checker output problems -----

    def test_checker_json_in_code_fence(self):
        fenced = lambda ids, by_id: "```json\n" + verdict([]) + "\n```"
        r = self.ask("What is the late payment fee?", Fakes("Draft.", fenced))
        self.assertNotIn("error", r)

    def test_checker_retries_once_then_succeeds(self):
        replies = iter(["Sure! Here are the claims.", verdict([])])
        fakes = Fakes("Draft.", lambda ids, by_id: next(replies))
        r = self.ask("What is the late payment fee?", fakes)
        self.assertNotIn("error", r)
        self.assertEqual(fakes.calls.count("test-checker"), 2)

    def test_checker_invalid_twice_is_bedrock_error(self):
        r = self.ask("What is the late payment fee?", Fakes("Draft.", lambda ids, by_id: "no json"))
        self.assertEqual(r["error"]["code"], "BEDROCK_ERROR")

    # ----- failure scenarios -----

    def test_no_matching_passages(self):
        os.environ["MIN_SCORE"] = "0.99"
        fakes = Fakes("unused", lambda ids, by_id: verdict([]))
        r = self.ask("Do you accept Dogecoin chargebacks?", fakes)
        self.assertEqual(r["confidence"], 0.0)
        self.assertEqual(r["claims"], [])
        self.assertEqual(r["answer"], handler.NO_SOURCE_ANSWER)
        self.assertEqual(fakes.calls, [], "no model calls when nothing matches")

    def test_bad_requests(self):
        for event in [{}, {"question": ""}, {"question": "   "}, {"question": 42},
                      {"question": "x" * 2001}, None, "text"]:
            r = handler.lambda_handler(event)
            self.assertEqual(r["error"]["code"], "BAD_REQUEST", event)

    def test_missing_index(self):
        os.environ["INDEX_PATH"] = "/nope/index.json"
        r = self.ask("What is the late payment fee?", Fakes("x", lambda ids, by_id: verdict([])))
        self.assertEqual(r["error"]["code"], "INDEX_NOT_FOUND")

    def test_index_built_with_another_model(self):
        os.environ["EMBEDDING_MODEL_ID"] = "some-other-model"
        r = self.ask("What is the late payment fee?", Fakes("x", lambda ids, by_id: verdict([])))
        self.assertEqual(r["error"]["code"], "INDEX_MISMATCH")

    def test_bedrock_failure(self):
        with mock.patch.object(llm, "embed", side_effect=llm.BedrockError("throttled")):
            r = handler.lambda_handler({"requestId": "t1", "question": "Late fee?"})
        self.assertEqual(r["error"]["code"], "BEDROCK_ERROR")
        self.assertEqual(r["requestId"], "t1")

    def test_missing_setting(self):
        del os.environ["CHECKER_MODEL_ID"]
        r = handler.lambda_handler({"question": "Late fee?"})
        self.assertEqual(r["error"]["code"], "INTERNAL_ERROR")
        self.assertIn("CHECKER_MODEL_ID", r["error"]["message"])

    # ----- approved answers (sent by Node in the request) -----

    LATE_FEE = {"id": "aa_late_fee", "version": "3", "category": "fees-charges",
                "question": "What is the late payment fee?",
                "answer": "The late payment fee is S$100."}

    def test_approved_answer_match(self):
        fakes = Fakes("unused", lambda ids, by_id: verdict([]))
        r = self.ask("What is the late payment fee?", fakes, [self.LATE_FEE])
        self.assertEqual(r["type"], "approved")
        self.assertEqual(r["answer"], "The late payment fee is S$100.", "wording is reused word for word")
        self.assertIsNone(r["confidence"])
        self.assertEqual(r["approvedAnswer"], {"id": "aa_late_fee", "version": "3", "matchScore": 1.0})
        self.assertEqual(r["category"], "fees-charges")
        self.assertEqual(r["claims"], [])
        self.assertEqual(fakes.calls, [], "approved answers skip both models")
        self.assertEqual(r["meta"]["approvedBestScore"], 1.0)

    def test_near_miss_below_threshold_answers_normally(self):
        os.environ["APPROVED_MATCH_MIN"] = "0.99"
        fakes = Fakes("Draft.", lambda ids, by_id: verdict([]))
        r = self.ask("What is the late payment fee for balance transfers?", fakes, [self.LATE_FEE])
        self.assertEqual(r["type"], "generated")
        self.assertIn("test-answer", fakes.calls)
        best = r["meta"]["approvedBestScore"]
        self.assertTrue(best is not None and best < 0.99, "best score is kept for tuning")

    def test_no_list_or_empty_list_answers_normally(self):
        for approved_answers in (None, [], "not a list"):
            r = self.ask("What is the late payment fee?",
                         Fakes("Draft.", lambda ids, by_id: verdict([])), approved_answers)
            self.assertEqual(r["type"], "generated", approved_answers)
            self.assertIsNone(r["meta"]["approvedBestScore"])

    def test_broken_items_are_skipped(self):
        broken = [{"id": "x"}, {"question": "What is the late payment fee?", "answer": "S$100"},
                  {"id": "y", "question": "  ", "answer": "S$100"}, "junk", 42]
        r = self.ask("What is the late payment fee?",
                     Fakes("unused", lambda ids, by_id: verdict([])), broken + [self.LATE_FEE])
        self.assertEqual(r["type"], "approved")
        self.assertEqual(r["approvedAnswer"]["id"], "aa_late_fee")

    def test_unknown_category_becomes_uncategorised(self):
        item = dict(self.LATE_FEE, category="space-travel")
        r = self.ask("What is the late payment fee?",
                     Fakes("unused", lambda ids, by_id: verdict([])), [item])
        self.assertEqual(r["category"], "uncategorised")

    def test_embedding_failure_on_approved_list_answers_normally(self):
        def embed(text):
            if text == "Approved question that breaks":
                raise llm.BedrockError("throttled")
            return fake_embed(text)
        item = dict(self.LATE_FEE, id="aa_broken", question="Approved question that breaks")
        with mock.patch.object(llm, "embed", side_effect=embed):
            r = self.ask("What is the late payment fee?",
                         Fakes("Draft.", lambda ids, by_id: verdict([])), [item])
        self.assertNotIn("error", r)
        self.assertEqual(r["type"], "generated")

    def test_each_approved_question_is_embedded_once(self):
        calls = []
        def embed(text):
            calls.append(text)
            return fake_embed(text)
        item = dict(self.LATE_FEE, id="aa_cache_test", question="How do I report a lost card?")
        with mock.patch.object(llm, "embed", side_effect=embed):
            for _ in range(2):
                self.ask("What is the late payment fee?",
                         Fakes("Draft.", lambda ids, by_id: verdict([])), [item])
        self.assertEqual(calls.count("How do I report a lost card?"), 1)

    def test_list_is_capped(self):
        many = [dict(self.LATE_FEE, id=f"aa_{i}", question=f"Question number {i}") for i in range(250)]
        self.assertEqual(len(approved.clean(many)), approved.MAX_ITEMS)

    # ----- sources: cited, outdated, also found -----

    def chunk(self, cid, doc, current=True, newer=None):
        return {"id": cid, "docId": doc, "title": doc, "version": "v", "effectiveDate": "2026-01-01",
                "authority": "official", "category": "fees-charges", "text": "Title\n\nBody",
                "sourceUrl": "", "isCurrent": current, "newerVersion": newer}

    def test_sources_cited_first_then_close_matches(self):
        cited = self.chunk("fees@2025#2", "fees")
        old = self.chunk("fees@2023#2", "fees", current=False, newer="2025.10")
        weak = self.chunk("instalments@2026#5", "instalments")
        extra = [self.chunk(f"other@1#{i}", "other") for i in range(5)]
        q_hits = [(0.49, old), (0.45, cited)] + [(0.44, c) for c in extra] + [(0.27, weak)]
        claims = [{"sourceId": "fees@2025#2"}]
        out = handler._sources(claims, q_hits, {"fees@2025#2": cited})
        self.assertEqual(out[0]["id"], "fees@2025#2")
        self.assertTrue(out[0]["cited"])
        also = [s for s in out if not s["cited"]]
        self.assertEqual(len(also), handler.MAX_ALSO_FOUND, "at most 3 uncited sources")
        self.assertEqual(also[0]["id"], "fees@2023#2", "uncited sources are ordered by score")
        self.assertTrue(also[0]["outdated"])
        self.assertEqual(also[0]["newerVersion"], "2025.10")
        self.assertNotIn("instalments@2026#5", [s["id"] for s in out], "weak matches are dropped")

    def test_current_source_has_no_newer_version(self):
        out = handler._sources([{"sourceId": "a@1#1"}], [], {"a@1#1": self.chunk("a@1#1", "a")})
        self.assertFalse(out[0]["outdated"])
        self.assertIsNone(out[0]["newerVersion"])

    def test_cited_outdated_source_is_flagged(self):
        def checker(ids, by_id):
            old = first(ids, by_id, docId="paylite-instalment-plan", isCurrent=False)
            return verdict([claim("PayLite can run for 24 months.", "supported", old)])
        r = self.ask("Can I repay PayLite over 24 months with a 1% to 3% fee?",
                     Fakes("PayLite can run for 24 months.", checker))
        src = next(s for s in r["sources"] if s["id"] == r["claims"][0]["sourceId"])
        self.assertTrue(src["cited"])
        self.assertTrue(src["outdated"])
        self.assertTrue(src["newerVersion"])


class QuoteCheckTests(unittest.TestCase):
    P = "Late payment charge: S$100 if the minimum payment is not received by the payment due date."

    def test_exact_quote(self):
        self.assertTrue(checks.quote_found("S$100 if the minimum payment is not received", self.P))

    def test_case_and_punctuation_ignored(self):
        self.assertTrue(checks.quote_found("s$100 IF the minimum payment, is not received!", self.P))

    def test_one_changed_word_in_a_long_quote(self):
        self.assertTrue(checks.quote_found(
            "S$100 if the minimum amount is not received by the payment due date", self.P))

    def test_changed_number_fails(self):
        self.assertFalse(checks.quote_found("S$50 if the minimum payment", self.P))

    def test_dropped_negation_fails(self):
        self.assertFalse(checks.quote_found(
            "S$100 if the minimum payment is received by the payment due date", self.P))

    def test_made_up_quote_fails(self):
        self.assertFalse(checks.quote_found("the first late charge each year is waived", self.P))

    LIST = ("1. Hang up and do not call numbers or click links from suspicious messages.\n"
            "2. Verify independently through the official website, app or hotline.\n"
            "3. Call OCBC on 1800 363 3333 and press 8.")

    def test_list_numbers_are_ignored(self):
        self.assertTrue(checks.quote_found(
            "click links from suspicious messages. 2. Verify independently through the official website",
            self.LIST))

    def test_two_parts_joined_with_ellipsis(self):
        self.assertTrue(checks.quote_found(
            "Hang up and do not call numbers ... Verify independently through the official website",
            self.LIST))

    def test_ellipsis_part_that_is_not_there_fails(self):
        self.assertFalse(checks.quote_found(
            "Hang up and do not call numbers ... transfer your money to a safe account", self.LIST))

    def test_phone_numbers_still_must_match(self):
        self.assertTrue(checks.quote_found("Call OCBC on 1800 363 3333 and press 8", self.LIST))
        self.assertFalse(checks.quote_found("Call OCBC on 1800 363 3334 and press 8", self.LIST))

    def test_empty_quote_fails(self):
        self.assertFalse(checks.quote_found("", self.P))
        self.assertFalse(checks.quote_found(None, self.P))


class SafetyTextTests(unittest.TestCase):
    def test_exact_copy_is_fine(self):
        self.assertFalse(checks.safety_text_altered(f"Report scams at once. {SAFETY}"))

    def test_left_out_is_fine(self):
        self.assertFalse(checks.safety_text_altered("Call the hotline to block your card."))

    def test_changed_wording_is_flagged(self):
        for text in [
            "OCBC staff will never ask for your PIN or OTP.",
            "OCBC employees will never ask you to reveal your PIN/OTP, except to verify your identity.",
            "OCBC employees may ask you to reveal your OTP to confirm a transfer.",
            "Never share your OTP with anyone.",
        ]:
            self.assertTrue(checks.safety_text_altered(text), text)


if __name__ == "__main__":
    unittest.main()
