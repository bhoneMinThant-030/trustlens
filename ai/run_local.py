"""
Run the Lambda handler on your own machine, with real Bedrock and S3 calls.

Usage (from the repo root):
  python ai/run_local.py "Can the annual fee on my card be waived?"
  python ai/run_local.py --json "..."                  # raw JSON, exactly what Node receives
  python ai/run_local.py --index ai/index.json "..."   # local index from: python ai/ingest.py --local

Settings come from ai/.env. Credentials come from your default AWS CLI
profile (bhone-admin); use --profile to pick another. Each run makes about
four Bedrock calls, a fraction of a US cent.
"""
import argparse
import json
import os
import sys
import textwrap
from pathlib import Path

AI_DIR = Path(__file__).resolve().parent
sys.path.insert(0, str(AI_DIR))


def review_reasons(result, threshold):
    """Mirror of Node's routing rule (docs/api-contract.md), for a quick preview."""
    if result.get("type") != "generated":
        return []
    reasons = []
    if result["confidence"] is not None and result["confidence"] < threshold:
        reasons.append("auto_threshold")
    if any(c["label"] == "contradicted" for c in result["claims"]):
        reasons.append("auto_contradiction")
    if result["safetyTextAltered"]:
        reasons.append("auto_safety")
    return reasons


def print_summary(result, threshold=0.7):
    if "error" in result:
        print(f"ERROR {result['error']['code']}: {result['error']['message']}")
        return

    wrap = lambda s, indent="  ": textwrap.fill(s, 96, initial_indent=indent, subsequent_indent=indent)
    print(f"Type: {result['type']}    Category: {result['category']}")
    print("\nAnswer:")
    print(wrap(result["answer"]))

    if result["type"] == "approved":
        aa = result["approvedAnswer"]
        print(f"\nApproved answer {aa['id']} v{aa['version']} (match {aa['matchScore']})")
    else:
        authority = {s["id"]: s["authority"] for s in result["sources"]}
        print("\nClaims:")
        if not result["claims"]:
            print("  (none)")
        for c in result["claims"]:
            flags = []
            if c["outdated"]:
                flags.append("OUTDATED")
            if c["sourceId"] and authority.get(c["sourceId"]) == "unofficial":
                flags.append("UNOFFICIAL")
            flag_text = f"  [{', '.join(flags)}]" if flags else ""
            print(f"  {c['id']:<4} {c['label']:<22} {c['sourceId'] or '-'}{flag_text}")
            print(wrap(c["text"], "       "))
            if c.get("quote"):
                print(wrap(f'quote: "{c["quote"]}"', "       "))
            if c["reason"]:
                print(wrap("why: " + c["reason"], "       "))

        rel = result.get("relevance") or {}
        answered = {True: "yes", False: "NO", None: "unknown"}[rel.get("answersQuestion")]
        print(f"\nConfidence: {result['confidence']}    "
              f"Safety wording changed: {'YES' if result['safetyTextAltered'] else 'no'}    "
              f"Answers the question: {answered}")
        if rel.get("reason"):
            print(wrap("relevance: " + rel["reason"]))

    reasons = review_reasons(result, threshold)
    print(f"Goes to review (threshold {threshold}): {'YES - ' + ', '.join(reasons) if reasons else 'no'}")

    meta = result.get("meta", {})
    if meta.get("retrieval"):
        top = ", ".join(f"{r['id']} {r['score']}" for r in meta["retrieval"][:3])
        print(f"\nTop passages: {top}")
    if "latencyMs" in meta:
        print(f"Time: {meta['latencyMs'] / 1000:.1f} s")


def main():
    ap = argparse.ArgumentParser(description="Ask TrustLens one question using your local code.")
    ap.add_argument("question")
    ap.add_argument("--json", action="store_true", help="print the raw JSON response")
    ap.add_argument("--index", help="use a local index.json instead of the one in S3")
    ap.add_argument("--profile", help="AWS CLI profile to use (default: your default profile)")
    ap.add_argument("--threshold", type=float, default=0.7, help="review threshold for the preview")
    args = ap.parse_args()

    try:
        sys.stdout.reconfigure(encoding="utf-8")  # Windows consoles
    except Exception:
        pass

    from dotenv import load_dotenv
    load_dotenv(AI_DIR / ".env")
    if args.profile:
        os.environ["AWS_PROFILE"] = args.profile
    if args.index:
        os.environ["INDEX_PATH"] = str(Path(args.index).resolve())

    import handler
    handler._log = lambda record: None  # the one-line CloudWatch log is noise here
    result = handler.lambda_handler({"requestId": "local-1", "question": args.question})
    if args.json:
        print(json.dumps(result, indent=2, ensure_ascii=False))
    else:
        print_summary(result, args.threshold)
    sys.exit(1 if "error" in result else 0)


if __name__ == "__main__":
    main()
