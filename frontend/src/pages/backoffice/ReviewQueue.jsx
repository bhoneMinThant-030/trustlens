import { useEffect, useState } from 'react'
import { decideReview, listReviews } from '../../api/backoffice'
import {
  CATEGORIES,
  STATUS_LABELS,
  TRIGGER_LABELS,
  categoryLabel,
  formatDateTime,
  formatPercent,
} from '../../constants/labels'
import { CheckIcon, RefreshIcon } from './Icons'
import ReviewDetail from './ReviewDetail'

// The four reasons an answer lands here, in the order the filter lists them.
const REASONS = ['auto_contradiction', 'auto_threshold', 'auto_safety', 'manual']

/*
  Review queue tab (reviewer).
  Left: flagged answers, oldest first. Right: the selected review,
  with its claims and sources, and the approve / correct form.
*/
function ReviewQueue({ user }) {
  const [reviews, setReviews] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [statusFilter, setStatusFilter] = useState('pending') // 'pending' | 'resolved'
  const [categoryFilter, setCategoryFilter] = useState('all')
  const [reasonFilter, setReasonFilter] = useState('all')
  const [selectedId, setSelectedId] = useState(null)
  const [toast, setToast] = useState('')

  const [reloadKey, setReloadKey] = useState(0)

  // Load every review; the filters work on the loaded list.
  // Runs on first render, when the role changes, and on Refresh.
  useEffect(() => {
    let ignore = false // Skip results from an older request.
    listReviews({ user })
      .then((data) => {
        if (!ignore) {
          setReviews(data.reviews)
          setError('')
        }
      })
      .catch((err) => !ignore && setError(err.message))
      .finally(() => !ignore && setLoading(false))
    return () => {
      ignore = true
    }
  }, [user, reloadKey])

  function loadReviews() {
    setLoading(true)
    setReloadKey((key) => key + 1)
  }

  // The reason counts follow the status and category filters, but not the reason filter itself.
  const reviewsBeforeReason = reviews
    .filter((review) =>
      statusFilter === 'pending' ? review.status === 'pending' : review.status !== 'pending',
    )
    .filter((review) => categoryFilter === 'all' || review.category === categoryFilter)

  const visibleReviews = reviewsBeforeReason
    .filter((review) => reasonFilter === 'all' || review.trigger === reasonFilter)
    // Pending: oldest first (first in, first out). Resolved: newest first.
    .sort((a, b) =>
      statusFilter === 'pending'
        ? a.createdAt.localeCompare(b.createdAt)
        : b.createdAt.localeCompare(a.createdAt),
    )

  const pendingCount = reviews.filter((review) => review.status === 'pending').length

  // If the selected review is filtered out, show the first visible one.
  const selected =
    visibleReviews.find((review) => review.id === selectedId) ?? visibleReviews[0] ?? null

  async function handleDecide(form) {
    const updated = await decideReview(selected.id, form, { user })
    setReviews((current) => current.map((review) => (review.id === updated.id ? updated : review)))
    // Move on to the next pending review; the decided one is under "Resolved".
    setSelectedId(null)
    window.scrollTo({ top: 0, behavior: 'smooth' })
    setToast(`${updated.id} ${updated.status}. The answer has been sent back to the officer.`)
    setTimeout(() => setToast(''), 4000)
  }

  return (
    <div className="bo-queue-page">
      <div className="bo-queue">
        <aside className="bo-card bo-queue-list">
          <div className="bo-list-head">
            <div className="bo-pills" role="tablist">
              <button
                role="tab"
                aria-selected={statusFilter === 'pending'}
                className={statusFilter === 'pending' ? 'active' : ''}
                onClick={() => setStatusFilter('pending')}
              >
                Pending <span className="bo-count">{pendingCount}</span>
              </button>
              <button
                role="tab"
                aria-selected={statusFilter === 'resolved'}
                className={statusFilter === 'resolved' ? 'active' : ''}
                onClick={() => setStatusFilter('resolved')}
              >
                Resolved
              </button>
            </div>
            <button
              className="bo-icon-button"
              onClick={loadReviews}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshIcon size={18} />
            </button>
          </div>

          <div className="bo-filter-row">
            <select
              aria-label="Filter by reason"
              value={reasonFilter}
              onChange={(event) => setReasonFilter(event.target.value)}
            >
              <option value="all">All reasons</option>
              {REASONS.map((trigger) => (
                <option key={trigger} value={trigger}>
                  {`${TRIGGER_LABELS[trigger]} (${
                    reviewsBeforeReason.filter((review) => review.trigger === trigger).length
                  })`}
                </option>
              ))}
            </select>
            <select
              aria-label="Filter by category"
              value={categoryFilter}
              onChange={(event) => setCategoryFilter(event.target.value)}
            >
              <option value="all">All categories</option>
              {CATEGORIES.map((category) => (
                <option key={category} value={category}>
                  {categoryLabel(category)}
                </option>
              ))}
            </select>
          </div>

          {loading && <p className="bo-muted bo-list-note">Loading reviews...</p>}
          {!loading && !error && visibleReviews.length > 0 && (
            <p className="bo-muted bo-list-note">
              {visibleReviews.length} {visibleReviews.length === 1 ? 'review' : 'reviews'}
              {statusFilter === 'pending' ? ', oldest first' : ', newest first'}
            </p>
          )}
          {error && <p className="bo-error">{error}</p>}
          {!loading && !error && visibleReviews.length === 0 && (
            <p className="bo-empty">
              {reasonFilter !== 'all' || categoryFilter !== 'all'
                ? 'No reviews match these filters.'
                : statusFilter === 'pending'
                  ? 'No answers waiting for review.'
                  : 'No resolved reviews yet.'}
            </p>
          )}

          <div className="bo-rows">
            {visibleReviews.map((review) => (
              <button
                key={review.id}
                className={`bo-row ${selected?.id === review.id ? 'selected' : ''}`}
                onClick={() => setSelectedId(review.id)}
              >
                <span className="bo-row-title">{review.question}</span>
                <span className="bo-row-meta">
                  {review.id} · {categoryLabel(review.category)} ·{' '}
                  {formatDateTime(review.createdAt)}
                </span>
                <span className="bo-row-foot">
                  <span
                    className={`bo-tag ${
                      review.status === 'pending'
                        ? `bo-trigger-${review.trigger}`
                        : `bo-status-${review.status}`
                    }`}
                  >
                    {review.status === 'pending'
                      ? TRIGGER_LABELS[review.trigger]
                      : STATUS_LABELS[review.status]}
                  </span>
                  <span className="bo-row-confidence">
                    Confidence <strong>{formatPercent(review.confidence)}</strong>
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        <section className="bo-queue-detail">
          {toast && (
            <p className="bo-toast" role="status">
              <CheckIcon size={18} />
              {toast}
            </p>
          )}
          {selected ? (
            <ReviewDetail
              review={selected}
              canDecide={user.role === 'reviewer'}
              onDecide={handleDecide}
            />
          ) : (
            !loading && (
              <div className="bo-card">
                <p className="bo-empty">Select a review to see its claims and sources.</p>
              </div>
            )
          )}
        </section>
      </div>
    </div>
  )
}

export default ReviewQueue
