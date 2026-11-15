/*
  Back office API calls (reviewer and admin).
  Endpoints and payloads: docs/api-contract.md, section 2.

  With VITE_USE_MOCK=true the data lives in memory, so a decision made
  in the Review queue stays until the page is reloaded.
*/

import { request, USE_MOCK, ApiError } from './client'
import { mockReviews } from '../data/mockReviews'
import { mockCategoryStats } from '../data/mockAdmin'

// ---------- Mock store (VITE_USE_MOCK=true only) ----------

const mockReviewStore = structuredClone(mockReviews)

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

// GET /api/stats
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

// ---------- Flagged documents (admin) ----------

/*
  Same rule as the backend: every unofficial or outdated source in an
  answer a reviewer corrected, grouped by document and version.
  Only used with VITE_USE_MOCK=true.
*/
function mockFlaggedDocuments() {
  const groups = new Map()
  const corrected = mockReviewStore.filter((review) => review.status === 'corrected')

  for (const review of corrected) {
    const officialSources = review.sources
      .filter((source) => source.authority === 'official' && !source.outdated)
      .map(({ id, title, version, excerpt }) => ({ id, title, version, excerpt }))

    for (const source of review.sources) {
      const unofficial = source.authority === 'unofficial'
      if (!unofficial && !source.outdated) continue

      const key = `${source.docId}@${source.version}`
      if (!groups.has(key)) {
        groups.set(key, {
          docId: source.docId,
          version: source.version,
          title: source.title,
          category: source.category,
          reason: unofficial ? 'unofficial' : 'outdated',
          newerVersion: source.newerVersion ?? null,
          corrections: 0,
          lastFlaggedAt: null,
          excerpt: source.excerpt,
          evidence: [],
        })
      }
      const group = groups.get(key)
      if (group.evidence.some((item) => item.reviewId === review.id)) continue
      group.corrections += 1
      group.lastFlaggedAt = review.decision.decidedAt
      group.evidence.push({
        reviewId: review.id,
        question: review.question,
        aiAnswer: review.answer,
        correctedAnswer: review.decision.correctedAnswer,
        reviewer: review.decision.reviewer,
        decidedAt: review.decision.decidedAt,
        officialSources,
      })
    }
  }

  return [...groups.values()].sort(
    (a, b) => b.corrections - a.corrections || b.lastFlaggedAt.localeCompare(a.lastFlaggedAt),
  )
}

// GET /api/flagged-documents
export async function listFlaggedDocuments({ user } = {}) {
  if (USE_MOCK) return mockDelay({ flaggedDocuments: mockFlaggedDocuments() })
  return request('/api/flagged-documents', { user })
}
