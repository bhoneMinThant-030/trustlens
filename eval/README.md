# Evaluation

Written by Frontend 1 and Frontend 2 (so the people building the AI aren't writing their own exam). Run by the Lead.

## Test set: `test_set.csv`

| Column | Meaning |
| --- | --- |
| `id` | `t001`, `t002`, ... |
| `question` | As a customer would write it in an email |
| `expected_answer` | The correct answer, short |
| `source_doc_id` | The `doc_id` that contains the answer; empty if not in the knowledge base |
| `category` | One of the category slugs |
| `answerable` | `yes` if the knowledge base contains the answer, `no` if it shouldn't be answerable |
| `expect_review` | `yes` if a correct system should send this to a reviewer |
| `written_by` | `fe1` or `fe2` |

Target: 45 questions across the 7 categories. 20 by Sun 8 Nov, all 45 by Wed 11 Nov.

## Metrics (Week 3)

- Flag detection recall: problem answers sent for review ÷ all known problem answers
- False alert rate: good answers sent for review ÷ all known good answers
- Evidence support rate: supported claims ÷ all evaluated claims
