import { useEffect, useState } from 'react'
import { decideReview, listReviews } from '../../api/backoffice'
import {
  CATEGORIES,
  TRIGGER_LABELS,
  categoryLabel,
  formatDateTime,
  formatPercent,
} from '../../constants/labels'
import ReviewDetail from './ReviewDetail'

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

  const visibleReviews = reviews
    .filter((review) =>
      statusFilter === 'pending' ? review.status === 'pending' : review.status !== 'pending',
    )
    .filter((review) => categoryFilter === 'all' || review.category === categoryFilter)
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
    setToast(`${updated.id} ${updated.status}. The answer has been sent back to the officer.`)
    setTimeout(() => setToast(''), 4000)
  }

  return (
    <div className="bo-queue">
      <aside className="bo-card bo-queue-list">
        <div className="bo-queue-tabs" role="tablist">
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

        <div className="bo-filter-row">
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
          <button className="bo-secondary-button" onClick={loadReviews} disabled={loading}>
            Refresh
          </button>
        </div>

        {loading && <p className="bo-muted">Loading reviews...</p>}
        {error && <p className="bo-error">{error}</p>}
        {!loading && !error && visibleReviews.length === 0 && (
          <p className="bo-empty">
            {statusFilter === 'pending'
              ? 'No answers waiting for review.'
              : 'No resolved reviews yet.'}
          </p>
        )}

        {visibleReviews.map((review) => (
          <button
            key={review.id}
            className={`bo-queue-item ${selected?.id === review.id ? 'selected' : ''}`}
            onClick={() => setSelectedId(review.id)}
          >
            <div className="bo-queue-item-top">
              <span className={`bo-pill bo-trigger-${review.trigger}`}>
                {TRIGGER_LABELS[review.trigger]}
              </span>
              <span className="bo-queue-confidence">{formatPercent(review.confidence)}</span>
            </div>
            <strong>{review.question}</strong>
            <small>
              {categoryLabel(review.category)} · {formatDateTime(review.createdAt)}
            </small>
          </button>
        ))}
      </aside>

      <section className="bo-card bo-queue-detail">
        {toast && <p className="bo-toast">{toast}</p>}
        {selected ? (
          <ReviewDetail
            review={selected}
            canDecide={user.role === 'reviewer'}
            onDecide={handleDecide}
          />
        ) : (
          !loading && <p className="bo-empty">Select a review to see its claims and sources.</p>
        )}
      </section>
    </div>
  )
}

export default ReviewQueue
