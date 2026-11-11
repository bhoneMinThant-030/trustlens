# AI service (Python, AWS Lambda)

Owner: Lead

## Files

| File | Purpose |
| --- | --- |
| `handler.py` | Lambda entry point (`handler.lambda_handler`). Retrieves, calls Model A and Model B, scores, returns the contract JSON |
| `retrieve.py` | Loads the index from S3 once per container and ranks chunks by cosine similarity |
| `llm.py` | Bedrock calls: embeddings and chat |
| `checks.py` | Checks done in code: fixed safety wording, and that each quote is really in its cited passage |
| `approved.py` | Reuses reviewer-approved wording. Node sends the approved answers in each request; the Lambda never reads a database |
| `prompts/` | Prompts for Model A (`answer.txt`) and Model B (`check.txt`) |
| `ingest.py` | Builds the search index from `data/knowledge_base/` and uploads it to S3 |
| `run_local.py` | Runs the handler on your machine with real AWS calls |
| `deploy.py` | Zips the code and deploys it to the `trustlens-ai` function |
| `test_models.py` | Checks the three Bedrock models respond |
| `tests/` | Offline tests with fake Bedrock. No AWS, no cost |

## Commands (from the repo root)

```powershell
pip install -r ai/requirements.txt

python -m unittest discover -s ai/tests -v          # offline tests
python ai/run_local.py "Is there a late payment fee?"   # one real question
python ai/run_local.py --json "..."                  # the exact JSON Node receives
python ai/run_local.py --approved data/approved_answers/approved_answers.example.json "What is the late payment fee?"
python ai/deploy.py --smoke "Is there a late payment fee?"   # deploy, then test on Lambda
python ai/ingest.py                                  # rebuild the index after KB changes
```

## How an answer is scored

1. Model A drafts a reply from the retrieved passages only
2. Model B splits it into claims, labels each `supported`, `contradicted` or `insufficient_evidence`, and quotes the passage words behind the label
3. The code checks each quote is really in a passage (numbers and negations must match). Wrong passage cited → the citation moves to the right one. Quote in no passage → the claim drops to `insufficient_evidence`
4. A claim is verified only if a current, official passage supports it
5. `confidence` = verified ÷ all claims, or `0` if Model B says the draft answers a different question

## Settings (ai/.env locally, environment variables on Lambda)

| Key | Default | Meaning |
| --- | --- | --- |
| `TOP_K` | 6 | Passages retrieved per search |
| `MIN_SCORE` | 0.2 | Minimum similarity for a passage to count as a match |
| `MAX_EVIDENCE` | 12 | Passages shown to Model B |
| `ANSWER_SHOWS_METADATA` | false | Let Model A see authority and version (off: TrustLens does that job) |
| `APPROVED_MATCH_MIN` | 0.85 | Minimum similarity to reuse an approved answer |
| `ALSO_FOUND_MIN` | 0.40 | Minimum similarity for an uncited source to be listed (at most 3) |

## Rules

- Output must match the Node → Lambda section of `docs/api-contract.md`
- Model A and Model B are different models; the embedding model never changes without re-running `ingest.py`
- Bedrock, Lambda and S3 stay in one region (ap-southeast-2)
- Lambda timeout 60 s, memory 512 MB
