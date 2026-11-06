"""
Thin wrappers around Amazon Bedrock: one embedding call and one chat call.

Every Bedrock failure is raised as BedrockError, so the handler can return
the BEDROCK_ERROR code from docs/api-contract.md.
"""
import json
import os

import boto3
from botocore.config import Config

_client = None


class BedrockError(Exception):
    pass


def client():
    """One Bedrock client per Lambda container, created on first use."""
    global _client
    if _client is None:
        _client = boto3.client(
            "bedrock-runtime",
            region_name=os.getenv("AWS_REGION", "ap-southeast-2"),
            # Lambda times out at 60 s, so keep each call well under that.
            config=Config(connect_timeout=5, read_timeout=20,
                          retries={"max_attempts": 2, "mode": "standard"}),
        )
    return _client


def embed(text):
    """Return the embedding vector for text (normalised, so dot product = cosine)."""
    model = os.environ["EMBEDDING_MODEL_ID"]
    dims = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))
    try:
        r = client().invoke_model(modelId=model, body=json.dumps(
            {"inputText": text[:8000], "dimensions": dims, "normalize": True}))
        return json.loads(r["body"].read())["embedding"]
    except Exception as e:
        raise BedrockError(f"Embedding call to {model} failed: {e}") from e


def chat(model_id, system, user, max_tokens, temperature):
    """Send one system prompt and one user message; return the reply text."""
    try:
        r = client().converse(
            modelId=model_id,
            system=[{"text": system}],
            messages=[{"role": "user", "content": [{"text": user}]}],
            inferenceConfig={"maxTokens": max_tokens, "temperature": temperature},
        )
    except Exception as e:
        raise BedrockError(f"Call to {model_id} failed: {e}") from e
    parts = r["output"]["message"]["content"]
    return "".join(p.get("text", "") for p in parts).strip()
