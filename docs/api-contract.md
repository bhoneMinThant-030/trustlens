# API contract (DRAFT, to agree at the Mon 2 Nov sync)

Two contracts: **React ↔ Node** (owner: Backend 1) and **Node ↔ Lambda** (owner: Lead). After the sync, any change needs a heads-up in the group chat.

## Conventions

- All JSON keys are **camelCase**, including the Lambda's output
- Dates are ISO 8601 strings, e.g. `2026-11-05T14:02:00+08:00`
- IDs are strings
- No login for the prototype. Requests carry the demo user in headers: `X-User-Id` (e.g. `officer-1`, `reviewer-1`, `admin-1`) and `X-Role` (`officer` | `reviewer` | `admin`)
- Errors always look like: `{ "error": { "code": "LAMBDA_FAILED", "message": "..." } }`

## Shared values

**Category** (one per question):
`applying-eligibility` · `card-types-benefits` · `fees-charges` · `rewards-cashback` · `payments-billing` · `instalments-balance-transfer` · `lost-stolen-fraud` · `uncategorised`

**Claim label:** `supported` · `contradicted` · `insufficient_evidence`

**Review trigger:** `auto_threshold` · `auto_contradiction` · `auto_safety` · `manual`

**Review status:** `pending` · `approved` · `corrected`

---

## 1. Node → Lambda (AI service)

Node invokes the Lambda with the AWS SDK (`InvokeCommand`), not over HTTP.

### Request

```json
{
  "requestId": "q_123",
  "question": "Can the annual fee on my card be waived?",
  "approvedAnswers": [
    { "id": "aa_017", "version": "2", "category": "fees-charges",
      "question": "Is the annual fee waived?", "answer": "The annual fee is waived for the first year ..." }
  ]
}
```

- `question`: at most 2,000 characters
- `approvedAnswers` (optional): reviewer-approved wording. Node builds the list from SQLite `approved_answers` (`query_pattern` → `question`, `approved_text` → `answer`). Store the real question text, not keywords: matching compares questions
- The Lambda never reads a database. No list, or an empty one, means no matching. Broken items are skipped, and at most 200 are used

### Response: generated answer

```json
{
  "requestId": "q_123",
  "type": "generated",
  "answer": "The annual fee is waived for the first year. After that ...",
  "category": "fees-charges",
  "confidence": 0.67,
  "safetyTextAltered": false,
  "claims": [
    {
      "id": "c1",
      "text": "The annual fee is waived for the first year.",
      "label": "supported",
      "sourceId": "card-fees@2026.1#3",
      "quote": "The annual fee is waived for the first year",
      "outdated": false,
      "reason": "Matches the 2026 fee schedule, section 3."
    },
    {
      "id": "c2",
      "text": "After that, the fee is waived if you spend $10,000 a year.",
      "label": "insufficient_evidence",
      "sourceId": null,
      "quote": null,
      "outdated": false,
      "reason": "No retrieved passage mentions a spend-based waiver."
    }
  ],
  "sources": [
    {
      "id": "card-fees@2026.1#3",
      "docId": "card-fees",
      "title": "Credit card fees and charges",
      "version": "2026.1",
      "effectiveDate": "2026-03-01",
      "authority": "official",
      "category": "fees-charges",
      "cited": true,
      "outdated": false,
      "newerVersion": null,
      "excerpt": "The annual fee is waived for the first year ...",
      "url": "https://www.ocbc.com/..."
    }
  ]
}
```

- `confidence` = verified claims ÷ all claims, between 0 and 1, rounded to 2 decimals. A claim is **verified** only when it is `supported` by a **current, official** source. A claim supported only by an outdated or unofficial source counts against the score. No claims at all gives `0`
- `confidence` is also `0` when `relevance.answersQuestion` is `false`: true facts that answer a different question are not a trustworthy answer. Node's threshold rule then sends it to review
- `quote`: the exact words from the cited passage behind the label (`null` for `insufficient_evidence`). A quote may join two parts of a passage with ` ... `. The Lambda checks every quote is really in a passage, with numbers and negations matching exactly. If Model B cited the wrong passage, `sourceId` is moved to the passage that contains the quote. If no passage contains it, the claim is downgraded to `insufficient_evidence`. Screens can highlight the quote inside the source excerpt
- `outdated: true` means the cited document has been superseded by a newer version
- `sources` lists every passage a claim cites (`cited: true`) first, then at most 3 uncited passages that matched the question well (`cited: false`, similarity 0.40 or more). Each source has `outdated` and `newerVersion` (the version that replaced it, or `null`), so screens can badge old documents even when no claim cites them
- `safetyTextAltered: true` means fixed safety wording was changed by the AI
- If no passage in the knowledge base matches the question, or the passages found do not answer it, `answer` says so, `claims` and `sources` are empty and `confidence` is `0`

Two extra fields, also returned (Node can store them; screens can ignore them):

```json
"relevance": { "answersQuestion": true, "reason": "The draft states the annual fee waiver rules asked about." },
"meta": {
  "answerModel": "amazon.nova-lite-v1:0",
  "checkerModel": "amazon.nova-pro-v1:0",
  "indexCreatedAt": "2026-11-06T12:00:00+00:00",
  "retrieval": [ { "id": "card-fees@2026.1#3", "score": 0.612 } ],
  "approvedBestScore": 0.71,
  "latencyMs": 8400
}
```

- `relevance.answersQuestion`: Model B's view on whether the draft addresses what was asked, ignoring whether its facts are right (`true`, `false` or `null` if unknown). `false` sets `confidence` to `0`
- `meta`: for debugging and the evaluation. `retrieval` is the passages found for the question, best first. `approvedBestScore` is the closest approved answer's similarity (`null` when none were sent), kept even when it is below the 0.85 needed for reuse

### Response: approved answer

```json
{
  "requestId": "q_124",
  "type": "approved",
  "answer": "To apply for a credit card, ...",
  "category": "applying-eligibility",
  "confidence": null,
  "safetyTextAltered": false,
  "approvedAnswer": { "id": "aa_apply_card", "version": "2026.1", "matchScore": 0.93 },
  "claims": [],
  "sources": []
}
```

- Returned when the question matches an approved question with a similarity of **0.85 or more**. The wording is reused word for word, both models are skipped, and Node never sends it to review
- `category` comes from the approved answer (`uncategorised` if it is not one of the shared values). `relevance` is `{ "answersQuestion": null, "reason": "" }`
- If the approved list causes any error, the Lambda answers normally instead of failing

### Response: error

```json
{ "requestId": "q_125", "error": { "code": "BEDROCK_ERROR", "message": "Model call timed out" } }
```

Codes: `BAD_REQUEST`, `BEDROCK_ERROR`, `INDEX_NOT_FOUND`, `INDEX_MISMATCH` (index built with a different embedding model), `INTERNAL_ERROR`.

- Errors come back as a normal payload, so Node checks for an `error` key
- A crash or a timeout (60 s) comes back with `FunctionError` set on the invoke result instead. Node treats both as `LAMBDA_FAILED`
- A typical answer takes 1 to 15 s (an approved answer about 1 s). Show a loading state on the officer screen

---

## 2. React ↔ Node

### `POST /api/ask` (officer)

Request:

```json
{ "emailId": "em_003", "question": "Can the annual fee on my card be waived?" }
```

Response: the Lambda response plus what Node adds.

```json
{
  "questionId": "q_123",
  "answerId": "a_123",
  "emailId": "em_003",
  "type": "generated",
  "answer": "...",
  "category": "fees-charges",
  "confidence": 0.67,
  "claims": [ "...same shape as Lambda..." ],
  "sources": [ "...same shape as Lambda..." ],
  "review": { "status": "pending", "trigger": "auto_threshold", "reviewId": "r_045" }
}
```

- `review` is `null` when no review is needed
- Node's routing rule: send to review if `confidence < threshold` (config, starts at `0.7`), or any claim is `contradicted`, or `safetyTextAltered` is `true`. Approved answers are never auto-routed
- If the Lambda fails, Node returns HTTP 502 with `LAMBDA_FAILED`

### `POST /api/answers/:answerId/review` (officer sends manually)

Request: `{ "note": "Customer is asking about a supplementary card, not sure" }` (optional)

Response: `{ "reviewId": "r_046", "status": "pending", "trigger": "manual" }`

### `GET /api/reviews?status=pending` (reviewer)

Response: `{ "reviews": [ Review, ... ] }`

### `GET /api/reviews/:reviewId` (reviewer)

Response: one `Review`:

```json
{
  "id": "r_045",
  "questionId": "q_123",
  "answerId": "a_123",
  "emailId": "em_003",
  "officerId": "officer-1",
  "question": "Can the annual fee on my card be waived?",
  "answer": "...",
  "confidence": 0.67,
  "category": "fees-charges",
  "claims": [ "..." ],
  "sources": [ "..." ],
  "trigger": "auto_threshold",
  "note": null,
  "status": "pending",
  "createdAt": "2026-11-05T14:02:00+08:00",
  "decision": null
}
```

### `POST /api/reviews/:reviewId/decision` (reviewer)

Request:

```json
{
  "decision": "corrected",
  "correctedAnswer": "The annual fee is waived for the first year only.",
  "reason": "No spend-based waiver exists in the 2026 fee schedule."
}
```

- `decision` is `approved` or `corrected`; `correctedAnswer` is required only for `corrected`
- The reviewer comes from the `X-User-Id` header

Response: the updated `Review`, with:

```json
"decision": {
  "decision": "corrected",
  "correctedAnswer": "...",
  "reason": "...",
  "reviewer": "reviewer-1",
  "decidedAt": "2026-11-05T14:20:00+08:00"
}
```

- A correction does not overwrite the AI draft. The draft stays as the review's `answer`; the reviewer's text is `decision.correctedAnswer`, and the officer's answer endpoints return the corrected text

### `GET /api/stats` (admin)

Totals and per-category counts for the Dashboard. Seeded and live answers both count. There is no time window yet.

```json
{
  "pendingTotal": 4,
  "pendingByCategory": [
    { "category": "lost-stolen-fraud", "count": 2 },
    { "category": "rewards-cashback", "count": 1 },
    { "category": "fees-charges", "count": 1 }
  ],
  "answeredTotal": 8,
  "reviewedTotal": 5,
  "resolvedTotal": 1,
  "byCategory": [
    {
      "category": "lost-stolen-fraud",
      "answered": 2,
      "sentToReview": 2,
      "pending": 2,
      "failures": { "contradicted": 2, "insufficientEvidence": 0, "outdated": 1, "safety": 1, "manual": 0 }
    }
  ]
}
```

- `answeredTotal`: answers generated. `reviewedTotal`: answers sent to review (any status). `resolvedTotal`: reviews approved or corrected
- `byCategory` always has 8 rows (the 7 categories plus `uncategorised`), in the order of the shared category list (one row shown above). Categories come from the question, the same as `pendingByCategory` and the review queue
- `failures` count answers sent to review that have: a `contradicted` claim, an `insufficient_evidence` claim, an outdated claim, altered safety text, or a `manual` trigger. One answer can count in several columns

### `GET /api/officer/emails` (officer)

Inbox list. Every email, with its answer status if one exists.

```json
{
  "emails": [
    {
      "id": "em_001",
      "questionId": "em_001",
      "emailId": "em_001",
      "officerId": "officer-1",
      "customerName": "Tan Wei Ming",
      "customerEmail": "weiming@example.com",
      "cardType": "OCBC 365 Card",
      "category": "rewards-cashback",
      "question": "...",
      "createdAt": "2026-11-05T09:12:00+08:00",
      "answerId": "a_001",
      "status": "pending_review",
      "confidence": 0.62,
      "review": { "reviewId": "r_001", "status": "pending", "trigger": "auto_threshold" }
    }
  ]
}
```

- `answerId`, `status` and `confidence` are `null` while the email has no answer yet (the officer can click Generate)
- `review` is `null` when the answer has no review
- `status` is an answer status: `pending_review` · `approved` · `reviewed_approved` · `reviewed_corrected`

### `GET /api/officer/emails/:emailId/answer` (officer)

The stored answer for one email, in the same shape as the `POST /api/ask` response (including `review`).

- HTTP 404 with `NOT_FOUND` if the email has no answer yet

### `GET /api/dashboard/categories` (admin)

Metrics for every category, including `uncategorised`. Counts include both seeded and live answers.

```json
{
  "summary": { "totalItems": 12, "totalPending": 5 },
  "categories": [
    {
      "category": "fees-charges",
      "totalQueries": 3,
      "pendingReviews": 1,
      "reviewedCount": 1,
      "autoApprovedCount": 1,
      "reviewRatePct": 67
    }
  ]
}
```

- `categories` always has 8 entries (the 7 categories plus `uncategorised`), even when a count is 0
- `reviewRatePct` = (`pendingReviews` + `reviewedCount`) / `totalQueries`, rounded, `0` when there are no queries

### `GET /api/flagged-documents` (admin)

Every unofficial or outdated document that appeared in an answer a reviewer corrected. Built from stored reviews and answers, no extra table.

Rule: take every review decided `corrected`, read that answer's `sources`, and flag each source with `authority: "unofficial"` or `outdated: true`, whether cited or only also found. Claim labels are not used, because a contradicted claim usually cites the official document that proves it wrong. Group by `docId` + `version`, count corrections, sort by most corrections, then most recent.

```json
{
  "flaggedDocuments": [
    {
      "docId": "365-cashback-staff-quick-reference",
      "version": "2026.10",
      "title": "Staff quick reference: OCBC 365 cashback",
      "category": "rewards-cashback",
      "reason": "unofficial",
      "newerVersion": null,
      "corrections": 1,
      "lastFlaggedAt": "2026-11-21T10:42:00+08:00",
      "excerpt": "The OCBC 365 card has a monthly cashback cap of S$250 ...",
      "evidence": [
        {
          "reviewId": "r_041",
          "question": "What is the monthly cashback cap on the OCBC 365 card?",
          "aiAnswer": "The monthly cashback cap is S$250.",
          "correctedAnswer": "Cashback is capped at S$160 per month.",
          "reviewer": "reviewer-1",
          "decidedAt": "2026-11-21T10:42:00+08:00",
          "officialSources": [
            { "id": "365-cashback-tncs@2026.11#3", "title": "...", "version": "2026.11", "excerpt": "..." }
          ]
        }
      ]
    }
  ]
}
```

- `reason` is `unofficial` or `outdated` (unofficial wins if both). `newerVersion` comes from the source, `null` when unknown
- `officialSources` are the official, current sources in the same answer, so the admin can compare
- `aiAnswer` is the AI's original draft (corrections no longer overwrite it)
- A document with several passages in one answer counts that correction once. `evidence` is newest first
- Empty list (`{ "flaggedDocuments": [] }`) until a reviewer corrects an answer

### `POST /api/admin/reset` (admin)

Wipes all data and reloads the demo seed data. Use between demo runs only.

- Requires `X-Role: admin` and the header `X-Confirm-Reset: yes`
- Success: `{ "message": "Database reset to initial seed state." }`
- HTTP 403 `FORBIDDEN` for any other role, HTTP 400 `CONFIRMATION_REQUIRED` without the confirmation header

### `POST /api/admin/reset/:emailId` (admin)

Puts one email back to Not Checked, so Generate can be tested again. Deletes that email's answer, claims and review and keeps the email in the inbox. Every other email is untouched.

- Same headers as the full reset: `X-Role: admin` and `X-Confirm-Reset: yes`
- Success: `{ "emailId": "em_009", "removedAnswers": 1, "removedReviews": 1, "message": "em_009 is back to Not Checked." }`
- HTTP 409 `SEEDED_EMAIL` for emails whose answer is part of the seed (em_001 to em_008): use the full reset for those
- HTTP 404 `NOT_FOUND` for an unknown email, 403 and 400 as for the full reset

---

## 3. Live events (Socket.io)

| Event | Sent to room | Payload |
| --- | --- | --- |
| `review:new` | `reviewers` | `{ reviewId, category, trigger, question, createdAt }` |
| `review:resolved` | `officer:<officerId>` | `{ reviewId, questionId, emailId, decision, correctedAnswer, reason, reviewer }` |

- Reviewers join `reviewers` on connect (`io(url, { query: { role: "reviewer" } })`); each officer joins `officer:<officerId>` (`io(url, { query: { userId: "officer-1" } })`)
- Sprint 2: events may be stubbed. Sprint 3: wired to the screens

## Open points for the sync

- Confirm camelCase everywhere (the Lambda outputs camelCase too)
- Confirm the threshold starts at 0.7
- Confirm the demo user headers instead of a login
