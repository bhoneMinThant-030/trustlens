/*
  Sample data for the admin tabs: Dashboard, Recommendations, Approved answers.
  Synthetic: built from the knowledge base and planted test documents.

  The shapes for stats, recommendations and approved answers go beyond
  what docs/api-contract.md has today. They are a proposal for Backend 2.
*/

// Answers checked per category this week, and why they were flagged.
// "pending" is not stored here: it is counted live from the review queue.
export const mockCategoryStats = [
  {
    category: 'applying-eligibility',
    answered: 14,
    sentToReview: 3,
    failures: { contradicted: 2, insufficientEvidence: 1, outdated: 2, safety: 0, manual: 0 },
  },
  {
    category: 'card-types-benefits',
    answered: 18,
    sentToReview: 6,
    failures: { contradicted: 3, insufficientEvidence: 1, outdated: 0, safety: 0, manual: 2 },
  },
  {
    category: 'fees-charges',
    answered: 22,
    sentToReview: 5,
    failures: { contradicted: 1, insufficientEvidence: 4, outdated: 1, safety: 0, manual: 0 },
  },
  {
    category: 'rewards-cashback',
    answered: 16,
    sentToReview: 7,
    failures: { contradicted: 5, insufficientEvidence: 1, outdated: 2, safety: 0, manual: 1 },
  },
  {
    category: 'payments-billing',
    answered: 12,
    sentToReview: 3,
    failures: { contradicted: 1, insufficientEvidence: 2, outdated: 0, safety: 0, manual: 0 },
  },
  {
    category: 'instalments-balance-transfer',
    answered: 9,
    sentToReview: 3,
    failures: { contradicted: 2, insufficientEvidence: 0, outdated: 2, safety: 0, manual: 1 },
  },
  {
    category: 'lost-stolen-fraud',
    answered: 15,
    sentToReview: 4,
    failures: { contradicted: 2, insufficientEvidence: 0, outdated: 1, safety: 2, manual: 0 },
  },
]

/*
  Recommendation types:
    retire_document      a superseded version is still being cited
    exclude_source       an unofficial document keeps contradicting official ones
    add_approved_answer  a common question always passes, so fix its wording
    add_document         a topic is missing from the knowledge base
  Nothing changes until an admin approves; then the failed tests re-run.
*/
export const mockRecommendations = [
  {
    id: 'rec_01',
    type: 'retire_document',
    title: 'Retire the 2023.05 version of "Disputing card transactions"',
    detail:
      'Answers still quote the old 30-day reporting window. The 2026.11 version says 7 days. Retiring the old version stops it from being retrieved.',
    category: 'lost-stolen-fraud',
    evidence: {
      docId: 'dispute-card-transactions',
      version: '2023.05',
      affectedAnswers: 3,
      failedTests: ['t031', 't034', 't038'],
    },
    status: 'pending',
    createdAt: '2026-11-04T08:00:00+08:00',
    decision: null,
    retest: null,
    // Mock only: what the re-test returns after approval.
    mockRetestResult: { passed: 3, total: 3 },
  },
  {
    id: 'rec_02',
    type: 'exclude_source',
    title: 'Stop using "Staff quick reference: OCBC 365 cashback" as evidence',
    detail:
      'This unofficial note says the cap is S$250 with no minimum spend. The official T&Cs say S$160 and S$800. It contradicted official sources in 4 answers.',
    category: 'rewards-cashback',
    evidence: {
      docId: '365-cashback-staff-quick-reference',
      version: '2026.10',
      affectedAnswers: 4,
      failedTests: ['t012', 't014', 't015', 't019'],
    },
    status: 'pending',
    createdAt: '2026-11-04T08:00:00+08:00',
    decision: null,
    retest: null,
    mockRetestResult: { passed: 4, total: 4 },
  },
  {
    id: 'rec_03',
    type: 'add_document',
    title: 'Add a source for when the supplementary card fee waiver starts',
    detail:
      'Officers asked 3 times whether the two-year waiver counts from the principal or supplementary card issue date. No document answers this, so the claims had insufficient evidence.',
    category: 'card-types-benefits',
    evidence: {
      docId: null,
      version: null,
      affectedAnswers: 3,
      failedTests: ['t008', 't009', 't022'],
    },
    status: 'pending',
    createdAt: '2026-11-04T08:00:00+08:00',
    decision: null,
    retest: null,
    // Honest result: adding a document does not fix everything.
    mockRetestResult: { passed: 2, total: 3 },
  },
  {
    id: 'rec_04',
    type: 'add_approved_answer',
    title: 'Save an approved answer for "How do I report a lost card?"',
    detail:
      'Asked 6 times this week. Every generated answer passed with 100% confidence. Approved wording skips the AI and keeps the safety text fixed.',
    category: 'lost-stolen-fraud',
    evidence: {
      docId: 'report-lost-card',
      version: '2026.11',
      affectedAnswers: 6,
      failedTests: [],
    },
    status: 'approved',
    createdAt: '2026-11-03T08:00:00+08:00',
    decision: {
      decision: 'approved',
      reason: 'Common question with stable wording.',
      admin: 'admin-1',
      decidedAt: '2026-11-03T17:20:00+08:00',
    },
    retest: { status: 'done', passed: 6, total: 6, finishedAt: '2026-11-03T17:22:00+08:00' },
    mockRetestResult: { passed: 6, total: 6 },
  },
]

// Same shape as data/approved_answers/approved_answers.example.json,
// plus timesUsed (proposed, for the dashboard).
export const mockApprovedAnswers = [
  {
    id: 'aa_report_lost_card',
    version: '2026.11',
    category: 'lost-stolen-fraud',
    sampleQuestions: [
      'How do I report a lost card?',
      'My credit card was stolen, what should I do?',
    ],
    answer:
      'You can report a lost or stolen card 24 hours a day by calling OCBC on +65 6363 3333, or through the OCBC app. Once reported, all functions of the card are suspended and future transactions are declined. You are not liable for unauthorised transactions made after you notify the Bank. OCBC employees will never ask you to reveal your PIN/OTP or transfer funds to personal accounts.',
    sourceUrl:
      'https://www.ocbc.com/personal-banking/security/secure-banking-ways/report-lost-card',
    owner: 'admin-1',
    approvedAt: '2026-11-03',
    timesUsed: 6,
    fromReviewId: null,
  },
  {
    id: 'aa_fee_waiver_request',
    version: '2026.11',
    category: 'fees-charges',
    sampleQuestions: [
      'How do I request a fee waiver?',
      'Can I ask for my annual fee to be waived?',
    ],
    answer:
      'You can request a credit card fee waiver in the OCBC app: tap "More", then under "Card Services" tap "Request fee waiver", select your card and submit. On OCBC Internet Banking, go to "Customer service", then under "Cards" select "Credit card fee waiver". Approval is at the Bank’s discretion.',
    sourceUrl:
      'https://ocbc.com/personal-banking/digital-banking/step-by-step-guides/cards-management/card-fee-waiver',
    owner: 'admin-1',
    approvedAt: '2026-11-03',
    timesUsed: 4,
    fromReviewId: null,
  },
  {
    id: 'aa_minimum_age',
    version: '2026.11',
    category: 'applying-eligibility',
    sampleQuestions: [
      'How old do I need to be to apply for a credit card?',
      'What is the minimum age for a principal card?',
    ],
    answer:
      'To apply for a principal credit card, you must be at least 21 years old. This applies to Singaporeans, Permanent Residents and foreigners. All applications are subject to the Bank’s approval.',
    sourceUrl:
      'https://www.ocbc.com/personal-banking/help-and-support/cards/credit-card-applications',
    owner: 'admin-1',
    approvedAt: '2026-11-03',
    timesUsed: 2,
    fromReviewId: null,
  },
]
