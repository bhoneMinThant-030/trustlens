"""
ingest.py - build the TrustLens search index and upload it to S3.

Usage (from the repo root):
  python ai/ingest.py --dry-run     # check metadata and chunks; no AWS calls, no cost
  python ai/ingest.py --local       # embed and write ai/index.json only (for testing)
  python ai/ingest.py               # embed and upload the index to S3

Reads documents from data/knowledge_base/<category>/*.md. Each file starts with
YAML metadata (see data/README.md). Settings come from ai/.env.

Freshness: documents that share a doc_id are versions of the same document.
The one with the latest effective_date is current; older versions are kept in
the index (the demo needs them) but marked isCurrent: false.
"""
import argparse
import json
import os
import re
import sys
from datetime import date, datetime, timezone
from pathlib import Path

import yaml

AI_DIR = Path(__file__).resolve().parent
REPO = AI_DIR.parent
KB_DIR = REPO / "data" / "knowledge_base"
MAX_WORDS = 400

REQUIRED = ["doc_id", "title", "category", "version", "effective_date", "authority"]
CATEGORIES = {
    "applying-eligibility", "card-types-benefits", "fees-charges", "rewards-cashback",
    "payments-billing", "instalments-balance-transfer", "lost-stolen-fraud",
}
AUTHORITIES = {"official", "unofficial"}


# ---------- reading and checking documents ----------

def load_doc(path: Path):
    text = path.read_text(encoding="utf-8")
    m = re.match(r"^---\s*\n(.*?)\n---\s*\n(.*)$", text, re.S)
    if not m:
        raise ValueError("missing the --- metadata block at the top")
    meta = yaml.safe_load(m.group(1)) or {}
    missing = [k for k in REQUIRED if meta.get(k) in (None, "")]
    if missing:
        raise ValueError(f"missing metadata: {', '.join(missing)}")
    if meta["category"] not in CATEGORIES:
        raise ValueError(f"unknown category '{meta['category']}'")
    if meta["authority"] not in AUTHORITIES:
        raise ValueError(f"authority must be official or unofficial, not '{meta['authority']}'")
    if path.parent.name != meta["category"]:
        raise ValueError(f"file is in folder '{path.parent.name}' but category is '{meta['category']}'")
    meta["version"] = str(meta["version"])
    for k in ("effective_date", "accessed"):
        if isinstance(meta.get(k), (date, datetime)):
            meta[k] = meta[k].isoformat()
    meta["synthetic"] = bool(meta.get("synthetic", False))
    return meta, m.group(2)


def split_sections(body: str):
    sections, current, heading = [], [], ""
    for line in body.splitlines():
        h = re.match(r"^(#{1,3})\s+(.*)", line)
        if h:
            if "\n".join(current).strip():
                sections.append((heading, "\n".join(current).strip()))
            heading, current = h.group(2).strip(), []
        else:
            current.append(line)
    if "\n".join(current).strip():
        sections.append((heading, "\n".join(current).strip()))
    return sections


def split_long(text: str, max_words: int):
    paras = [p.strip() for p in re.split(r"\n\s*\n", text) if p.strip()]
    chunks, buf = [], []
    for p in paras:
        if buf and len(" ".join(buf + [p]).split()) > max_words:
            chunks.append("\n\n".join(buf))
            buf = []
        buf.append(p)
    if buf:
        chunks.append("\n\n".join(buf))
    return chunks


def build():
    files = sorted(p for p in KB_DIR.rglob("*.md"))
    if not files:
        sys.exit(f"No .md documents found under {KB_DIR}")

    docs, errors = [], []
    for path in files:
        try:
            meta, body = load_doc(path)
            docs.append((path, meta, body))
        except Exception as e:  # collect every problem, then stop
            errors.append(f"  {path.relative_to(REPO)}: {e}")
    if errors:
        sys.exit("Fix these documents first:\n" + "\n".join(errors))

    seen = set()
    for _, meta, _ in docs:
        key = (meta["doc_id"], meta["version"])
        if key in seen:
            sys.exit(f"Duplicate doc_id + version: {key}")
        seen.add(key)

    # latest effective_date per doc_id is current
    latest = {}
    for _, meta, _ in docs:
        d = meta["doc_id"]
        if d not in latest or meta["effective_date"] > latest[d]["effective_date"]:
            latest[d] = meta

    documents, chunks = [], []
    for path, meta, body in docs:
        is_current = latest[meta["doc_id"]] is meta
        newer = None if is_current else latest[meta["doc_id"]]["version"]
        documents.append({
            "docId": meta["doc_id"], "title": meta["title"], "category": meta["category"],
            "version": meta["version"], "effectiveDate": meta["effective_date"],
            "authority": meta["authority"], "sourceUrl": meta.get("source_url") or "",
            "synthetic": meta["synthetic"], "isCurrent": is_current, "newerVersion": newer,
            "file": str(path.relative_to(REPO)).replace("\\", "/"),
        })
        n = 0
        for heading, text in split_sections(body):
            for part in split_long(text, MAX_WORDS):
                n += 1
                title_line = f"{meta['title']} - {heading}" if heading else meta["title"]
                chunks.append({
                    "id": f"{meta['doc_id']}@{meta['version']}#{n}",
                    "docId": meta["doc_id"], "title": meta["title"], "section": heading,
                    "category": meta["category"], "version": meta["version"],
                    "effectiveDate": meta["effective_date"], "authority": meta["authority"],
                    "sourceUrl": meta.get("source_url") or "", "synthetic": meta["synthetic"],
                    "isCurrent": is_current, "newerVersion": newer,
                    "text": f"{title_line}\n\n{part}",
                })
    return documents, chunks


# ---------- embedding and upload ----------

def embed_all(chunks, model_id, dims, region):
    import boto3
    from botocore.config import Config

    rt = boto3.client("bedrock-runtime", region_name=region,
                      config=Config(retries={"max_attempts": 8, "mode": "adaptive"}))
    for i, c in enumerate(chunks, 1):
        r = rt.invoke_model(modelId=model_id, body=json.dumps(
            {"inputText": c["text"], "dimensions": dims, "normalize": True}))
        c["embedding"] = [round(x, 6) for x in json.loads(r["body"].read())["embedding"]]
        if i % 10 == 0 or i == len(chunks):
            print(f"  embedded {i}/{len(chunks)}")


def main():
    ap = argparse.ArgumentParser()
    g = ap.add_mutually_exclusive_group()
    g.add_argument("--dry-run", action="store_true", help="check documents and chunks; no AWS calls")
    g.add_argument("--local", action="store_true", help="write ai/index.json instead of uploading to S3")
    args = ap.parse_args()

    documents, chunks = build()
    outdated = sum(1 for d in documents if not d["isCurrent"])
    print(f"{len(documents)} documents ({outdated} outdated versions), {len(chunks)} chunks")

    if args.dry_run:
        for c in chunks:
            flag = "" if c["isCurrent"] else f"  [OUTDATED -> v{c['newerVersion']}]"
            print(f"\n--- {c['id']}  ({len(c['text'].split())} words)  {c['category']} | {c['authority']}{flag}")
            print(c["text"][:240] + ("..." if len(c["text"]) > 240 else ""))
        return

    from dotenv import load_dotenv
    load_dotenv(AI_DIR / ".env")
    region = os.getenv("AWS_REGION", "ap-southeast-2")
    model_id = os.environ["EMBEDDING_MODEL_ID"]
    dims = int(os.getenv("EMBEDDING_DIMENSIONS", "1024"))

    print(f"Embedding with {model_id} ({dims} dims) in {region}...")
    embed_all(chunks, model_id, dims, region)

    index = {
        "createdAt": datetime.now(timezone.utc).isoformat(timespec="seconds"),
        "embeddingModel": model_id, "dimensions": dims,
        "documents": documents, "chunks": chunks,
    }
    data = json.dumps(index, ensure_ascii=False).encode("utf-8")

    if args.local:
        out = AI_DIR / "index.json"
        out.write_bytes(data)
        print(f"Wrote {out.relative_to(REPO)} ({len(data) / 1e6:.1f} MB)")
        return

    import boto3
    bucket, key = os.environ["S3_BUCKET"], os.getenv("S3_INDEX_KEY", "index.json")
    boto3.client("s3", region_name=region).put_object(
        Bucket=bucket, Key=key, Body=data, ContentType="application/json")
    print(f"Uploaded s3://{bucket}/{key} ({len(data) / 1e6:.1f} MB)")


if __name__ == "__main__":
    main()
