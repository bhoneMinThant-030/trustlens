# AI service (Python, AWS Lambda)

Owner: Lead

## Planned files

| File | Purpose |
| --- | --- |
| `ingest.py` | Reads `data/knowledge_base/`, embeds each chunk with Bedrock, writes one index file to S3 |
| `handler.py` | Lambda entry point: matches approved answers, retrieves, calls Model A and Model B, computes confidence |
| `retrieve.py` | Loads the S3 index once and runs cosine similarity in plain Python |
| `prompts/` | Prompt text for Model A (answer) and Model B (evaluate) |
| `deploy.sh` | Zips and deploys the Lambda with one command |

## Rules

- Output must match the Node → Lambda section of `docs/api-contract.md`
- Model A and Model B are different models; the embedding model never changes
- Bedrock, Lambda and S3 stay in one region
- Lambda timeout 60 s, memory 512 MB
