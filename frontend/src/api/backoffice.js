/*
  Back office API calls (reviewer and admin).
  Endpoints and payloads: docs/api-contract.md, section 2.

  In mock mode the data lives in memory, so a decision made in the
  Review queue stays until the page is reloaded.
*/

import { request, USE_MOCK, ApiError } from './client'
import { mockReviews } from '../data/mockReviews'

// ---------- Mock store (used until the Node API is ready) ----------

let mockReviewStore = structuredClone(mockReviews)

// Small delay so loading states can be seen and tested.
function mockDelay(value, ms = 250) {
  return new Promise((resolve) => setTimeout(() => resolve(structuredClone(value)), ms))
}

function findMockReview(reviewId) {
  const review = mockReviewStore.find((item) => item.id === reviewId)
  if (!review) throw new ApiError('NOT_FOUND', `Review ${reviewId} not found`, 404)
  return review
}

// ---------- Reviews ----------

// GET /api/reviews?status=pending
// Leave `status` empty to get every review (pending and resolved).
export async function listReviews({ status, user } = {}) {
  if (USE_MOCK) {
    const reviews = status
      ? mockReviewStore.filter((review) => review.status === status)
      : mockReviewStore
    return mockDelay({ reviews })
  }
  const query = status ? `?status=${encodeURIComponent(status)}` : ''
  return request(`/api/reviews${query}`, { user })
}

// GET /api/reviews/:reviewId
export async function getReview(reviewId, { user } = {}) {
  if (USE_MOCK) return mockDelay(findMockReview(reviewId))
  return request(`/api/reviews/${reviewId}`, { user })
}

// POST /api/reviews/:reviewId/decision
// decision: 'approved' | 'corrected'. correctedAnswer is only needed for 'corrected'.
export async function decideReview(reviewId, { decision, correctedAnswer, reason }, { user }) {
  if (USE_MOCK) {
    const review = findMockReview(reviewId)
    if (review.status !== 'pending') {
      throw new ApiError('ALREADY_DECIDED', 'This review has already been decided.', 409)
    }
    review.status = decision
    review.decision = {
      decision,
      correctedAnswer: decision === 'corrected' ? correctedAnswer : null,
      reason,
      reviewer: user.id,
      decidedAt: new Date().toISOString(),
    }
    return mockDelay(review)
  }
  return request(`/api/reviews/${reviewId}/decision`, {
    method: 'POST',
    user,
    body: {
      decision,
      ...(decision === 'corrected' ? { correctedAnswer } : {}),
      reason,
    },
  })
}
