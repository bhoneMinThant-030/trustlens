"""
Checks done in code, so the AI cannot talk its way past them.

1. safety_text_altered(answer)
   Fixed safety wording must be copied word for word or left out. True when a
   sentence in the answer looks like one of these but is not the same.

2. quote_found(quote, passage)
   Model B must quote the passage words behind each label. True only when the
   quote really is in the passage. Small differences (case, punctuation, one
   changed or extra word in a long quote) are allowed, but every number and
   every negation (not, never, no ...) must match exactly: "S$50" is not
   "S$100", and "is received" is not "is not received". List numbers
   ("1.", "2.") are ignored, and a quote may join two parts with "...".
"""
import re
from difflib import SequenceMatcher

# ---------- 1. fixed safety wording ----------

FIXED_SAFETY_TEXTS = [
    "OCBC employees will never ask you to reveal your PIN/OTP or transfer funds to personal accounts.",
]

SIMILARITY = 0.6                      # how close a sentence must be to count as "a version of" it
SENSITIVE_WORDS = {"pin", "otp", "password"}


def _norm(text):
    return " ".join(re.findall(r"[a-z0-9]+", text.lower()))


def _sentences(text):
    return [s for s in re.split(r"(?<=[.!?])\s+|\n+", text) if s.strip()]


def safety_text_altered(answer):
    if not answer:
        return False
    for fixed in FIXED_SAFETY_TEXTS:
        target = _norm(fixed)
        for sentence in _sentences(answer):
            s = _norm(sentence)
            if s == target:
                continue  # copied exactly
            words = set(s.split())
            looks_like_it = SequenceMatcher(None, s, target).ratio() >= SIMILARITY
            # A different "never ... PIN/OTP" sentence is also a changed safety message.
            touches_it = "never" in words and bool(words & SENSITIVE_WORDS)
            if looks_like_it or touches_it:
                return True
    return False


# ---------- 2. citation quotes ----------

QUOTE_SIMILARITY = 0.85
NEGATIONS = {"not", "no", "never", "cannot", "without", "nor", "none"}


LIST_MARKER_AT_LINE_START = re.compile(r"(?m)^\s*(?:\d{1,2}[.)]|[-*•])\s+")
LIST_MARKER_INLINE = re.compile(r"(?<=[.;:])\s+\d{1,2}[.)]\s+(?=[A-Za-z])")  # "...messages. 2. Verify"
ELLIPSIS = re.compile(r"\s*(?:\.\.\.|…)\s*")


def _tokens(text):
    # List numbers ("1.", "2.") are layout, not facts, so they must not count as numbers.
    text = LIST_MARKER_AT_LINE_START.sub(" ", text)
    text = LIST_MARKER_INLINE.sub(" ", text)
    text = text.lower().replace("’", "'").replace("n't", " not")
    return re.findall(r"[a-z0-9$%]+(?:[.,][0-9]+)*", text)


def _critical(tokens):
    """Numbers and negations: the words that change the meaning if they differ."""
    return {t for t in tokens if t in NEGATIONS or any(ch.isdigit() for ch in t)}


def quote_found(quote, passage):
    """True if the quote is in the passage. A quote may join separate parts of
    the passage with "..."; then every part must be found."""
    parts = [part for part in ELLIPSIS.split(quote or "") if _tokens(part)]
    if not parts:
        return False
    p = _tokens(passage or "")
    return all(_part_found(_tokens(part), p) for part in parts)


def _part_found(q, p):
    if f" {' '.join(q)} " in f" {' '.join(p)} ":
        return True  # exact, ignoring case and punctuation

    must_match = _critical(q)
    q_words = set(q)
    n = len(q)
    for size in (n - 1, n, n + 1):
        if size < 1:
            continue
        for start in range(0, max(1, len(p) - size + 1)):
            window = p[start:start + size]
            if _critical(window) != must_match:
                continue  # a number or negation differs
            if len(q_words & set(window)) < 0.7 * len(q_words):
                continue  # cheap pre-filter
            if SequenceMatcher(None, q, window, autojunk=False).ratio() >= QUOTE_SIMILARITY:
                return True
    return False
