/*
  Sample data for the admin Dashboard (VITE_USE_MOCK=true only).
  Synthetic: built from the knowledge base and planted test documents.
  Same shape as GET /api/stats -> byCategory in docs/api-contract.md.
*/

// Answers checked per category this week, and why they were flagged.
// "pending" is not stored here: it is counted live from the review queue.
export const mockCategoryStats = [
  {
    category: 'applying-eligibility',
    answered: 14,
    sentToReview: 3,
    failures: { contradicted: 2, insufficientEvidence: 1, outdated: 2, manual: 0 },
  },
  {
    category: 'card-types-benefits',
    answered: 18,
    sentToReview: 6,
    failures: { contradicted: 3, insufficientEvidence: 1, outdated: 0, manual: 2 },
  },
  {
    category: 'fees-charges',
    answered: 22,
    sentToReview: 5,
    failures: { contradicted: 1, insufficientEvidence: 4, outdated: 1, manual: 0 },
  },
  {
    category: 'rewards-cashback',
    answered: 16,
    sentToReview: 7,
    failures: { contradicted: 5, insufficientEvidence: 1, outdated: 2, manual: 1 },
  },
  {
    category: 'payments-billing',
    answered: 12,
    sentToReview: 3,
    failures: { contradicted: 1, insufficientEvidence: 2, outdated: 0, manual: 0 },
  },
  {
    category: 'instalments-balance-transfer',
    answered: 9,
    sentToReview: 3,
    failures: { contradicted: 2, insufficientEvidence: 0, outdated: 2, manual: 1 },
  },
  {
    category: 'lost-stolen-fraud',
    answered: 15,
    sentToReview: 4,
    failures: { contradicted: 2, insufficientEvidence: 0, outdated: 1, manual: 0 },
  },
]
