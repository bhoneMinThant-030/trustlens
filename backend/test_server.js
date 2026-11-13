/**
 * TrustLens Backend Integration Test Suite
 * Executes in-process against Express without requiring open TCP ports.
 */
const { app } = require("./server");
const { resetSeedData, db } = require("./db");
const { saveAskResult } = require("./services/saveAskResult");

function mockRequest(app, method, url, body = null, headers = {}) {
  return new Promise((resolve) => {
    const defaultHeaders = {
      "content-type": "application/json",
      accept: "application/json",
      ...headers
    };

    const req = {
      method,
      url,
      headers: defaultHeaders,
      body: body || {},
      query: {},
      params: {}
    };

    let statusCode = 200;
    let resHeaders = {};
    let responseBody = "";

    const res = {
      setHeader(k, v) {
        resHeaders[k.toLowerCase()] = v;
      },
      getHeader(k) {
        return resHeaders[k.toLowerCase()];
      },
      status(code) {
        statusCode = code;
        return this;
      },
      send(data) {
        responseBody = data;
        this.end();
      },
      json(data) {
        this.setHeader("content-type", "application/json");
        responseBody = JSON.stringify(data);
        this.end();
      },
      end() {
        let parsed = responseBody;
        try {
          parsed = JSON.parse(responseBody);
        } catch (e) {}

        resolve({
          status: statusCode,
          headers: resHeaders,
          body: parsed
        });
      }
    };

    app.handle(req, res);
  });
}

async function runTests() {
  console.log("=================================================");
  console.log(" TRUSTLENS BACKEND 2 INTEGRATION TEST SUITE ");
  console.log("=================================================\n");

  let passed = 0;
  let failed = 0;

  function assert(condition, testName, detail = "") {
    if (condition) {
      console.log(`PASS: ${testName}`);
      passed++;
    } else {
      console.error(`FAIL: ${testName} - ${detail}`);
      failed++;
    }
  }

  // Always reset to clean seed data before running tests
  resetSeedData();

  // Test 1: Fetch Pending Reviews Queue
  const t1 = await mockRequest(app, "GET", "/api/reviews?status=pending");
  assert(
    t1.status === 200 && Array.isArray(t1.body.reviews) && t1.body.reviews.length >= 4,
    "GET /api/reviews?status=pending returns pending reviews",
    `Got status ${t1.status}, count: ${t1.body.reviews?.length}`
  );

  // Test 2: Fetch Single Review Detail
  const t2 = await mockRequest(app, "GET", "/api/reviews/r_041");
  assert(
    t2.status === 200 &&
      t2.body.id === "r_041" &&
      t2.body.category === "rewards-cashback" &&
      t2.body.claims?.length > 0 &&
      t2.body.trigger === "auto_contradiction",
    "GET /api/reviews/:reviewId returns complete review object with claims",
    JSON.stringify(t2.body)
  );

  // Test 3: Reviewer Approves Flagged Review
  const t3 = await mockRequest(
    app,
    "POST",
    "/api/reviews/r_041/decision",
    {
      decision: "approved",
      reason: "Verified exceptional promotion applies."
    },
    { "x-user-id": "reviewer-1", "x-role": "reviewer" }
  );
  assert(
    t3.status === 200 &&
      t3.body.status === "approved" &&
      t3.body.decision?.decision === "approved" &&
      t3.body.decision?.reviewer === "reviewer-1",
    "POST /api/reviews/:reviewId/decision can approve review",
    JSON.stringify(t3.body)
  );

  // Test 4: Prevent Duplicate Decision (409 ALREADY_DECIDED)
  const t4 = await mockRequest(
    app,
    "POST",
    "/api/reviews/r_041/decision",
    { decision: "approved", reason: "Trying again" },
    { "x-user-id": "reviewer-1" }
  );
  assert(
    t4.status === 409 && t4.body.error?.code === "ALREADY_DECIDED",
    "POST /api/reviews/:reviewId/decision rejects duplicate decision with 409 ALREADY_DECIDED",
    `Status: ${t4.status}`
  );

  // Test 5: Reviewer Submits Policy Correction
  const t5 = await mockRequest(
    app,
    "POST",
    "/api/reviews/r_042/decision",
    {
      decision: "corrected",
      correctedAnswer: "The OCBC VOYAGE Card annual fee is strictly non-waivable per policy.",
      reason: "Corrected inaccurate waiver claim."
    },
    { "x-user-id": "reviewer-1", "x-role": "reviewer" }
  );
  assert(
    t5.status === 200 &&
      t5.body.status === "corrected" &&
      t5.body.decision?.decision === "corrected" &&
      t5.body.decision?.correctedAnswer.includes("strictly non-waivable"),
    "POST /api/reviews/:reviewId/decision can submit corrected answer",
    JSON.stringify(t5.body)
  );

  // Test 6: Validate Missing Corrected Answer (400 BAD_REQUEST)
  const t6 = await mockRequest(
    app,
    "POST",
    "/api/reviews/r_043/decision",
    { decision: "corrected", correctedAnswer: "", reason: "Forgot answer" },
    { "x-user-id": "reviewer-1" }
  );
  assert(
    t6.status === 400 && t6.body.error?.code === "BAD_REQUEST",
    "POST /api/reviews/:reviewId/decision enforces correctedAnswer when decision=corrected",
    `Status: ${t6.status}`
  );

  // Test 7: Officer Manual Escalation
  const t7 = await mockRequest(
    app,
    "POST",
    "/api/answers/a_106/review",
    { note: "Customer asking unusual question; please review" },
    { "x-user-id": "officer-1", "x-role": "officer" }
  );
  assert(
    t7.status === 200 && t7.body.trigger === "manual" && t7.body.status === "pending",
    "POST /api/answers/:answerId/review manually sends answer to review queue",
    JSON.stringify(t7.body)
  );

  // Test 8: Admin Stats Breakdown
  const t8 = await mockRequest(app, "GET", "/api/stats", null, {
    "x-user-id": "admin-1",
    "x-role": "admin"
  });
  assert(
    t8.status === 200 &&
      typeof t8.body.pendingTotal === "number" &&
      Array.isArray(t8.body.pendingByCategory) &&
      t8.body.pendingByCategory.length > 0,
    "GET /api/stats returns pendingTotal and pendingByCategory breakdown",
    JSON.stringify(t8.body)
  );

  // Test 9: Officer Ask Endpoint
  const t9 = await mockRequest(app, "POST", "/api/ask", {
    emailId: "em_test_01",
    question: "Can the annual fee on my card be waived?"
  });
  assert(
    t9.status === 200 &&
      t9.body.questionId &&
      t9.body.answerId &&
      typeof t9.body.confidence === "number" &&
      t9.body.review !== undefined,
    "POST /api/ask returns evaluated answer and review routing",
    JSON.stringify(t9.body)
  );

  // Test 10: Admin Reset is blocked for non-admins and without confirmation
  const t10a = await mockRequest(app, "POST", "/api/admin/reset", null, {
    "x-user-id": "officer-1",
    "x-role": "officer",
    "x-confirm-reset": "yes"
  });
  const t10b = await mockRequest(app, "POST", "/api/admin/reset", null, {
    "x-user-id": "admin-1",
    "x-role": "admin"
  });
  assert(
    t10a.status === 403 && t10b.status === 400,
    "POST /api/admin/reset rejects non-admins (403) and missing confirmation (400)",
    JSON.stringify([t10a.body, t10b.body])
  );

  // Test 11: Admin Reset works for admin with confirmation
  const t11 = await mockRequest(app, "POST", "/api/admin/reset", null, {
    "x-user-id": "admin-1",
    "x-role": "admin",
    "x-confirm-reset": "yes"
  });
  assert(
    t11.status === 200 && t11.body.message?.includes("reset"),
    "POST /api/admin/reset resets database state cleanly for confirmed admin",
    JSON.stringify(t11.body)
  );

  // Test 12: Dashboard lists uncategorised so totals add up
  const t12 = await mockRequest(app, "GET", "/api/dashboard/categories", null, {
    "x-user-id": "admin-1",
    "x-role": "admin"
  });
  assert(
    t12.status === 200 &&
      Array.isArray(t12.body.categories) &&
      t12.body.categories.length === 8 &&
      t12.body.categories.some((c) => c.category === "uncategorised"),
    "GET /api/dashboard/categories includes the uncategorised row (8 categories)",
    JSON.stringify(t12.body)
  );

  // Test 13: Demo seed has unanswered emails for Generate live, all owned by officer-1
  resetSeedData();
  const t13 = await mockRequest(app, "GET", "/api/officer/emails", null, {
    "x-user-id": "officer-1",
    "x-role": "officer"
  });
  const emails = t13.body.emails || [];
  const unanswered = emails.filter((e) => !e.answerId).map((e) => e.emailId).sort();
  assert(
    t13.status === 200 &&
      emails.length === 13 &&
      JSON.stringify(unanswered) === JSON.stringify(["em_009", "em_010", "em_011", "em_012", "em_013"]) &&
      emails.every((e) => e.officerId === "officer-1"),
    "Demo seed: 13 emails, em_009 to em_013 unanswered, all owned by officer-1",
    JSON.stringify({ count: emails.length, unanswered, officers: [...new Set(emails.map((e) => e.officerId))] })
  );

  // Test 14: Approved answers seed has the late fee answer and never the 365 cashback trap
  const approvedRows = db.prepare("SELECT id, category, query_pattern FROM approved_answers").all();
  assert(
    approvedRows.length === 1 &&
      approvedRows[0].id === "aa_late_fee" &&
      !approvedRows.some((r) => r.category === "rewards-cashback"),
    "Approved answers seed: only aa_late_fee, no 365 cashback answer",
    JSON.stringify(approvedRows)
  );

  // Test 15: Correcting a review keeps the AI draft; the officer sees the correction
  resetSeedData();
  const answerIdOf = (rid) => db.prepare("SELECT answer_id FROM reviews WHERE id = ?").get(rid).answer_id;
  const draft = db.prepare("SELECT answer FROM answers WHERE id = ?").get(answerIdOf("r_042")).answer;
  await mockRequest(app, "POST", "/api/reviews/r_042/decision", {
    decision: "corrected",
    correctedAnswer: "Corrected by reviewer."
  }, { "x-user-id": "reviewer-1", "x-role": "reviewer" });
  const stored = db.prepare("SELECT answer, status FROM answers WHERE id = ?").get(answerIdOf("r_042"));
  const officerView = await mockRequest(app, "GET", "/api/officer/emails/em_002/answer", null, {
    "x-user-id": "officer-1",
    "x-role": "officer"
  });
  assert(
    stored.answer === draft &&
      stored.status === "reviewed_corrected" &&
      officerView.body.answer === "Corrected by reviewer.",
    "Correct keeps the AI draft in answers and shows the correction to the officer",
    JSON.stringify({ stored, officerAnswer: officerView.body.answer })
  );

  // Test 15b: Re-escalating a corrected answer and approving it keeps the correction
  await mockRequest(app, "POST", `/api/answers/${answerIdOf("r_042")}/review`, { note: "check again" }, {
    "x-user-id": "officer-1",
    "x-role": "officer"
  });
  await mockRequest(app, "POST", "/api/reviews/r_042/decision", { decision: "approved" }, {
    "x-user-id": "reviewer-1",
    "x-role": "reviewer"
  });
  const afterReapprove = await mockRequest(app, "GET", "/api/officer/emails/em_002/answer", null, {
    "x-user-id": "officer-1",
    "x-role": "officer"
  });
  assert(
    afterReapprove.body.answer === "Corrected by reviewer.",
    "Approving a re-escalated corrected answer keeps the reviewer's correction",
    JSON.stringify({ officerAnswer: afterReapprove.body.answer })
  );

  // Test 16: /api/stats has the dashboard totals and 8 byCategory rows
  const t16 = await mockRequest(app, "GET", "/api/stats", null, { "x-user-id": "admin-1", "x-role": "admin" });
  const st = t16.body;
  const failureKeys = JSON.stringify(["contradicted", "insufficientEvidence", "manual", "outdated", "safety"]);
  assert(
    t16.status === 200 &&
      st.answeredTotal === 8 &&
      st.reviewedTotal === 5 &&
      st.resolvedTotal === 1 &&
      st.pendingTotal === 4 &&
      Array.isArray(st.byCategory) &&
      st.byCategory.length === 8 &&
      st.byCategory.every((r) =>
        typeof r.answered === "number" &&
        typeof r.sentToReview === "number" &&
        typeof r.pending === "number" &&
        JSON.stringify(Object.keys(r.failures).sort()) === failureKeys
      ),
    "GET /api/stats returns answeredTotal, reviewedTotal, resolvedTotal and byCategory",
    JSON.stringify(st)
  );

  // Test 17: Reset clears live answers and reviews, not just the seeded ones
  saveAskResult({
    questionId: "q_live_test",
    answerId: "a_live_test",
    emailId: "em_013",
    question: "Can I use my credit card to buy cryptocurrency?",
    reviewTrigger: "auto_threshold",
    lambdaResponse: {
      type: "generated",
      answer: "Live answer.",
      category: "uncategorised",
      confidence: 0.2,
      claims: [{ text: "claim", label: "insufficient_evidence" }],
      sources: []
    }
  });
  saveAskResult({
    questionId: "q_new_test",
    answerId: "a_new_test",
    emailId: "em_new_test",
    question: "A brand new email",
    reviewTrigger: null,
    lambdaResponse: { type: "generated", answer: "New.", category: "fees-charges", confidence: 0.9, claims: [], sources: [] }
  });
  const t17 = await mockRequest(app, "POST", "/api/admin/reset", null, {
    "x-user-id": "admin-1",
    "x-role": "admin",
    "x-confirm-reset": "yes"
  });
  const count = (table) => db.prepare(`SELECT COUNT(*) AS n FROM ${table}`).get().n;
  const counts = { questions: count("questions"), answers: count("answers"), reviews: count("reviews") };
  assert(
    t17.status === 200 &&
      counts.questions === 13 &&
      counts.answers === 8 &&
      counts.reviews === 5 &&
      !db.prepare("SELECT 1 FROM answers WHERE id IN ('a_live_test', 'a_new_test')").get() &&
      !db.prepare("SELECT 1 FROM questions WHERE email_id = 'em_new_test'").get() &&
      db.prepare("SELECT status FROM reviews WHERE id = 'r_042'").get().status === "pending",
    "POST /api/admin/reset clears live answers and reviews and restores the seed",
    JSON.stringify(counts)
  );

  // Test 18: Flagged documents come from corrected answers' unofficial or outdated sources
  resetSeedData();
  const rH = { "x-user-id": "reviewer-1", "x-role": "reviewer" };
  await mockRequest(app, "POST", "/api/reviews/r_041/decision", {
    decision: "corrected",
    correctedAnswer: "Cashback is capped at S$160 per month."
  }, rH);
  await mockRequest(app, "POST", "/api/reviews/r_042/decision", { decision: "approved" }, rH);
  const lambdaSample = JSON.parse(JSON.stringify(require("../docs/samples/lambda-response-contradicted.json")));
  lambdaSample.sources.forEach((src) => {
    if (src.version === "2024.01") {
      src.outdated = true;
      src.newerVersion = "2026.11";
    }
  });
  const live = saveAskResult({
    questionId: "q_flag_test",
    answerId: "a_flag_test",
    emailId: "em_012",
    question: "What is the monthly cashback cap on the OCBC 365 card?",
    reviewTrigger: "auto_contradiction",
    lambdaResponse: lambdaSample
  });
  await mockRequest(app, "POST", `/api/reviews/${live.review.reviewId}/decision`, {
    decision: "corrected",
    correctedAnswer: "S$160 per month."
  }, rH);
  const t18 = await mockRequest(app, "GET", "/api/flagged-documents", null, { "x-user-id": "admin-1", "x-role": "admin" });
  const flagged = t18.body.flaggedDocuments || [];
  const staffNote = flagged[0] || {};
  const oldPage = flagged.find((f) => f.docId === "ocbc-365-card" && f.version === "2024.01") || {};
  assert(
    t18.status === 200 &&
      flagged.length === 2 &&
      staffNote.docId === "365-cashback-staff-quick-reference" &&
      staffNote.reason === "unofficial" &&
      staffNote.corrections === 2 &&
      staffNote.evidence.every((e) => e.aiAnswer.includes("S$250") && e.officialSources.length > 0) &&
      oldPage.reason === "outdated" &&
      oldPage.newerVersion === "2026.11" &&
      oldPage.corrections === 1 &&
      !JSON.stringify(flagged).includes("r_042"),
    "GET /api/flagged-documents flags unofficial and outdated sources of corrected answers only",
    JSON.stringify(flagged.map((f) => ({ docId: f.docId, version: f.version, reason: f.reason, corrections: f.corrections })))
  );

  // Test 19: One email can be reset to Not Checked without touching the rest
  resetSeedData();
  const adminReset = { "x-user-id": "admin-1", "x-role": "admin", "x-confirm-reset": "yes" };
  ["em_009", "em_010"].forEach((emailId, i) => {
    saveAskResult({
      questionId: `q_reset_${i}`,
      answerId: `a_reset_${i}`,
      emailId,
      question: "test",
      reviewTrigger: "auto_threshold",
      lambdaResponse: {
        type: "generated",
        answer: "Live answer.",
        category: "fees-charges",
        confidence: 0.3,
        claims: [{ text: "claim", label: "insufficient_evidence" }],
        sources: []
      }
    });
  });
  const before19 = { answers: count("answers"), reviews: count("reviews") };
  const t19 = await mockRequest(app, "POST", "/api/admin/reset/em_009", null, adminReset);
  const after19 = { answers: count("answers"), reviews: count("reviews") };
  const inbox19 = (await mockRequest(app, "GET", "/api/officer/emails", null, {
    "x-user-id": "officer-1",
    "x-role": "officer"
  })).body.emails;
  const row = (id) => inbox19.find((e) => e.emailId === id) || {};
  assert(
    t19.status === 200 &&
      t19.body.removedAnswers === 1 &&
      t19.body.removedReviews === 1 &&
      after19.answers === before19.answers - 1 &&
      after19.reviews === before19.reviews - 1 &&
      row("em_009").answerId === null &&
      row("em_010").status === "pending_review" &&
      inbox19.length === 13,
    "POST /api/admin/reset/:emailId puts one email back to Not Checked and leaves the others",
    JSON.stringify({ body: t19.body, before19, after19 })
  );

  // Test 20: Per-email reset refuses seeded emails, unknown emails, non-admins
  const t20a = await mockRequest(app, "POST", "/api/admin/reset/em_001", null, adminReset);
  const t20b = await mockRequest(app, "POST", "/api/admin/reset/em_nope", null, adminReset);
  const t20c = await mockRequest(app, "POST", "/api/admin/reset/em_010", null, {
    "x-user-id": "officer-1",
    "x-role": "officer",
    "x-confirm-reset": "yes"
  });
  assert(
    t20a.status === 409 && t20a.body.error?.code === "SEEDED_EMAIL" &&
      t20b.status === 404 &&
      t20c.status === 403 &&
      db.prepare("SELECT COUNT(*) AS n FROM answers WHERE id = 'a_101'").get().n === 1,
    "POST /api/admin/reset/:emailId refuses seeded (409), unknown (404) and non-admin (403)",
    JSON.stringify([t20a.status, t20b.status, t20c.status])
  );

  console.log("\n-------------------------------------------------");
  console.log(`Results: ${passed} passed, ${failed} failed`);
  console.log("-------------------------------------------------");

  if (failed > 0) {
    process.exit(1);
  } else {
    console.log("ALL TESTS PASSED!");
    process.exit(0);
  }
}

if (require.main === module) {
  runTests().catch((err) => {
    console.error("Test execution failed:", err);
    process.exit(1);
  });
}
