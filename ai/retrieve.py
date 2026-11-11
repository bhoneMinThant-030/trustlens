"""
The knowledge-base search index: load it once per Lambda container, then rank
chunks by cosine similarity in plain Python (117 chunks takes milliseconds).

Where the index comes from:
  - INDEX_PATH set   -> a local file (from: python ai/ingest.py --local)
  - otherwise        -> s3://S3_BUCKET/S3_INDEX_KEY (written by ai/ingest.py)
"""
import json
import os

import boto3
from botocore.exceptions import ClientError

_index = None


class IndexNotFound(Exception):
    pass


class IndexMismatch(Exception):
    pass


def reset():
    """Forget the cached index (used by tests)."""
    global _index
    _index = None


def load():
    global _index
    if _index is not None:
        return _index

    data = _read()
    model = os.environ["EMBEDDING_MODEL_ID"]
    dims = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))
    if data.get("embeddingModel") != model or int(data.get("dimensions", 0)) != dims:
        raise IndexMismatch(
            f"The index was built with {data.get('embeddingModel')} ({data.get('dimensions')} dims) "
            f"but this function uses {model} ({dims} dims). Re-run: python ai/ingest.py")

    chunks = [c for c in data.get("chunks", []) if len(c.get("embedding") or []) == dims]
    if not chunks:
        raise IndexNotFound("The index has no chunks with embeddings. Re-run: python ai/ingest.py")

    _index = {"chunks": chunks, "createdAt": data.get("createdAt")}
    return _index


def _read():
    path = os.getenv("INDEX_PATH")
    if path:
        try:
            with open(path, encoding="utf-8") as f:
                return json.load(f)
        except FileNotFoundError:
            raise IndexNotFound(f"No index file at {path}. Run: python ai/ingest.py --local")

    bucket = os.getenv("S3_BUCKET")
    key = os.getenv("S3_INDEX_KEY", "index.json")
    if not bucket:
        raise IndexNotFound("S3_BUCKET is not set")
    try:
        s3 = boto3.client("s3", region_name=os.getenv("AWS_REGION", "ap-southeast-2"))
        return json.loads(s3.get_object(Bucket=bucket, Key=key)["Body"].read())
    except ClientError as e:
        code = e.response.get("Error", {}).get("Code", "")
        # Without s3:ListBucket, S3 reports a missing object as AccessDenied.
        if code in ("NoSuchKey", "NoSuchBucket", "AccessDenied", "403", "404"):
            raise IndexNotFound(f"Could not read s3://{bucket}/{key} ({code}). "
                                f"Check the bucket name and run: python ai/ingest.py")
        raise


def dot(a, b):
    return sum(x * y for x, y in zip(a, b))


def search(vector, k, min_score=-1.0, where=None):
    """Return up to k (score, chunk) pairs, best first, with score >= min_score."""
    scored = []
    for chunk in load()["chunks"]:
        if where is not None and not where(chunk):
            continue
        score = dot(vector, chunk["embedding"])
        if score >= min_score:
            scored.append((score, chunk))
    scored.sort(key=lambda pair: pair[0], reverse=True)
    return scored[:k]
