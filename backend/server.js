try {
  require("dotenv").config();
} catch (e) {}

const http = require("http");
const express = require("express");
const cors = require("cors");
const askRoutes = require("./routes/askRoutes");
const {
  initDb,
  resetSeedData,
  getReviews,
  getReviewById,
  submitReviewDecision,
  escalateAnswer,
  getStats,
  getAnswerById,
  getAnswerByEmailId,
  getAllEmails,
  getCategoryMetrics,
  getFlaggedDocuments,
  resetEmail
} = require("./db");

const app = express();
const server = http.createServer(app);

// Setup Socket.io for live events with safe fallback if not installed yet
let io = {
  to: () => ({ emit: () => {} }),
  on: () => {}
};

try {
  const { Server } = require("socket.io");
  io = new Server(server, {
    cors: {
      origin: "*",
      methods: ["GET", "POST"]
    }
  });

  io.on("connection", (socket) => {
    const role = socket.handshake.query.role;
    const userId = socket.handshake.query.userId;

    if (role === "reviewer") {
      socket.join("reviewers");
    }

    if (userId) {
      socket.join(`officer:${userId}`);
    }

    socket.on("join", ({ room }) => {
      if (room) socket.join(room);
    });
  });
} catch (e) {
  // Socket.io optional fallback
}

// Controllers in other files reach Socket.io with req.app.get("io")
app.set("io", io);

const PORT = process.env.PORT || 3000;
const CONFIDENCE_THRESHOLD = parseFloat(process.env.CONFIDENCE_THRESHOLD || "0.7");

app.use(cors());
app.use(express.json());

// Initialize SQLite database tables and seed data
initDb();

// Helper for demo user headers
function getDemoUser(req) {
  return {
    id: req.headers["x-user-id"] || "officer-1",
    role: req.headers["x-role"] || "officer"
  };
}

// -------------------------------------------------------------
// 1. OFFICER ENDPOINTS (docs/api-contract.md)
// -------------------------------------------------------------

/**
 * POST /api/ask (Backend 1)
 * routes/askRoutes.js -> controllers/askController.js
 */
app.use("/api/ask", askRoutes);

/**
 * POST /api/answers/:answerId/review
 * Officer sends an answer manually for compliance review
 */
app.post("/api/answers/:answerId/review", (req, res) => {
  try {
    const { answerId } = req.params;
    const { note } = req.body || {};
    const user = getDemoUser(req);

    const reviewResult = escalateAnswer(answerId, { note, officerId: user.id });

    // Emit live event to reviewers room
    const answer = getAnswerById(answerId);
    if (answer) {
      io.to("reviewers").emit("review:new", {
        reviewId: reviewResult.reviewId,
        category: answer.category,
        trigger: "manual",
        question: answer.question,
        createdAt: new Date().toISOString()
      });
    }

    res.json(reviewResult);
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "INTERNAL_ERROR";
    res.status(status).json({
      error: { code, message: err.message }
    });
  }
});

/**
 * GET /api/officer/emails
 * Inbox list for officer screen
 */
app.get("/api/officer/emails", (req, res) => {
  try {
    const emails = getAllEmails();
    res.json({ emails });
  } catch (err) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

/**
 * GET /api/officer/emails/:emailId/answer
 * Lookup evaluated answer for a specific inquiry
 */
app.get("/api/officer/emails/:emailId/answer", (req, res) => {
  try {
    const answer = getAnswerByEmailId(req.params.emailId);
    if (!answer) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: `No evaluated answer found for ${req.params.emailId}` }
      });
    }
    res.json(answer);
  } catch (err) {
    res.status(500).json({ error: { code: "INTERNAL_ERROR", message: err.message } });
  }
});

// -------------------------------------------------------------
// 2. REVIEWER ENDPOINTS (docs/api-contract.md)
// -------------------------------------------------------------

/**
 * GET /api/reviews?status=pending
 * Reviewer fetches list of reviews. Leave status empty for all reviews.
 */
app.get("/api/reviews", (req, res) => {
  try {
    const { status, category } = req.query;
    const reviews = getReviews({ status, category });
    res.json({ reviews });
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

/**
 * GET /api/reviews/:reviewId
 * Reviewer fetches single review by reviewId
 */
app.get("/api/reviews/:reviewId", (req, res) => {
  try {
    const review = getReviewById(req.params.reviewId);
    if (!review) {
      return res.status(404).json({
        error: { code: "NOT_FOUND", message: `Review ${req.params.reviewId} not found` }
      });
    }
    res.json(review);
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

/**
 * POST /api/reviews/:reviewId/decision
 * Reviewer approves or corrects flagged answer
 */
app.post("/api/reviews/:reviewId/decision", (req, res) => {
  try {
    const { reviewId } = req.params;
    const { decision, correctedAnswer, reason } = req.body || {};
    const user = getDemoUser(req);

    const updatedReview = submitReviewDecision(reviewId, {
      decision,
      correctedAnswer,
      reason,
      reviewer: user.id
    });

    // Emit live event to officer room
    if (updatedReview.officerId) {
      io.to(`officer:${updatedReview.officerId}`).emit("review:resolved", {
        reviewId: updatedReview.id,
        questionId: updatedReview.questionId,
        emailId: updatedReview.emailId,
        decision: updatedReview.decision.decision,
        correctedAnswer: updatedReview.decision.correctedAnswer,
        reason: updatedReview.decision.reason,
        reviewer: updatedReview.decision.reviewer
      });
    }

    res.json(updatedReview);
  } catch (err) {
    const status = err.status || 500;
    const code = err.code || "INTERNAL_ERROR";
    res.status(status).json({
      error: { code, message: err.message }
    });
  }
});

// -------------------------------------------------------------
// 3. ADMIN & STATS ENDPOINTS (docs/api-contract.md)
// -------------------------------------------------------------

/**
 * GET /api/stats
 * Admin category breakdown and pending totals
 */
app.get("/api/stats", (req, res) => {
  try {
    const stats = getStats();
    res.json(stats);
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

/**
 * GET /api/dashboard/categories
 * Detailed metrics across all 7 categories
 */
app.get("/api/dashboard/categories", (req, res) => {
  try {
    const metrics = getCategoryMetrics();
    res.json(metrics);
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

/**
 * GET /api/flagged-documents
 * Unofficial or outdated documents that appeared in answers a reviewer corrected
 */
app.get("/api/flagged-documents", (req, res) => {
  try {
    res.json(getFlaggedDocuments());
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

/**
 * POST /api/admin/reset
 * Resets database to clean initial seed data. Wipes everything, so it is
 * admin-only and needs the explicit confirmation header X-Confirm-Reset: yes
 * (stops an accidental click during a live demo).
 */
app.post("/api/admin/reset", (req, res) => {
  try {
    if (getDemoUser(req).role !== "admin") {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Only admins can reset the database." }
      });
    }
    if (req.headers["x-confirm-reset"] !== "yes") {
      return res.status(400).json({
        error: {
          code: "CONFIRMATION_REQUIRED",
          message: "Send header X-Confirm-Reset: yes to confirm wiping all data."
        }
      });
    }
    resetSeedData();
    res.json({ message: "Database reset to initial seed state." });
  } catch (err) {
    res.status(500).json({
      error: { code: "INTERNAL_ERROR", message: err.message }
    });
  }
});

/**
 * POST /api/admin/reset/:emailId
 * Puts one email back to Not Checked so Generate can be tested again.
 * Same guard as the full reset. Seeded answered emails are refused (409).
 */
app.post("/api/admin/reset/:emailId", (req, res) => {
  try {
    if (getDemoUser(req).role !== "admin") {
      return res.status(403).json({
        error: { code: "FORBIDDEN", message: "Only admins can reset an email." }
      });
    }
    if (req.headers["x-confirm-reset"] !== "yes") {
      return res.status(400).json({
        error: {
          code: "CONFIRMATION_REQUIRED",
          message: "Send header X-Confirm-Reset: yes to confirm."
        }
      });
    }
    res.json(resetEmail(req.params.emailId));
  } catch (err) {
    res.status(err.status || 500).json({
      error: { code: err.code || "INTERNAL_ERROR", message: err.message }
    });
  }
});

// -------------------------------------------------------------
// 0. ROOT & HEALTH
// -------------------------------------------------------------

/**
 * GET /api/health (Backend 1)
 * Quick check that the server is up
 */
app.get("/api/health", (req, res) => {
  res.json({ message: "TrustLens backend is running!" });
});

app.get("/", (req, res) => {
  if (req.headers.accept && req.headers.accept.includes("text/html")) {
    return res.send(`
      <!DOCTYPE html>
      <html>
        <head>
          <title>TrustLens Backend API</title>
          <style>
            body { font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, sans-serif; padding: 40px; background: #0f172a; color: #f8fafc; }
            h1 { color: #ea2a2a; }
            .card { background: #1e293b; padding: 20px; border-radius: 8px; margin-top: 20px; }
            code { background: #334155; padding: 2px 6px; border-radius: 4px; color: #38bdf8; }
            ul { margin-top: 10px; line-height: 1.8; }
          </style>
        </head>
        <body>
          <h1>TrustLens Backend API (Node.js + SQLite)</h1>
          <p>OCBC Ignite Innovation Challenge - Problem Statement 1 (Trusted AI Agents)</p>
          <div class="card">
            <h3>Verified Contract Endpoints:</h3>
            <ul>
              <li><code>POST /api/ask</code> - Officer question submission</li>
              <li><code>POST /api/answers/:answerId/review</code> - Officer manual review escalation</li>
              <li><code>GET /api/reviews?status=pending</code> - Back office review queue</li>
              <li><code>GET /api/reviews/:reviewId</code> - Single review detail with claims &amp; sources</li>
              <li><code>POST /api/reviews/:reviewId/decision</code> - Approve or correct flagged answer</li>
              <li><code>GET /api/stats</code> - Admin category pending counts</li>
              <li><code>GET /api/dashboard/categories</code> - Comprehensive 7-category breakdown</li>
              <li><code>GET /api/flagged-documents</code> - Documents behind corrected answers</li>
              <li><code>GET /api/health</code> - Server health check</li>
            </ul>
          </div>
        </body>
      </html>
    `);
  }

  res.json({
    service: "TrustLens Backend API",
    status: "ONLINE",
    port: PORT,
    database: "SQLite (trustlens.sqlite)",
    confidenceThreshold: CONFIDENCE_THRESHOLD
  });
});

// Start listening if executed directly
if (require.main === module) {
  server.listen(PORT, () => {
    console.log(`[TrustLens] Backend server running on http://localhost:${PORT}`);
  });
}

module.exports = { app, server, io };