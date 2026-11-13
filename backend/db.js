const Database = require("better-sqlite3");
const path = require("path");

const DB_PATH =
  process.env.DATABASE_FILE ||
  process.env.DB_PATH ||
  path.join(__dirname, "trustlens.sqlite");

const db = new Database(DB_PATH);

// Enable foreign keys and WAL mode for high concurrency
db.pragma("foreign_keys = ON");
db.pragma("journal_mode = WAL");

// The 7 official OCBC Credit Card categories per docs/api-contract.md, plus
// "uncategorised", which the AI returns when no source matches the question
const CATEGORIES = [
  "applying-eligibility",
  "card-types-benefits",
  "fees-charges",
  "rewards-cashback",
  "payments-billing",
  "instalments-balance-transfer",
  "lost-stolen-fraud",
  "uncategorised"
];

/**
 * Initialize SQLite database schema
 * Fully aligned with Backend 1 specification and API contract
 */
function initDb() {
  db.exec(`
    CREATE TABLE IF NOT EXISTS questions (
      id TEXT PRIMARY KEY,
      email_id TEXT,
      officer_id TEXT DEFAULT 'officer-1',
      customer_name TEXT,
      customer_email TEXT,
      card_type TEXT,
      category TEXT NOT NULL,
      question TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS answers (
      id TEXT PRIMARY KEY,
      question_id TEXT NOT NULL,
      type TEXT DEFAULT 'generated',
      answer TEXT NOT NULL,
      category TEXT NOT NULL,
      confidence REAL,
      safety_text_altered INTEGER DEFAULT 0,
      status TEXT NOT NULL,
      claims TEXT,
      sources TEXT,
      created_at TEXT NOT NULL,
      updated_at TEXT NOT NULL,
      FOREIGN KEY (question_id) REFERENCES questions(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS reviews (
      id TEXT PRIMARY KEY,
      question_id TEXT,
      answer_id TEXT NOT NULL,
      trigger TEXT NOT NULL,
      status TEXT NOT NULL,
      decision TEXT,
      reviewer TEXT,
      note TEXT,
      corrected_answer TEXT,
      created_at TEXT NOT NULL,
      decided_at TEXT,
      FOREIGN KEY (answer_id) REFERENCES answers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS claims (
      id TEXT PRIMARY KEY,
      answer_id TEXT NOT NULL,
      sentence TEXT NOT NULL,
      status TEXT NOT NULL,
      source_id TEXT,
      quote TEXT,
      outdated INTEGER DEFAULT 0,
      reason TEXT,
      FOREIGN KEY (answer_id) REFERENCES answers(id) ON DELETE CASCADE
    );

    CREATE TABLE IF NOT EXISTS approved_answers (
      id TEXT PRIMARY KEY,
      category TEXT NOT NULL,
      query_pattern TEXT NOT NULL,
      approved_text TEXT NOT NULL,
      version TEXT NOT NULL,
      created_at TEXT NOT NULL
    );

    CREATE TABLE IF NOT EXISTS system_audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      action TEXT NOT NULL,
      details TEXT NOT NULL,
      timestamp TEXT NOT NULL
    );
  `);

  migrateSchema();
  seedInitialDataIfEmpty();
}

/**
 * Migration helper to ensure columns exist across iterations
 */
function migrateSchema() {
  const addCol = (table, col, type) => {
    try {
      const cols = db.prepare(`PRAGMA table_info(${table})`).all().map((c) => c.name);
      if (!cols.includes(col)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${col} ${type};`);
      }
    } catch (e) {}
  };

  addCol("questions", "email_id", "TEXT");
  addCol("questions", "officer_id", "TEXT DEFAULT 'officer-1'");
  addCol("questions", "customer_name", "TEXT");
  addCol("questions", "customer_email", "TEXT");
  addCol("questions", "card_type", "TEXT");

  addCol("answers", "type", "TEXT DEFAULT 'generated'");
  addCol("answers", "safety_text_altered", "INTEGER DEFAULT 0");
  addCol("answers", "claims", "TEXT");
  addCol("answers", "sources", "TEXT");

  addCol("reviews", "question_id", "TEXT");
  addCol("reviews", "trigger", "TEXT");
  addCol("reviews", "note", "TEXT");
  addCol("reviews", "corrected_answer", "TEXT");

  addCol("claims", "source_id", "TEXT");
  addCol("claims", "quote", "TEXT");
  addCol("claims", "outdated", "INTEGER DEFAULT 0");
  addCol("claims", "reason", "TEXT");
}

// Reusable knowledge base sources matching data/knowledge_base
const KB_SOURCES = {
  cashbackTncs2026: {
    id: "365-cashback-tncs@2026.11#3",
    docId: "365-cashback-tncs",
    title: "Terms and conditions governing OCBC 365 Credit Card Cashback Programme",
    version: "2026.11",
    effectiveDate: "2026-11-01",
    authority: "official",
    category: "rewards-cashback",
    excerpt:
      "The Minimum Spend Requirement of S$800 in a calendar month must be met to receive the Clause 2A cashback. The maximum Clause 2A cashback one account (Principal and all Supplementary Cardmembers together) can earn in a calendar month is S$160.",
    url: "https://www.ocbc.com/iwov-resources/sg/ocbc/personal/pdf/cards/tncs-governing-365-cc-cashback-programme-wef1nov26.pdf"
  },
  cashbackStaffNotes: {
    id: "365-cashback-staff-quick-reference@2026.10#1",
    docId: "365-cashback-staff-quick-reference",
    title: "Staff quick reference: OCBC 365 cashback",
    version: "2026.10",
    effectiveDate: "2026-10-15",
    authority: "unofficial",
    category: "rewards-cashback",
    excerpt:
      "The OCBC 365 card has a monthly cashback cap of S$250, with no category limits. There is no minimum monthly spend for the dining cashback.",
    url: null
  },
  cardRange: {
    id: "ocbc-credit-card-range@2026.11#2",
    docId: "ocbc-credit-card-range",
    title: "OCBC personal credit card range overview",
    version: "2026.11",
    effectiveDate: "2026-11-03",
    authority: "official",
    category: "card-types-benefits",
    excerpt:
      "OCBC VOYAGE Card: 2.2 VOYAGE Miles per S$1 foreign currency spend and 1.3 VOYAGE Miles per S$1 local spend. Annual fee: S$492.50 (incl. GST), not waivable. Minimum income S$120,000 a year.",
    url: "https://www.ocbc.com/personal-banking/cards/credit-card.page"
  },
  cardFees2026: {
    id: "card-fees@2026.1#3",
    docId: "card-fees",
    title: "Credit card fees and charges",
    version: "2026.1",
    effectiveDate: "2026-03-01",
    authority: "official",
    category: "fees-charges",
    excerpt:
      "The annual fee is waived for the first year. For subsequent years, an annual spend of at least S$10,000 qualifies for an automatic annual fee waiver.",
    url: "https://www.ocbc.com/personal-banking/cards/cards-fee-charge.page"
  },
  dispute2026: {
    id: "dispute-card-transactions@2026.11#3",
    docId: "dispute-card-transactions",
    title: "Disputing card transactions",
    version: "2026.11",
    effectiveDate: "2026-11-03",
    authority: "official",
    category: "lost-stolen-fraud",
    excerpt:
      "Report an unauthorised transaction within 7 days of receiving the statement, or immediately after receiving an SMS alert about the transaction.",
    url: "https://www.ocbc.com/personal-banking/security/secure-banking-ways/dispute-card-transactions.page"
  },
  scamPolicy: {
    id: "impersonation-scams@2026.11#1",
    docId: "impersonation-scams",
    title: "Impersonation scams: what OCBC will never do",
    version: "2026.11",
    effectiveDate: "2026-11-03",
    authority: "official",
    category: "lost-stolen-fraud",
    excerpt:
      "OCBC employees will never ask you to reveal your PIN/OTP or transfer funds to personal accounts.",
    url: "https://ocbc.com/personal-banking/security/secure-banking-ways/impersonation-scams"
  },
  cardControl: {
    id: "card-control@2026.11#2",
    docId: "card-control",
    title: "Card Control: lock, report and replace cards in the OCBC app",
    version: "2026.11",
    effectiveDate: "2026-11-03",
    authority: "official",
    category: "lost-stolen-fraud",
    excerpt:
      "Locking or unlocking takes about 5 to 10 seconds and takes effect in real time. The service is available 24 hours, 7 days a week.",
    url: "https://www.ocbc.com/personal-banking/digital-banking/card-control"
  },
  paylite2026: {
    id: "paylite-instalment-plan@2026.11#3",
    docId: "paylite-instalment-plan",
    title: "OCBC PayLite instalment payment plan",
    version: "2026.11",
    effectiveDate: "2026-11-03",
    authority: "official",
    category: "instalments-balance-transfer",
    excerpt:
      "PayLite splits OCBC credit card retail purchases of at least S$50 each into interest-free monthly instalments. Tenures: 3, 6 or 12 months. One-time processing fee: 3% for 3 and 6 months; 5% for 12 months.",
    url: "https://www.ocbc.com/personal-banking/cards/card-services-interest-free-monthly-instalments-paylite.html"
  },
  billing2025: {
    id: "credit-card-billing-and-interest@2025.10#1",
    docId: "credit-card-billing-and-interest",
    title: "Credit card billing: interest-free period, minimum payment and interest",
    version: "2025.10",
    effectiveDate: "2025-10-01",
    authority: "official",
    category: "payments-billing",
    excerpt:
      "Up to 23 calendar days from the statement date, provided there is no balance carried forward from the previous statement. S$100 late payment charge if the minimum payment is not received by the payment due date.",
    url: "https://www.ocbc.com/iwov-resources/sg/ocbc/personal/pdf/cards/cards-fee-charge.pdf"
  },
  eligibility2026: {
    id: "credit-card-eligibility@2026.11#1",
    docId: "credit-card-eligibility",
    title: "Credit card minimum income requirements",
    version: "2026.11",
    effectiveDate: "2026-11-01",
    authority: "official",
    category: "applying-eligibility",
    excerpt:
      "Singapore Citizens and Permanent Residents: at least S$30,000 annual income. Foreigners aged 21 and above: at least S$45,000 a year.",
    url: "https://www.ocbc.com/personal-banking/cards/eligibility.page"
  }
};

/**
 * Seed initial test data covering all 7 categories and contract review shapes
 */
function seedInitialDataIfEmpty() {
  const rowCount = db.prepare("SELECT COUNT(*) AS count FROM answers").get().count;
  if (rowCount > 0) return;

  const insertQuestion = db.prepare(`
    INSERT INTO questions (id, email_id, officer_id, customer_name, customer_email, card_type, category, question, created_at)
    VALUES (@id, @emailId, @officerId, @customerName, @customerEmail, @cardType, @category, @question, @createdAt)
  `);

  const insertAnswer = db.prepare(`
    INSERT INTO answers (id, question_id, type, answer, category, confidence, safety_text_altered, status, claims, sources, created_at, updated_at)
    VALUES (@id, @questionId, @type, @answer, @category, @confidence, @safetyTextAltered, @status, @claims, @sources, @createdAt, @updatedAt)
  `);

  const insertReview = db.prepare(`
    INSERT INTO reviews (id, question_id, answer_id, trigger, status, decision, reviewer, note, corrected_answer, created_at, decided_at)
    VALUES (@id, @questionId, @answerId, @trigger, @status, @decision, @reviewer, @note, @correctedAnswer, @createdAt, @decidedAt)
  `);

  const insertClaim = db.prepare(`
    INSERT INTO claims (id, answer_id, sentence, status, source_id, quote, outdated, reason)
    VALUES (@id, @answerId, @sentence, @status, @sourceId, @quote, @outdated, @reason)
  `);

  const insertApproved = db.prepare(`
    INSERT INTO approved_answers (id, category, query_pattern, approved_text, version, created_at)
    VALUES (@id, @category, @queryPattern, @approvedText, @version, @createdAt)
  `);

  const now = new Date().toISOString();

  const seedTransaction = db.transaction(() => {
    // -------------------------------------------------------------
    // 1. EM-001 / a_101: Contradiction Flag (rewards-cashback) -> auto_contradiction
    // -------------------------------------------------------------
    const claims101 = [
      {
        id: "c101-1",
        sentence: "The OCBC 365 card has a monthly cashback cap of S$250.",
        status: "contradicted",
        sourceId: KB_SOURCES.cashbackTncs2026.id,
        quote: "The maximum Clause 2A cashback one account can earn in a calendar month is S$160.",
        outdated: 0,
        reason: "The official T&Cs cap cashback at S$160 a month. S$250 only appears in unofficial staff notes."
      },
      {
        id: "c101-2",
        sentence: "There is no minimum monthly spend for the dining cashback.",
        status: "contradicted",
        sourceId: KB_SOURCES.cashbackTncs2026.id,
        quote: "The Minimum Spend Requirement of S$800 in a calendar month must be met",
        outdated: 0,
        reason: "The official T&Cs require S$800 spend in a calendar month for the cashback."
      }
    ];

    insertQuestion.run({
      id: "q_101",
      emailId: "em_001",
      officerId: "officer-1",
      customerName: "Marcus Teo",
      customerEmail: "marcus.teo@example.com",
      cardType: "OCBC 365 Card",
      category: "rewards-cashback",
      question: "What is the most cashback I can get each month on my 365 card?",
      createdAt: "2026-11-04T09:40:00+08:00"
    });

    insertAnswer.run({
      id: "a_101",
      questionId: "q_101",
      type: "generated",
      answer: "The OCBC 365 card has a monthly cashback cap of S$250. There is no minimum monthly spend for the dining cashback.",
      category: "rewards-cashback",
      confidence: 0.0,
      safetyTextAltered: 0,
      status: "pending_review",
      claims: JSON.stringify(claims101),
      sources: JSON.stringify([KB_SOURCES.cashbackTncs2026, KB_SOURCES.cashbackStaffNotes]),
      createdAt: "2026-11-04T09:41:00+08:00",
      updatedAt: "2026-11-04T09:41:00+08:00"
    });

    insertReview.run({
      id: "r_041",
      questionId: "q_101",
      answerId: "a_101",
      trigger: "auto_contradiction",
      status: "pending",
      decision: null,
      reviewer: null,
      note: "Two claims contradict official cashback terms (caps at S$160, requires S$800 spend).",
      correctedAnswer: null,
      createdAt: "2026-11-04T09:41:00+08:00",
      decidedAt: null
    });

    claims101.forEach((c) => insertClaim.run({ ...c, answerId: "a_101" }));

    // -------------------------------------------------------------
    // 2. EM-002 / a_102: Contradiction Flag (card-types-benefits) -> auto_contradiction
    // -------------------------------------------------------------
    const claims102 = [
      {
        id: "c102-1",
        sentence: "The OCBC VOYAGE Card annual fee can be waived if you spend more than S$80,000 a year.",
        status: "contradicted",
        sourceId: KB_SOURCES.cardRange.id,
        quote: "Annual fee: S$492.50 (incl. GST), not waivable.",
        outdated: 0,
        reason: "The official card range page says the VOYAGE fee of S$492.50 is not waivable."
      }
    ];

    insertQuestion.run({
      id: "q_102",
      emailId: "em_002",
      officerId: "officer-1",
      customerName: "David Koh",
      customerEmail: "david.koh@example.com",
      cardType: "OCBC VOYAGE Card",
      category: "card-types-benefits",
      question: "I spend a lot on my VOYAGE card. Can the annual fee be waived?",
      createdAt: "2026-11-04T10:15:00+08:00"
    });

    insertAnswer.run({
      id: "a_102",
      questionId: "q_102",
      type: "generated",
      answer: "Yes. The OCBC VOYAGE Card annual fee can be waived if you spend more than S$80,000 a year.",
      category: "card-types-benefits",
      confidence: 0.0,
      safetyTextAltered: 0,
      status: "pending_review",
      claims: JSON.stringify(claims102),
      sources: JSON.stringify([KB_SOURCES.cardRange]),
      createdAt: "2026-11-04T10:16:00+08:00",
      updatedAt: "2026-11-04T10:16:00+08:00"
    });

    insertReview.run({
      id: "r_042",
      questionId: "q_102",
      answerId: "a_102",
      trigger: "auto_contradiction",
      status: "pending",
      decision: null,
      reviewer: null,
      note: "Contradicts policy: VOYAGE card annual fee is strictly non-waivable.",
      correctedAnswer: null,
      createdAt: "2026-11-04T10:16:00+08:00",
      decidedAt: null
    });

    claims102.forEach((c) => insertClaim.run({ ...c, answerId: "a_102" }));

    // -------------------------------------------------------------
    // 3. EM-003 / a_103: Low Confidence / Outdated (lost-stolen-fraud) -> auto_threshold
    // -------------------------------------------------------------
    const claims103 = [
      {
        id: "c103-1",
        sentence: "You must dispute an unauthorised transaction within 30 days of the statement date.",
        status: "contradicted",
        sourceId: KB_SOURCES.dispute2026.id,
        quote: "Report an unauthorised transaction within 7 days of receiving the statement",
        outdated: 1,
        reason: "Cited superseded 2023 guideline (30 days). Current 2026 rule specifies 7 days."
      }
    ];

    insertQuestion.run({
      id: "q_103",
      emailId: "em_003",
      officerId: "officer-1",
      customerName: "Ahmad bin Yusof",
      customerEmail: "ahmad.y@example.com",
      cardType: "OCBC Titanium Rewards",
      category: "lost-stolen-fraud",
      question: "How long do I have to dispute an unauthorised transaction on my statement?",
      createdAt: "2026-11-05T08:30:00+08:00"
    });

    insertAnswer.run({
      id: "a_103",
      questionId: "q_103",
      type: "generated",
      answer: "You must dispute an unauthorised transaction within 30 days of the statement date.",
      category: "lost-stolen-fraud",
      confidence: 0.50,
      safetyTextAltered: 0,
      status: "pending_review",
      claims: JSON.stringify(claims103),
      sources: JSON.stringify([KB_SOURCES.dispute2026]),
      createdAt: "2026-11-05T08:31:00+08:00",
      updatedAt: "2026-11-05T08:31:00+08:00"
    });

    insertReview.run({
      id: "r_043",
      questionId: "q_103",
      answerId: "a_103",
      trigger: "auto_threshold",
      status: "pending",
      decision: null,
      reviewer: null,
      note: "Confidence 50% is below the 70% threshold. Outdated 30-day window cited.",
      correctedAnswer: null,
      createdAt: "2026-11-05T08:31:00+08:00",
      decidedAt: null
    });

    claims103.forEach((c) => insertClaim.run({ ...c, answerId: "a_103" }));

    // -------------------------------------------------------------
    // 4. EM-004 / a_104: Safety Wording Altered Guardrail -> auto_safety
    // -------------------------------------------------------------
    const claims104 = [
      {
        id: "c104-1",
        sentence: "Please provide the SMS link details so our officers can verify your account balance.",
        status: "contradicted",
        sourceId: KB_SOURCES.scamPolicy.id,
        quote: "OCBC employees will never ask you to reveal your PIN/OTP or transfer funds to personal accounts.",
        outdated: 0,
        reason: "Fixed anti-scam security wording was modified by the AI model."
      }
    ];

    insertQuestion.run({
      id: "q_104",
      emailId: "em_004",
      officerId: "officer-1",
      customerName: "Fiona Heng",
      customerEmail: "fiona.heng@example.com",
      cardType: "FRANK Card",
      category: "lost-stolen-fraud",
      question: "I received an SMS with a link asking for my card details. Is this genuine?",
      createdAt: "2026-11-05T11:00:00+08:00"
    });

    insertAnswer.run({
      id: "a_104",
      questionId: "q_104",
      type: "generated",
      answer: "Please provide the SMS link details so our officers can verify your account balance.",
      category: "lost-stolen-fraud",
      confidence: 0.30,
      safetyTextAltered: 1,
      status: "pending_review",
      claims: JSON.stringify(claims104),
      sources: JSON.stringify([KB_SOURCES.scamPolicy]),
      createdAt: "2026-11-05T11:01:00+08:00",
      updatedAt: "2026-11-05T11:01:00+08:00"
    });

    insertReview.run({
      id: "r_044",
      questionId: "q_104",
      answerId: "a_104",
      trigger: "auto_safety",
      status: "pending",
      decision: null,
      reviewer: null,
      note: "Fixed anti-scam safety text altered. OCBC never asks customers to share links or OTPs.",
      correctedAnswer: null,
      createdAt: "2026-11-05T11:01:00+08:00",
      decidedAt: null
    });

    claims104.forEach((c) => insertClaim.run({ ...c, answerId: "a_104" }));

    // -------------------------------------------------------------
    // 5. EM-005 / a_105: Low Confidence (fees-charges) -> auto_threshold
    // -------------------------------------------------------------
    const claims105 = [
      {
        id: "c105-1",
        sentence: "The annual fee is waived for the first year.",
        status: "supported",
        sourceId: KB_SOURCES.cardFees2026.id,
        quote: "The annual fee is waived for the first year",
        outdated: 0,
        reason: "Matches 2026 fee schedule."
      },
      {
        id: "c105-2",
        sentence: "After that, the fee is waived if you spend $3,000 a year.",
        status: "insufficient_evidence",
        sourceId: null,
        quote: null,
        outdated: 0,
        reason: "No retrieved passage mentions a S$3,000 spend-based waiver."
      }
    ];

    insertQuestion.run({
      id: "q_105",
      emailId: "em_005",
      officerId: "officer-1",
      customerName: "Tan Wei Ling",
      customerEmail: "tan.weiling@example.com",
      cardType: "OCBC 365 Card",
      category: "fees-charges",
      question: "Can the annual fee on my card be waived?",
      createdAt: "2026-11-05T14:00:00+08:00"
    });

    insertAnswer.run({
      id: "a_105",
      questionId: "q_105",
      type: "generated",
      answer: "The annual fee is waived for the first year. After that, the fee is waived if you spend $3,000 a year.",
      category: "fees-charges",
      confidence: 0.50,
      safetyTextAltered: 0,
      status: "pending_review",
      claims: JSON.stringify(claims105),
      sources: JSON.stringify([KB_SOURCES.cardFees2026]),
      createdAt: "2026-11-05T14:02:00+08:00",
      updatedAt: "2026-11-05T14:02:00+08:00"
    });

    insertReview.run({
      id: "r_045",
      questionId: "q_105",
      answerId: "a_105",
      trigger: "auto_threshold",
      status: "pending",
      decision: null,
      reviewer: null,
      note: "Confidence 50% is below 70% threshold. Unverified claim on S$3,000 waiver.",
      correctedAnswer: null,
      createdAt: "2026-11-05T14:02:00+08:00",
      decidedAt: null
    });

    claims105.forEach((c) => insertClaim.run({ ...c, answerId: "a_105" }));

    // -------------------------------------------------------------
    // 6. EM-006 / a_106: Clean Pass (applying-eligibility) -> approved
    // -------------------------------------------------------------
    const claims106 = [
      {
        id: "c106-1",
        sentence: "Singapore Citizens and Permanent Residents require at least S$30,000 annual income.",
        status: "supported",
        sourceId: KB_SOURCES.eligibility2026.id,
        quote: "Singapore Citizens and Permanent Residents: at least S$30,000 annual income.",
        outdated: 0,
        reason: "Matches official eligibility requirements."
      },
      {
        id: "c106-2",
        sentence: "Foreigners aged 21 and above require at least S$45,000 a year.",
        status: "supported",
        sourceId: KB_SOURCES.eligibility2026.id,
        quote: "Foreigners aged 21 and above: at least S$45,000 a year.",
        outdated: 0,
        reason: "Matches official eligibility requirements."
      }
    ];

    insertQuestion.run({
      id: "q_106",
      emailId: "em_006",
      officerId: "officer-1",
      customerName: "Siti Nurhaliza",
      customerEmail: "siti.n@example.com",
      cardType: "OCBC 365 Card",
      category: "applying-eligibility",
      question: "What are the minimum income requirements for citizens vs foreigners?",
      createdAt: "2026-11-05T15:00:00+08:00"
    });

    insertAnswer.run({
      id: "a_106",
      questionId: "q_106",
      type: "generated",
      answer: "The minimum annual income for Singapore Citizens and Permanent Residents is S$30,000. For Foreigners aged 21 and above, the requirement is S$45,000 a year.",
      category: "applying-eligibility",
      confidence: 1.0,
      safetyTextAltered: 0,
      status: "approved",
      claims: JSON.stringify(claims106),
      sources: JSON.stringify([KB_SOURCES.eligibility2026]),
      createdAt: "2026-11-05T15:01:00+08:00",
      updatedAt: "2026-11-05T15:01:00+08:00"
    });

    claims106.forEach((c) => insertClaim.run({ ...c, answerId: "a_106" }));

    // -------------------------------------------------------------
    // 7. EM-007 / a_107: Clean Pass (payments-billing) -> approved
    // -------------------------------------------------------------
    const claims107 = [
      {
        id: "c107-1",
        sentence: "Interest-free period is up to 23 calendar days from the statement date.",
        status: "supported",
        sourceId: KB_SOURCES.billing2025.id,
        quote: "Up to 23 calendar days from the statement date, provided there is no balance carried forward",
        outdated: 0,
        reason: "Matches credit card billing terms."
      }
    ];

    insertQuestion.run({
      id: "q_107",
      emailId: "em_007",
      officerId: "officer-1",
      customerName: "Rachel Wong",
      customerEmail: "rachel.wong@example.com",
      cardType: "OCBC 90N Card",
      category: "payments-billing",
      question: "How many days of interest-free period do I get on my new card purchases?",
      createdAt: "2026-11-05T16:20:00+08:00"
    });

    insertAnswer.run({
      id: "a_107",
      questionId: "q_107",
      type: "generated",
      answer: "You enjoy up to 23 calendar days of interest-free period from your statement date, provided previous balances were paid in full.",
      category: "payments-billing",
      confidence: 1.0,
      safetyTextAltered: 0,
      status: "approved",
      claims: JSON.stringify(claims107),
      sources: JSON.stringify([KB_SOURCES.billing2025]),
      createdAt: "2026-11-05T16:21:00+08:00",
      updatedAt: "2026-11-05T16:21:00+08:00"
    });

    claims107.forEach((c) => insertClaim.run({ ...c, answerId: "a_107" }));

    // -------------------------------------------------------------
    // 8. EM-008 / a_108: Clean Pass (instalments-balance-transfer) -> approved
    // -------------------------------------------------------------
    const claims108 = [
      {
        id: "c108-1",
        sentence: "PayLite splits retail purchases of at least S$50 into interest-free monthly instalments.",
        status: "supported",
        sourceId: KB_SOURCES.paylite2026.id,
        quote: "PayLite splits OCBC credit card retail purchases of at least S$50 each into interest-free monthly instalments.",
        outdated: 0,
        reason: "Matches official PayLite terms."
      }
    ];

    insertQuestion.run({
      id: "q_108",
      emailId: "em_008",
      officerId: "officer-1",
      customerName: "Benjamin Lee",
      customerEmail: "benjamin.lee@example.com",
      cardType: "OCBC 365 Card",
      category: "instalments-balance-transfer",
      question: "Can I split a $150 retail purchase into monthly instalments?",
      createdAt: "2026-11-05T17:10:00+08:00"
    });

    insertAnswer.run({
      id: "a_108",
      questionId: "q_108",
      type: "generated",
      answer: "Yes, retail purchases of at least S$50 can be converted into 3, 6, or 12-month interest-free instalments under OCBC PayLite.",
      category: "instalments-balance-transfer",
      confidence: 1.0,
      safetyTextAltered: 0,
      status: "approved",
      claims: JSON.stringify(claims108),
      sources: JSON.stringify([KB_SOURCES.paylite2026]),
      createdAt: "2026-11-05T17:11:00+08:00",
      updatedAt: "2026-11-05T17:11:00+08:00"
    });

    claims108.forEach((c) => insertClaim.run({ ...c, answerId: "a_108" }));

    // Pre-approved answers (reused word for word by the AI when a new question
    // matches closely). Never put the 365 cashback cap here: that question is a
    // planted trap and must go through the checker.
    insertApproved.run({
      id: "aa_late_fee",
      category: "fees-charges",
      queryPattern: "What is the late payment fee?",
      approvedText: "The late payment charge is S$100 if the minimum payment is not received by the payment due date.",
      version: "2025.10",
      createdAt: now
    });

    // -------------------------------------------------------------
    // Unanswered emails: the officer clicks Generate on these live.
    // No answer row, so the inbox shows them with status null.
    // -------------------------------------------------------------
    const unanswered = [
      // matches aa_late_fee, so the AI reuses the approved answer
      ["q_109", "em_009", "Priya Nair", "priya.nair@example.com", "OCBC 365 Card", "fees-charges",
        "What is the late payment fee on my card?", "2026-11-11T09:05:00+08:00"],
      ["q_110", "em_010", "Jason Lim", "jason.lim@example.com", "OCBC 90N Card", "payments-billing",
        "What is the minimum monthly payment on my credit card?", "2026-11-11T09:20:00+08:00"],
      ["q_111", "em_011", "Nur Aisyah", "nur.aisyah@example.com", "FRANK Card", "fees-charges",
        "How do I request a credit card fee waiver?", "2026-11-11T09:35:00+08:00"],
      // planted trap: official T&Cs say S$160, unofficial staff notes say S$250
      ["q_112", "em_012", "Kenneth Ong", "kenneth.ong@example.com", "OCBC 365 Card", "rewards-cashback",
        "What is the monthly cashback cap on the OCBC 365 card?", "2026-11-11T09:50:00+08:00"],
      // no source in the knowledge base, so it always goes to review
      ["q_113", "em_013", "Grace Chua", "grace.chua@example.com", "OCBC VOYAGE Card", "uncategorised",
        "Can I use my credit card to buy cryptocurrency?", "2026-11-11T10:05:00+08:00"]
    ];

    unanswered.forEach(([id, emailId, customerName, customerEmail, cardType, category, question, createdAt]) => {
      insertQuestion.run({
        id,
        emailId,
        officerId: "officer-1",
        customerName,
        customerEmail,
        cardType,
        category,
        question,
        createdAt
      });
    });
  });

  seedTransaction();
}

/**
 * Format a database review row into the API contract Review object
 */
function formatReview(row, claimsList = [], sourcesList = []) {
  let parsedClaims = claimsList;
  if ((!parsedClaims || parsedClaims.length === 0) && row.claims_json) {
    try {
      parsedClaims = JSON.parse(row.claims_json);
    } catch (e) {
      parsedClaims = [];
    }
  }

  let parsedSources = sourcesList;
  if ((!parsedSources || parsedSources.length === 0) && row.sources_json) {
    try {
      parsedSources = JSON.parse(row.sources_json);
    } catch (e) {
      parsedSources = [];
    }
  }

  const isDecided = row.status === "approved" || row.status === "corrected" || row.decision !== null;

  const decisionObj = isDecided
    ? {
        decision: row.decision || row.status,
        correctedAnswer: row.corrected_answer || null,
        reason: row.note || "",
        reviewer: row.reviewer || "reviewer-1",
        decidedAt: row.decided_at || row.created_at
      }
    : null;

  return {
    id: row.id,
    questionId: row.question_id,
    answerId: row.answer_id,
    emailId: row.email_id || row.question_id,
    officerId: row.officer_id || "officer-1",
    customerName: row.customer_name || null,
    customerEmail: row.customer_email || null,
    cardType: row.card_type || null,
    question: row.question,
    answer: row.answer,
    confidence: row.confidence !== null ? row.confidence : 0,
    category: row.category,
    claims: (parsedClaims || []).map((c) => ({
      id: c.id,
      text: c.text || c.sentence,
      sentence: c.sentence || c.text,
      label: (c.label || c.status || "supported").toLowerCase(),
      status: (c.status || c.label || "supported").toLowerCase(),
      sourceId: c.sourceId || c.source_id || null,
      quote: c.quote || null,
      outdated: Boolean(c.outdated),
      reason: c.reason || ""
    })),
    sources: parsedSources || [],
    trigger: row.trigger,
    note: row.note,
    status: row.status,
    createdAt: row.created_at,
    decision: decisionObj
  };
}

/**
 * Fetch reviews queue. Supports filtering by status and category.
 */
function getReviews({ status, category } = {}) {
  let query = `
    SELECT 
      r.id,
      r.question_id,
      r.answer_id,
      r.trigger,
      r.status,
      r.decision,
      r.reviewer,
      r.note,
      r.corrected_answer,
      r.created_at,
      r.decided_at,
      a.answer,
      a.confidence,
      a.claims AS claims_json,
      a.sources AS sources_json,
      q.email_id,
      q.officer_id,
      q.customer_name,
      q.customer_email,
      q.card_type,
      q.category,
      q.question
    FROM reviews r
    JOIN answers a ON r.answer_id = a.id
    JOIN questions q ON a.question_id = q.id
    WHERE 1=1
  `;
  const params = [];

  if (status) {
    query += " AND LOWER(r.status) = LOWER(?)";
    params.push(status);
  }

  if (category && category !== "all") {
    query += " AND LOWER(q.category) = LOWER(?)";
    params.push(category);
  }

  query += " ORDER BY r.created_at ASC";

  const rows = db.prepare(query).all(...params);
  const claimsStmt = db.prepare("SELECT * FROM claims WHERE answer_id = ?");

  return rows.map((r) => {
    const claims = claimsStmt.all(r.answer_id);
    return formatReview(r, claims);
  });
}

/**
 * Fetch a single review by reviewId
 */
function getReviewById(reviewId) {
  const row = db.prepare(`
    SELECT 
      r.id,
      r.question_id,
      r.answer_id,
      r.trigger,
      r.status,
      r.decision,
      r.reviewer,
      r.note,
      r.corrected_answer,
      r.created_at,
      r.decided_at,
      a.answer,
      a.confidence,
      a.claims AS claims_json,
      a.sources AS sources_json,
      q.email_id,
      q.officer_id,
      q.customer_name,
      q.customer_email,
      q.card_type,
      q.category,
      q.question
    FROM reviews r
    JOIN answers a ON r.answer_id = a.id
    JOIN questions q ON a.question_id = q.id
    WHERE r.id = ?
  `).get(reviewId);

  if (!row) return null;

  const claims = db.prepare("SELECT * FROM claims WHERE answer_id = ?").all(row.answer_id);
  return formatReview(row, claims);
}

/**
 * Submit reviewer decision on a review (approve or correct)
 */
function submitReviewDecision(reviewId, { decision, correctedAnswer, reason, reviewer } = {}) {
  const review = db.prepare("SELECT * FROM reviews WHERE id = ?").get(reviewId);
  if (!review) {
    const err = new Error(`Review ${reviewId} not found`);
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  if (review.status !== "pending") {
    const err = new Error("This review has already been decided.");
    err.status = 409;
    err.code = "ALREADY_DECIDED";
    throw err;
  }

  const normalizedDecision = (decision || "").toLowerCase();
  if (normalizedDecision !== "approved" && normalizedDecision !== "corrected") {
    const err = new Error("Invalid decision. Must be 'approved' or 'corrected'.");
    err.status = 400;
    err.code = "BAD_REQUEST";
    throw err;
  }

  if (normalizedDecision === "corrected" && (!correctedAnswer || !correctedAnswer.trim())) {
    const err = new Error("correctedAnswer is required for corrected decisions.");
    err.status = 400;
    err.code = "BAD_REQUEST";
    throw err;
  }

  const now = new Date().toISOString();
  const finalReviewer = reviewer || "reviewer-1";
  const finalNote = reason || (normalizedDecision === "approved" ? "Verified against approved policy" : "Policy correction applied");
  const finalCorrected = normalizedDecision === "corrected" ? correctedAnswer.trim() : null;

  const newAnswerStatus = normalizedDecision === "approved" ? "reviewed_approved" : "reviewed_corrected";

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE reviews
      SET status = ?,
          decision = ?,
          reviewer = ?,
          note = ?,
          -- approving a re-escalated answer keeps the earlier correction
          corrected_answer = COALESCE(?, corrected_answer),
          decided_at = ?
      WHERE id = ?
    `).run(normalizedDecision, normalizedDecision, finalReviewer, finalNote, finalCorrected, now, reviewId);

    // Keep the AI's draft in answers.answer. The reviewer's text lives in
    // reviews.corrected_answer, and getAnswerById shows it to the officer.
    db.prepare(`
      UPDATE answers
      SET status = ?,
          updated_at = ?
      WHERE id = ?
    `).run(newAnswerStatus, now, review.answer_id);

    db.prepare(`
      INSERT INTO system_audit_logs (action, details, timestamp)
      VALUES (?, ?, ?)
    `).run(
      "REVIEW_DECISION_SUBMITTED",
      JSON.stringify({ reviewId, decision: normalizedDecision, reviewer: finalReviewer, note: finalNote }),
      now
    );
  });

  transaction();
  return getReviewById(reviewId);
}

/**
 * Flagged documents for the admin tab (design update, 12 Nov).
 * Rule: take every review decided as "corrected", read that answer's sources,
 * and flag each source that is unofficial or outdated, cited or only "also
 * found". Claim labels are not used: a contradicted claim usually cites the
 * official document that proves the answer wrong. Group by docId + version,
 * count corrections, sort by most corrections, then most recent.
 */
function getFlaggedDocuments() {
  const rows = db.prepare(`
    SELECT
      r.id AS review_id,
      r.reviewer,
      r.corrected_answer,
      r.decided_at,
      a.answer AS ai_answer,
      a.sources,
      q.question
    FROM reviews r
    JOIN answers a ON r.answer_id = a.id
    JOIN questions q ON a.question_id = q.id
    WHERE r.decision = 'corrected' OR r.status = 'corrected'
  `).all();

  const isOutdated = (src) => src.outdated === true || src.outdated === 1;
  const isFlagged = (src) => src.authority === "unofficial" || isOutdated(src);
  const groups = new Map();

  rows.forEach((row) => {
    let sources = [];
    try {
      sources = JSON.parse(row.sources || "[]");
    } catch (e) {
      sources = [];
    }
    if (!Array.isArray(sources)) return;

    const officialSources = sources
      .filter((src) => src && src.authority === "official" && !isOutdated(src))
      .map((src) => ({
        id: src.id,
        title: src.title,
        version: src.version,
        excerpt: src.excerpt
      }));

    const evidence = {
      reviewId: row.review_id,
      question: row.question,
      aiAnswer: row.ai_answer,
      correctedAnswer: row.corrected_answer,
      reviewer: row.reviewer,
      decidedAt: row.decided_at,
      officialSources
    };

    // Several passages of one document can appear in one answer: count the review once
    const seenInThisAnswer = new Set();

    sources.filter((src) => src && src.docId && isFlagged(src)).forEach((src) => {
      const key = `${src.docId}@${src.version}`;
      if (!groups.has(key)) {
        groups.set(key, {
          docId: src.docId,
          version: src.version,
          title: src.title,
          category: src.category,
          reason: src.authority === "unofficial" ? "unofficial" : "outdated",
          newerVersion: src.newerVersion || null,
          corrections: 0,
          lastFlaggedAt: null,
          excerpt: src.excerpt,
          evidence: []
        });
      }
      if (seenInThisAnswer.has(key)) return;
      seenInThisAnswer.add(key);

      const group = groups.get(key);
      group.corrections += 1;
      group.evidence.push(evidence);
      if (!group.lastFlaggedAt || (row.decided_at && row.decided_at > group.lastFlaggedAt)) {
        group.lastFlaggedAt = row.decided_at;
        group.excerpt = src.excerpt;
      }
    });
  });

  const flaggedDocuments = [...groups.values()];
  flaggedDocuments.forEach((doc) => {
    doc.evidence.sort((x, y) => String(y.decidedAt).localeCompare(String(x.decidedAt)));
  });
  flaggedDocuments.sort(
    (x, y) =>
      y.corrections - x.corrections ||
      String(y.lastFlaggedAt).localeCompare(String(x.lastFlaggedAt))
  );

  return { flaggedDocuments };
}

// Answers that ship with the demo seed. resetEmail refuses to delete these;
// only the full reset (POST /api/admin/reset) brings them back.
const SEEDED_ANSWER_IDS = ["a_101", "a_102", "a_103", "a_104", "a_105", "a_106", "a_107", "a_108"];

/**
 * Put one email back to "Not Checked": delete its answer, claims and review,
 * keep the question so it stays in the inbox. Other emails are untouched.
 */
function resetEmail(emailId) {
  const questions = db.prepare("SELECT id FROM questions WHERE email_id = ?").all(emailId);
  if (questions.length === 0) {
    const err = new Error(`Email ${emailId} not found`);
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const questionIds = questions.map((q) => q.id);
  const marks = questionIds.map(() => "?").join(", ");
  const answers = db.prepare(`SELECT id FROM answers WHERE question_id IN (${marks})`).all(...questionIds);
  const answerIds = answers.map((a) => a.id);

  if (answerIds.some((id) => SEEDED_ANSWER_IDS.includes(id))) {
    const err = new Error(
      `${emailId} is part of the seeded demo data. Use POST /api/admin/reset to restore it.`
    );
    err.status = 409;
    err.code = "SEEDED_EMAIL";
    throw err;
  }

  let removedReviews = 0;
  const transaction = db.transaction(() => {
    answerIds.forEach((answerId) => {
      db.prepare("DELETE FROM claims WHERE answer_id = ?").run(answerId);
      removedReviews += db.prepare("DELETE FROM reviews WHERE answer_id = ?").run(answerId).changes;
      db.prepare("DELETE FROM answers WHERE id = ?").run(answerId);
    });
    db.prepare(`
      INSERT INTO system_audit_logs (action, details, timestamp)
      VALUES (?, ?, ?)
    `).run("EMAIL_RESET", JSON.stringify({ emailId, answerIds }), new Date().toISOString());
  });
  transaction();

  return {
    emailId,
    removedAnswers: answerIds.length,
    removedReviews,
    message: answerIds.length ? `${emailId} is back to Not Checked.` : `${emailId} was already Not Checked.`
  };
}

/**
 * Escalate an answer manually by officer
 */
function escalateAnswer(answerId, { note, officerId } = {}) {
  const answer = db.prepare("SELECT * FROM answers WHERE id = ?").get(answerId);
  if (!answer) {
    const err = new Error(`Answer ${answerId} not found`);
    err.status = 404;
    err.code = "NOT_FOUND";
    throw err;
  }

  const now = new Date().toISOString();
  const existingReview = db.prepare("SELECT id FROM reviews WHERE answer_id = ?").get(answerId);

  let reviewId = existingReview ? existingReview.id : "r_" + Date.now();

  const transaction = db.transaction(() => {
    db.prepare(`
      UPDATE answers
      SET status = 'pending_review',
          updated_at = ?
      WHERE id = ?
    `).run(now, answerId);

    if (existingReview) {
      db.prepare(`
        UPDATE reviews
        SET trigger = 'manual',
            status = 'pending',
            note = ?,
            created_at = ?
        WHERE id = ?
      `).run(note || "Officer requested manual review", now, existingReview.id);
    } else {
      db.prepare(`
        INSERT INTO reviews (id, question_id, answer_id, trigger, status, decision, reviewer, note, corrected_answer, created_at, decided_at)
        VALUES (?, ?, ?, 'manual', 'pending', NULL, NULL, ?, NULL, ?, NULL)
      `).run(reviewId, answer.question_id, answerId, note || "Officer requested manual review", now);
    }
  });

  transaction();

  return {
    reviewId,
    status: "pending",
    trigger: "manual"
  };
}

/**
 * Admin stats matching GET /api/stats in API contract
 */
function getStats() {
  const pendingTotal = db.prepare(`
    SELECT COUNT(*) AS count FROM reviews WHERE status = 'pending'
  `).get().count;

  const categoryRows = db.prepare(`
    SELECT q.category, COUNT(r.id) AS count
    FROM reviews r
    JOIN answers a ON r.answer_id = a.id
    JOIN questions q ON a.question_id = q.id
    WHERE r.status = 'pending'
    GROUP BY q.category
    ORDER BY count DESC
  `).all();

  // One row per question category (same column as pendingByCategory and the
  // review queue). Seeded and live answers both count.
  // A flagged answer can have several failure types, so the failure
  // columns can add up to more than sentToReview.
  const rows = db.prepare(`
    SELECT
      q.category AS category,
      COUNT(a.id) AS answered,
      SUM(CASE WHEN r.id IS NOT NULL THEN 1 ELSE 0 END) AS sentToReview,
      SUM(CASE WHEN r.status = 'pending' THEN 1 ELSE 0 END) AS pending,
      SUM(CASE WHEN r.id IS NOT NULL AND r.status <> 'pending' THEN 1 ELSE 0 END) AS resolved,
      SUM(CASE WHEN r.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims c WHERE c.answer_id = a.id AND LOWER(c.status) = 'contradicted'
      ) THEN 1 ELSE 0 END) AS contradicted,
      SUM(CASE WHEN r.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims c WHERE c.answer_id = a.id AND LOWER(c.status) = 'insufficient_evidence'
      ) THEN 1 ELSE 0 END) AS insufficientEvidence,
      SUM(CASE WHEN r.id IS NOT NULL AND EXISTS (
        SELECT 1 FROM claims c WHERE c.answer_id = a.id AND c.outdated = 1
      ) THEN 1 ELSE 0 END) AS outdated,
      SUM(CASE WHEN r.id IS NOT NULL AND a.safety_text_altered = 1 THEN 1 ELSE 0 END) AS safety,
      SUM(CASE WHEN r.trigger = 'manual' THEN 1 ELSE 0 END) AS manual
    FROM answers a
    JOIN questions q ON a.question_id = q.id
    LEFT JOIN reviews r ON r.answer_id = a.id
    GROUP BY q.category
  `).all();

  const empty = () => ({
    answered: 0,
    sentToReview: 0,
    pending: 0,
    resolved: 0,
    failures: { contradicted: 0, insufficientEvidence: 0, outdated: 0, safety: 0, manual: 0 }
  });
  const byKey = new Map(CATEGORIES.map((cat) => [cat, empty()]));

  rows.forEach((r) => {
    // Anything outside the agreed list is counted as uncategorised
    const key = byKey.has(r.category) ? r.category : "uncategorised";
    const t = byKey.get(key);
    t.answered += r.answered || 0;
    t.sentToReview += r.sentToReview || 0;
    t.pending += r.pending || 0;
    t.resolved += r.resolved || 0;
    Object.keys(t.failures).forEach((f) => {
      t.failures[f] += r[f] || 0;
    });
  });

  const byCategory = CATEGORIES.map((category) => {
    const { resolved, ...row } = byKey.get(category);
    return { category, ...row };
  });

  const sum = (field) => [...byKey.values()].reduce((total, row) => total + row[field], 0);

  return {
    pendingTotal,
    pendingByCategory: categoryRows.map((r) => ({
      category: r.category,
      count: r.count
    })),
    answeredTotal: sum("answered"),
    reviewedTotal: sum("sentToReview"),
    resolvedTotal: sum("resolved"),
    byCategory
  };
}

/**
 * Get answer by ID with attached claims and review info
 */
function getAnswerById(id) {
  const row = db.prepare(`
    SELECT 
      a.*,
      q.email_id,
      q.officer_id,
      q.customer_name,
      q.customer_email,
      q.card_type,
      q.question,
      r.id AS review_id,
      r.status AS review_status,
      r.trigger AS review_trigger,
      r.decision AS review_decision,
      r.reviewer AS reviewer_name,
      r.note AS review_note,
      r.corrected_answer,
      r.decided_at
    FROM answers a
    JOIN questions q ON a.question_id = q.id
    LEFT JOIN reviews r ON a.id = r.answer_id
    WHERE a.id = ?
  `).get(id);

  if (!row) return null;

  const claims = db.prepare("SELECT * FROM claims WHERE answer_id = ?").all(id);

  let sources = [];
  if (row.sources) {
    try {
      sources = JSON.parse(row.sources);
    } catch (e) {}
  }

  let review = null;
  if (row.review_id) {
    review = {
      reviewId: row.review_id,
      status: row.review_status,
      trigger: row.review_trigger
    };
  }

  return {
    questionId: row.question_id,
    answerId: row.id,
    id: row.id,
    emailId: row.email_id || row.question_id,
    officerId: row.officer_id,
    type: row.type,
    answer: row.corrected_answer || row.answer,
    category: row.category,
    confidence: row.confidence,
    status: row.status,
    claims: claims.map((c) => ({
      id: c.id,
      text: c.sentence,
      sentence: c.sentence,
      label: c.status.toLowerCase(),
      status: c.status.toLowerCase(),
      sourceId: c.source_id,
      quote: c.quote,
      outdated: Boolean(c.outdated),
      reason: c.reason
    })),
    sources,
    review
  };
}

/**
 * Get answer by Email ID / Question ID
 */
function getAnswerByEmailId(emailId) {
  const q = db.prepare("SELECT id FROM questions WHERE email_id = ? OR id = ?").get(emailId, emailId);
  if (!q) return null;
  const ans = db.prepare("SELECT id FROM answers WHERE question_id = ?").get(q.id);
  if (!ans) return null;
  return getAnswerById(ans.id);
}

/**
 * Fetch all emails/questions for officer workspace inbox
 */
function getAllEmails() {
  const rows = db.prepare(`
    SELECT 
      q.id,
      q.email_id,
      q.officer_id,
      q.customer_name,
      q.customer_email,
      q.card_type,
      q.category,
      q.question,
      q.created_at,
      a.id AS answer_id,
      a.status AS answer_status,
      a.confidence,
      a.updated_at AS answer_updated_at,
      r.id AS review_id,
      r.status AS review_status,
      r.trigger AS review_trigger
    FROM questions q
    LEFT JOIN answers a ON q.id = a.question_id
    LEFT JOIN reviews r ON a.id = r.answer_id
    ORDER BY q.id ASC
  `).all();

  return rows.map((r) => ({
    id: r.id,
    questionId: r.id,
    emailId: r.email_id || r.id,
    officerId: r.officer_id,
    customerName: r.customer_name,
    customerEmail: r.customer_email,
    cardType: r.card_type,
    category: r.category,
    question: r.question,
    createdAt: r.created_at,
    answerId: r.answer_id,
    status: r.answer_status,
    confidence: r.confidence,
    review: r.review_id ? { reviewId: r.review_id, status: r.review_status, trigger: r.review_trigger } : null
  }));
}

/**
 * Detailed category metrics for admin dashboard
 */
function getCategoryMetrics() {
  const stats = db.prepare(`
    SELECT 
      q.category,
      COUNT(a.id) AS totalQueries,
      SUM(CASE WHEN LOWER(a.status) = 'pending_review' THEN 1 ELSE 0 END) AS pendingReviews,
      SUM(CASE WHEN LOWER(a.status) LIKE 'reviewed_%' THEN 1 ELSE 0 END) AS reviewedCount,
      SUM(CASE WHEN LOWER(a.status) = 'approved' THEN 1 ELSE 0 END) AS autoApprovedCount
    FROM questions q
    LEFT JOIN answers a ON q.id = a.question_id
    GROUP BY q.category
  `).all();

  const statsMap = new Map();
  stats.forEach((s) => {
    if (s.category) statsMap.set(s.category.toLowerCase(), s);
  });

  const categories = CATEGORIES.map((cat) => {
    const s = statsMap.get(cat.toLowerCase()) || {
      totalQueries: 0,
      pendingReviews: 0,
      reviewedCount: 0,
      autoApprovedCount: 0
    };

    const total = s.totalQueries || 0;
    const pending = s.pendingReviews || 0;
    const reviewed = s.reviewedCount || 0;
    const autoApproved = s.autoApprovedCount || 0;

    return {
      category: cat,
      totalQueries: total,
      pendingReviews: pending,
      reviewedCount: reviewed,
      autoApprovedCount: autoApproved,
      reviewRatePct: total > 0 ? Math.round(((pending + reviewed) / total) * 100) : 0
    };
  });

  const totalSummary = db.prepare(`
    SELECT 
      COUNT(*) AS totalItems,
      SUM(CASE WHEN LOWER(status) = 'pending_review' THEN 1 ELSE 0 END) AS totalPending
    FROM answers
  `).get();

  return {
    summary: {
      totalItems: totalSummary.totalItems || 0,
      totalPending: totalSummary.totalPending || 0
    },
    categories
  };
}

/**
 * Reset database tables and re-seed clean initial data
 */
function resetSeedData() {
  db.exec(`
    DELETE FROM claims;
    DELETE FROM reviews;
    DELETE FROM answers;
    DELETE FROM questions;
    DELETE FROM approved_answers;
    DELETE FROM system_audit_logs;
  `);
  seedInitialDataIfEmpty();
}

module.exports = {
  db,
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
  resetEmail,
  CATEGORIES
};
