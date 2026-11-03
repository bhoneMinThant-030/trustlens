"""
test_models.py - check that all three Bedrock model IDs work in your region.

Usage (from the repo root):
  python ai/test_models.py

Reads ai/.env. Costs a fraction of a cent.
"""
import json
import os
import sys
import time
from pathlib import Path

import boto3
from botocore.exceptions import ClientError
from dotenv import load_dotenv

load_dotenv(Path(__file__).parent / ".env")

REGION = os.getenv("AWS_REGION", "ap-southeast-2")
EMBED = os.getenv("EMBEDDING_MODEL_ID")
ANSWER = os.getenv("ANSWER_MODEL_ID")
CHECKER = os.getenv("CHECKER_MODEL_ID")
DIMS = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))

rt = boto3.client("bedrock-runtime", region_name=REGION)


def hint(err: ClientError) -> str:
    code = err.response["Error"]["Code"]
    msg = err.response["Error"]["Message"]
    if "on-demand throughput" in msg.lower() or "inference profile" in msg.lower():
        return "Use the cross-region inference profile ID (starts with apac. or au.) from the model catalog."
    if code == "AccessDeniedException":
        return ("No access yet. For Anthropic models, submit the use-case form in the Bedrock playground. "
                "If it still fails on the Free plan, the model may be a Marketplace offer the Free plan blocks.")
    if code == "ResourceNotFoundException" or "model identifier is invalid" in msg.lower():
        return "Model ID not found in this region. Copy the exact ID from the model catalog."
    if code == "UnrecognizedClientException" or "security token" in msg.lower():
        return "AWS credentials missing or wrong. Run `aws configure` with your IAM user's access key."
    return ""


def test_chat(label: str, model_id: str) -> bool:
    if not model_id:
        print(f"[skip] {label}: no model ID set")
        return False
    t = time.time()
    try:
        r = rt.converse(
            modelId=model_id,
            messages=[{"role": "user", "content": [{"text": "Reply with exactly: TrustLens OK"}]}],
            inferenceConfig={"maxTokens": 20, "temperature": 0},
        )
    except ClientError as e:
        print(f"[FAIL] {label} ({model_id}): {e.response['Error']['Code']}: {e.response['Error']['Message']}")
        if hint(e):
            print(f"       -> {hint(e)}")
        return False
    text = r["output"]["message"]["content"][0]["text"].strip()
    u = r.get("usage", {})
    print(f"[ OK ] {label} ({model_id}) in {time.time() - t:.1f}s: {text!r} "
          f"(tokens in {u.get('inputTokens')}, out {u.get('outputTokens')})")
    return True


def test_embed(model_id: str) -> bool:
    if not model_id:
        print("[skip] Embeddings: no model ID set")
        return False
    try:
        r = rt.invoke_model(
            modelId=model_id,
            body=json.dumps({"inputText": "lost credit card replacement fee", "dimensions": DIMS, "normalize": True}),
        )
    except ClientError as e:
        print(f"[FAIL] Embeddings ({model_id}): {e.response['Error']['Code']}: {e.response['Error']['Message']}")
        if hint(e):
            print(f"       -> {hint(e)}")
        return False
    vec = json.loads(r["body"].read())["embedding"]
    print(f"[ OK ] Embeddings ({model_id}): vector of {len(vec)} numbers")
    return True


if __name__ == "__main__":
    print(f"Region: {REGION}\n")
    results = [test_embed(EMBED), test_chat("Model A (answer)", ANSWER), test_chat("Model B (checker)", CHECKER)]
    if ANSWER and CHECKER and ANSWER == CHECKER:
        print("\n[WARN] Model A and Model B are the same model. The checker should be a different model.")
    print("\nAll good." if all(results) else "\nFix the failures above before building the Lambda.")
    sys.exit(0 if all(results) else 1)
