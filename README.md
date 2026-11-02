# TrustLens

An internal AI assistant for OCBC customer service officers who reply to customer emails about credit cards. Every answer is checked claim by claim against approved sources and given a confidence score. Low-confidence answers go to a human reviewer.

OCBC Innovation Challenge, Problem Statement 1 (Trusted AI Agents). Presenting 21 Nov 2026.

## Repo layout

| Folder | What lives here | Owner |
| --- | --- | --- |
| `frontend/` | React app: officer screen (inbox + TrustLens panel) and back office | Frontend 1, Frontend 2 |
| `backend/` | Node.js API: database, review workflow, live updates | Backend 1, Backend 2 |
| `ai/` | Python AWS Lambda: retrieval, Model A, Model B, confidence score; `ingest.py` | Lead |
| `data/` | Knowledge base documents, approved answers, mock emails | Everyone (documents), Lead (metadata) |
| `eval/` | Test set and evaluation scripts | Frontend 1, Frontend 2 (questions), Lead (runs) |
| `docs/` | API contract and other shared notes | Lead, Backend 1 |

## Start here

1. Read `docs/api-contract.md`. Everything is built against it
2. Read `CONTRIBUTING.md` for branch and PR rules
3. Follow the README inside your own folder to set up and run your part

## Rules that matter most

- Never commit `.env` files or AWS keys
- Never push to `main`; open a pull request
- Only use public OCBC documents or clearly marked synthetic data; no customer data
