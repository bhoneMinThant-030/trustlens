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
      "outdated": false,
      "reason": "Matches the 2026 fee schedule, section 3."
    },
    {
      "id": "c2",
      "text": "After that, the fee is waived if you spend $10,000 a year.",
      "label": "insufficient_evidence",
      "sourceId": null,
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

- `confidence` is calculated from the claim labels (e.g. supported ÷ total), between 0 and 1
- `outdated: true` means the cited document has been superseded by a newer version
- `safetyTextAltered: true` means fixed safety wording was changed by the AI

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

### Response: error

```json
{ "requestId": "q_125", "error": { "code": "BEDROCK_ERROR", "message": "Model call timed out" } }
```

Codes: `BEDROCK_ERROR`, `INDEX_NOT_FOUND`, `BAD_REQUEST`.

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

---

## 3. Live events (Socket.io)

| Event | Sent to room | Payload |
| --- | --- | --- |
| `review:new` | `reviewers` | `{ reviewId, category, trigger, question, createdAt }` |
| `review:resolved` | `officer:<officerId>` | `{ reviewId, questionId, emailId, decision, correctedAnswer, reason, reviewer }` |

- Reviewers join `reviewers` on connect; each officer joins `officer:<officerId>`
- Sprint 2: events may be stubbed. Sprint 3: wired to the screens

## Open points for the sync

- Confirm camelCase everywhere (the Lambda outputs camelCase too)
- Confirm the threshold starts at 0.7
- Confirm the demo user headers instead of a login
