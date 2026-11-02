# Data

Only public OCBC documents or clearly marked synthetic data. No customer data.

| Folder | Contents | Owner |
| --- | --- | --- |
| `knowledge_base/<category>/` | One markdown file per document, with metadata at the top | Everyone collects; Lead checks metadata |
| `approved_answers/` | Pre-approved, word-for-word answers for standard questions | Lead |
| `emails/` | Synthetic customer emails for the mock inbox | Frontend 1 |
| `templates/` | Copy `document-template.md` to start a new document | — |

## Document metadata (required)

| Field | Example | Notes |
| --- | --- | --- |
| `doc_id` | `card-fees` | Same for every version of one document |
| `title` | `Credit card fees and charges` | |
| `category` | `fees-charges` | One of the folder names |
| `version` | `"2026.1"` | Keep the quotes |
| `effective_date` | `2026-03-01` | From the document; if none, the date accessed |
| `authority` | `official` | `official` or `unofficial` |
| `supersedes` | `card-fees-v2025` | Leave empty if none |
| `source_url` | `https://www.ocbc.com/...` | The page you copied from |
| `accessed` | `2026-11-02` | When you copied it |
| `synthetic` | `false` | `true` for anything we wrote or changed |

## File naming

`<doc_id>-v<version>.md`, e.g. `card-fees-v2026.1.md`
