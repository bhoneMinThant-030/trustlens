/*
  Shared values from docs/api-contract.md ("Shared values" section),
  with the text we show on screen for each one.
*/

// Node sends an answer to review when confidence is below this.
// Starts at 0.7 and will be tuned using the test set.
export const CONFIDENCE_THRESHOLD = 0.7

export const CATEGORIES = [
  'applying-eligibility',
  'card-types-benefits',
  'fees-charges',
  'rewards-cashback',
  'payments-billing',
  'instalments-balance-transfer',
  'lost-stolen-fraud',
]

export const CATEGORY_LABELS = {
  'applying-eligibility': 'Applying and eligibility',
  'card-types-benefits': 'Card types and benefits',
  'fees-charges': 'Fees and charges',
  'rewards-cashback': 'Rewards and cashback',
  'payments-billing': 'Payments and billing',
  'instalments-balance-transfer': 'Instalments and balance transfer',
  'lost-stolen-fraud': 'Lost, stolen and fraud',
  uncategorised: 'Uncategorised',
}

export const CLAIM_LABELS = {
  supported: 'Supported',
  contradicted: 'Contradicted',
  insufficient_evidence: 'Insufficient evidence',
}

export const TRIGGER_LABELS = {
  auto_threshold: 'Low confidence',
  auto_contradiction: 'Contradicted claim',
  auto_safety: 'Safety wording changed',
  manual: 'Sent by officer',
}

export const STATUS_LABELS = {
  pending: 'Pending',
  approved: 'Approved',
  corrected: 'Corrected',
}

// Demo users. There is no login; the API reads these from headers.
export const DEMO_USERS = {
  reviewer: { id: 'reviewer-1', role: 'reviewer', name: 'Reviewer 1' },
  admin: { id: 'admin-1', role: 'admin', name: 'Admin 1' },
}

export function categoryLabel(category) {
  return CATEGORY_LABELS[category] ?? category
}

export function formatPercent(value) {
  if (value === null || value === undefined) return '–'
  return `${Math.round(value * 100)}%`
}

export function formatDateTime(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleString('en-SG', {
    day: 'numeric',
    month: 'short',
    hour: '2-digit',
    minute: '2-digit',
  })
}
