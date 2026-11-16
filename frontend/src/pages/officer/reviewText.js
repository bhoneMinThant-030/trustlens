/*
  Words the officer screen and the Ask TrustLens chat both show.
*/

// Why an answer was sent to a reviewer (review.trigger), in the officer's words.
export const REVIEW_REASONS = {
  auto_contradiction: 'A claim contradicts an official source',
  auto_threshold: 'Not enough evidence to trust it',
  manual: 'Review requested by an officer',
}

// Inbox chip for one email: its label and colour.
export function inboxStatus(email) {
  if (email.answerId == null) return { label: 'Not checked', tone: 'neutral' }
  switch (email.status) {
    case 'reviewed_corrected':
      return { label: 'Reviewed: corrected', tone: 'good' }
    case 'reviewed_approved':
      return { label: 'Reviewed: approved', tone: 'good' }
    case 'pending_review':
      return { label: 'In review', tone: 'wait' }
    case 'approved':
      return { label: 'Verified', tone: 'good' }
    default:
      return { label: 'Checked', tone: 'neutral' }
  }
}
