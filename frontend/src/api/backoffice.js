/*
  Back office API calls (reviewer and admin).
  Endpoints and payloads: docs/api-contract.md, section 2.

  In mock mode the data lives in memory, so a decision made in the
  Review queue stays until the page is reloaded.
*/

import { request, USE_MOCK, ApiError } from './client'
import { mockReviews } from '../data/mockReviews'
import { mockApprovedAnswers, mockCategoryStats, mockRecommendations } from '../data/mockAdmin'

// ---------- Mock store (used until the Node API is ready) ----------

const mockReviewStore = structuredClone(mockReviews)
const mockRecommendationStore = structuredClone(mockRecommendations)
let mockApprovedStore = structuredClone(mockApprovedAnswers)

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

// ---------- Dashboard (admin) ----------

/*
  GET /api/stats
  The contract has pendingTotal and pendingByCategory. The rest
  (answeredTotal, reviewedTotal, byCategory) is a proposal for Backend 2.
*/
export async function getStats({ user } = {}) {
  if (USE_MOCK) {
    const pending = mockReviewStore.filter((review) => review.status === 'pending')
    const byCategory = mockCategoryStats.map((row) => ({
      ...row,
      pending: pending.filter((review) => review.category === row.category).length,
    }))
    return mockDelay({
      pendingTotal: pending.length,
      pendingByCategory: byCategory
        .filter((row) => row.pending > 0)
        .map((row) => ({ category: row.category, count: row.pending })),
      answeredTotal: byCategory.reduce((sum, row) => sum + row.answered, 0),
      reviewedTotal: byCategory.reduce((sum, row) => sum + row.sentToReview, 0),
      resolvedTotal: mockReviewStore.length - pending.length,
      byCategory,
    })
  }
  return request('/api/stats', { user })
}

// ---------- Recommendations (admin, proposed endpoints) ----------

function publicRecommendation(recommendation) {
  // Hide the mock-only field from the screen code.
  // eslint-disable-next-line no-unused-vars
  const { mockRetestResult, ...rest } = recommendation
  return rest
}

// GET /api/recommendations
export async function listRecommendations({ user } = {}) {
  if (USE_MOCK) {
    return mockDelay({ recommendations: mockRecommendationStore.map(publicRecommendation) })
  }
  return request('/api/recommendations', { user })
}

// GET /api/recommendations/:id (poll this while a re-test is running)
export async function getRecommendation(id, { user } = {}) {
  if (USE_MOCK) {
    const recommendation = mockRecommendationStore.find((item) => item.id === id)
    if (!recommendation) throw new ApiError('NOT_FOUND', `Recommendation ${id} not found`, 404)
    return mockDelay(publicRecommendation(recommendation))
  }
  return request(`/api/recommendations/${id}`, { user })
}

// POST /api/recommendations/:id/decision
// decision: 'approved' | 'rejected'. Approving starts a re-test of the failed tests.
export async function decideRecommendation(id, { decision, reason }, { user }) {
  if (USE_MOCK) {
    const recommendation = mockRecommendationStore.find((item) => item.id === id)
    if (!recommendation) throw new ApiError('NOT_FOUND', `Recommendation ${id} not found`, 404)
    recommendation.status = decision
    recommendation.decision = {
      decision,
      reason,
      admin: user.id,
      decidedAt: new Date().toISOString(),
    }
    if (decision === 'approved') {
      recommendation.retest = { status: 'running', passed: null, total: null, finishedAt: null }
      // Pretend the re-test takes a few seconds.
      setTimeout(() => {
        recommendation.retest = {
          status: 'done',
          ...recommendation.mockRetestResult,
          finishedAt: new Date().toISOString(),
        }
      }, 2500)
    }
    return mockDelay(publicRecommendation(recommendation))
  }
  return request(`/api/recommendations/${id}/decision`, {
    method: 'POST',
    user,
    body: { decision, reason },
  })
}

// ---------- Approved answers (admin, proposed endpoints) ----------

// GET /api/approved-answers
export async function listApprovedAnswers({ user } = {}) {
  if (USE_MOCK) return mockDelay({ approvedAnswers: mockApprovedStore })
  return request('/api/approved-answers', { user })
}

// POST /api/approved-answers
// Saves a reviewer-corrected answer as approved wording for reuse.
export async function createApprovedAnswer(
  { fromReviewId, answer, category, sampleQuestions },
  { user },
) {
  if (USE_MOCK) {
    const created = {
      id: `aa_${fromReviewId}`,
      version: '2026.11',
      category,
      sampleQuestions,
      answer,
      sourceUrl: null,
      owner: user.id,
      approvedAt: new Date().toISOString().slice(0, 10),
      timesUsed: 0,
      fromReviewId,
    }
    mockApprovedStore = [created, ...mockApprovedStore]
    return mockDelay(created)
  }
  return request('/api/approved-answers', {
    method: 'POST',
    user,
    body: { fromReviewId, answer, category, sampleQuestions },
  })
}
