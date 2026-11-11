import { useEffect, useState } from 'react'
import { createApprovedAnswer, listApprovedAnswers, listReviews } from '../../api/backoffice'
import { CATEGORIES, categoryLabel } from '../../constants/labels'
import { SearchIcon } from './Icons'

/*
  Approved answers tab (admin).
  Standard questions return this wording word for word, skipping the AI.
  Corrected answers from the review queue can be saved here for reuse.
*/
function ApprovedAnswers({ user }) {
  const [answers, setAnswers] = useState(null)
  const [candidates, setCandidates] = useState([])
  const [search, setSearch] = useState('')
  const [category, setCategory] = useState('all')
  const [error, setError] = useState('')
  const [savingId, setSavingId] = useState(null)

  useEffect(() => {
    let ignore = false
    Promise.all([listApprovedAnswers({ user }), listReviews({ status: 'corrected', user })])
      .then(([approvedData, reviewData]) => {
        if (ignore) return
        setAnswers(approvedData.approvedAnswers)
        setCandidates(reviewData.reviews)
      })
      .catch((err) => !ignore && setError(err.message))
    return () => {
      ignore = true
    }
  }, [user])

  async function promote(review) {
    setSavingId(review.id)
    try {
      const created = await createApprovedAnswer(
        {
          fromReviewId: review.id,
          answer: review.decision.correctedAnswer,
          category: review.category,
          sampleQuestions: [review.question],
        },
        { user },
      )
      setAnswers((current) => [created, ...current])
    } catch (err) {
      setError(err.message)
    } finally {
      setSavingId(null)
    }
  }

  if (error) return <p className="bo-error">{error}</p>
  if (!answers) return <p className="bo-muted">Loading approved answers...</p>

  // Corrected reviews that have not been saved as approved answers yet.
  const promotedIds = new Set(answers.map((answer) => answer.fromReviewId).filter(Boolean))
  const waiting = candidates.filter((review) => !promotedIds.has(review.id))

  const query = search.trim().toLowerCase()
  const visible = answers.filter((answer) => {
    if (category !== 'all' && answer.category !== category) return false
    if (!query) return true
    return [answer.answer, answer.id, ...answer.sampleQuestions]
      .join(' ')
      .toLowerCase()
      .includes(query)
  })

  return (
    <div className="bo-approved">
      {waiting.length > 0 && (
        <section className="bo-card bo-candidates">
          <h2 className="bo-section-title">Corrected answers ready to save ({waiting.length})</h2>
          <p className="bo-muted">
            A reviewer corrected these. Saving one makes it the approved wording for that question.
          </p>
          {waiting.map((review) => (
            <div className="bo-candidate" key={review.id}>
              <div>
                <strong>{review.question}</strong>
                <p>{review.decision.correctedAnswer}</p>
                <small className="bo-muted">
                  {categoryLabel(review.category)} · corrected by {review.decision.reviewer} ·{' '}
                  {review.id}
                </small>
              </div>
              <button
                className="bo-primary-button bo-small-button"
                disabled={savingId === review.id || user.role !== 'admin'}
                onClick={() => promote(review)}
              >
                {savingId === review.id ? 'Saving...' : 'Save as approved answer'}
              </button>
            </div>
          ))}
        </section>
      )}

      <div className="bo-filter-row bo-approved-filters">
        <label className="bo-search">
          <SearchIcon size={18} />
          <input
            type="search"
            aria-label="Search questions or wording"
            placeholder="Search questions or wording"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          />
        </label>
        <select
          aria-label="Filter by category"
          value={category}
          onChange={(event) => setCategory(event.target.value)}
        >
          <option value="all">All categories</option>
          {CATEGORIES.map((item) => (
            <option key={item} value={item}>
              {categoryLabel(item)}
            </option>
          ))}
        </select>
      </div>

      {visible.length === 0 && <p className="bo-empty">No approved answers match.</p>}

      <div className="bo-approved-list">
        {visible.map((answer) => (
          <article className="bo-card bo-approved-card" key={answer.id}>
            <div className="bo-approved-top">
              <div className="bo-approved-title">
                <strong>{categoryLabel(answer.category)}</strong>
                <span className="bo-mono">
                  {answer.id} · v{answer.version}
                </span>
              </div>
              <span className="bo-approved-used">
                Used <strong>{answer.timesUsed}</strong> {answer.timesUsed === 1 ? 'time' : 'times'}
              </span>
            </div>

            <ul className="bo-sample-questions">
              {answer.sampleQuestions.map((question) => (
                <li key={question}>{question}</li>
              ))}
            </ul>

            <p className="bo-answer-box">{answer.answer}</p>

            <p className="bo-muted">
              Approved by {answer.owner} on {answer.approvedAt}
              {answer.fromReviewId && ` · from review ${answer.fromReviewId}`}
              {answer.sourceUrl && (
                <>
                  {' · '}
                  <a href={answer.sourceUrl} target="_blank" rel="noreferrer">
                    Source
                  </a>
                </>
              )}
            </p>
          </article>
        ))}
      </div>
    </div>
  )
}

export default ApprovedAnswers
