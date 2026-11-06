"""
Approved answers: wording a reviewer has approved, reused word for word when a
new question asks the same thing. An approved answer skips Model A and Model B.

Where approved answers are stored is not decided yet (MongoDB Atlas is
proposed). Until then this is OFF, unless APPROVED_ANSWERS_FILE points to a
JSON file in the format of data/approved_answers/approved_answers.example.json.
That lets the backend test the "approved" response today; the storage can be
swapped in here later without touching the handler.

Matching: the question's embedding is compared with the embedding of every
sample question. The best match wins if its score is at least
APPROVED_MATCH_MIN (default 0.85).
"""
import json
import os

from retrieve import dot

_vectors = {}  # (id, version, sample question) -> embedding, cached per container


def find_match(question_vector, embed):
    """Return (score, approved_answer) for the best match, or None."""
    path = os.getenv("APPROVED_ANSWERS_FILE")
    if not path:
        return None
    with open(path, encoding="utf-8") as f:
        items = json.load(f)

    min_score = float(os.getenv("APPROVED_MATCH_MIN", "0.85"))
    best = None
    for item in items:
        for sample in item.get("sampleQuestions", []):
            key = (item["id"], str(item.get("version", "")), sample)
            if key not in _vectors:
                _vectors[key] = embed(sample)
            score = dot(question_vector, _vectors[key])
            if best is None or score > best[0]:
                best = (score, item)
    if best and best[0] >= min_score:
        return best
    return None
