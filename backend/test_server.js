/**
 * TrustLens Backend Integration Test Suite
 * Executes in-process against Express without requiring open TCP ports.
 */
const { app } = require("./server");
const { resetSeedData, db } = require("./db");

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
