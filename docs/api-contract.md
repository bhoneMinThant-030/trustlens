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
  "question": "Can the annual fee on my card be waived?"
}
```

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
  "latencyMs": 8400
}
```

- `relevance.answersQuestion`: Model B's view on whether the draft addresses what was asked, ignoring whether its facts are right (`true`, `false` or `null` if unknown). `false` sets `confidence` to `0`
- `meta`: for debugging and the evaluation. `retrieval` is the passages found for the question, best first

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

- Approved-answer matching is **off** until the storage for approved answers is decided

### Response: error

```json
{ "requestId": "q_125", "error": { "code": "BEDROCK_ERROR", "message": "Model call timed out" } }
```

Codes: `BAD_REQUEST`, `BEDROCK_ERROR`, `INDEX_NOT_FOUND`, `INDEX_MISMATCH` (index built with a different embedding model), `INTERNAL_ERROR`.

- Errors come back as a normal payload, so Node checks for an `error` key
- A crash or a timeout (60 s) comes back with `FunctionError` set on the invoke result instead. Node treats both as `LAMBDA_FAILED`
- A typical answer takes 5 to 15 s. Show a loading state on the officer screen

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

### `GET /api/stats` (admin)

```json
{
  "pendingTotal": 4,
  "pendingByCategory": [
    { "category": "fees-charges", "count": 2 },
    { "category": "lost-stolen-fraud", "count": 1 },
    { "category": "rewards-cashback", "count": 1 }
  ]
}
```

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

### `POST /api/admin/reset` (admin)

Wipes all data and reloads the demo seed data. Use between demo runs only.

- Requires `X-Role: admin` and the header `X-Confirm-Reset: yes`
- Success: `{ "message": "Database reset to initial seed state." }`
- HTTP 403 `FORBIDDEN` for any other role, HTTP 400 `CONFIRMATION_REQUIRED` without the confirmation header

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
