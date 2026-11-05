import { useEffect, useRef, useState } from 'react'
import { decideRecommendation, getRecommendation, listRecommendations } from '../../api/backoffice'
import { categoryLabel, formatDateTime } from '../../constants/labels'

/*
  Recommendations tab (admin).
  TrustLens suggests fixes from recurring failures. Nothing changes
  automatically: an admin approves, then the failed tests re-run.
*/

const TYPE_LABELS = {
  retire_document: 'Retire outdated document',
  exclude_source: 'Exclude unofficial source',
  add_document: 'Missing topic',
  add_approved_answer: 'New approved answer',
}

function RetestResult({ retest }) {
  if (!retest) return null
  if (retest.status === 'running') {
    return <p className="bo-retest bo-retest-running">Re-running failed tests...</p>
  }
  const allPassed = retest.passed === retest.total
  return (
    <p className={`bo-retest ${allPassed ? 'bo-retest-pass' : 'bo-retest-partial'}`}>
      Re-test: {retest.passed} of {retest.total} tests now pass
      {!allPassed && '. Some still fail and need another fix.'}
    </p>
  )
}

function RecommendationCard({ recommendation, canDecide, onDecide }) {
  const [rejecting, setRejecting] = useState(false)
  const [reason, setReason] = useState('')
  const [busy, setBusy] = useState(false)
  const { evidence, decision } = recommendation

  async function decide(choice) {
    setBusy(true)
    try {
      await onDecide(recommendation.id, { decision: choice, reason: reason.trim() || null })
    } finally {
      setBusy(false)
    }
  }

  return (
    <article className={`bo-card bo-rec bo-rec-${recommendation.status}`}>
      <div className="bo-pill-row">
        <span className={`bo-pill bo-rec-type-${recommendation.type}`}>
          {TYPE_LABELS[recommendation.type]}
        </span>
        <span className="bo-pill">{categoryLabel(recommendation.category)}</span>
      </div>

      <h3>{recommendation.title}</h3>
      <p>{recommendation.detail}</p>

      <dl className="bo-evidence">
        <div>
          <dt>Affected answers</dt>
          <dd>{evidence.affectedAnswers}</dd>
        </div>
        {evidence.docId && (
          <div>
            <dt>Document</dt>
            <dd>
              {evidence.docId} v{evidence.version}
            </dd>
          </div>
        )}
        <div>
          <dt>Failed tests</dt>
          <dd>{evidence.failedTests.length ? evidence.failedTests.join(', ') : 'None'}</dd>
        </div>
      </dl>

      {recommendation.status === 'pending' && canDecide && !rejecting && (
        <div className="bo-rec-actions">
          <button className="bo-primary-button" disabled={busy} onClick={() => decide('approved')}>
            Approve and re-test
          </button>
          <button
            className="bo-secondary-button"
            disabled={busy}
            onClick={() => setRejecting(true)}
          >
            Reject
          </button>
        </div>
      )}

      {recommendation.status === 'pending' && rejecting && (
        <div className="bo-rec-reject">
          <label className="bo-field">
            Why are you rejecting this? (optional)
            <input value={reason} onChange={(event) => setReason(event.target.value)} />
          </label>
          <div className="bo-rec-actions">
            <button
              className="bo-primary-button"
              disabled={busy}
              onClick={() => decide('rejected')}
            >
              Confirm reject
            </button>
            <button className="bo-secondary-button" onClick={() => setRejecting(false)}>
              Cancel
            </button>
          </div>
        </div>
      )}

      {decision && (
        <p className="bo-muted">
          {decision.decision === 'approved' ? 'Approved' : 'Rejected'} by {decision.admin} on{' '}
          {formatDateTime(decision.decidedAt)}
          {decision.reason && ` · ${decision.reason}`}
        </p>
      )}

      <RetestResult retest={recommendation.retest} />
    </article>
  )
}

function Recommendations({ user }) {
  const [recommendations, setRecommendations] = useState(null)
  const [error, setError] = useState('')
  const timers = useRef([]) // Re-test polling timers, cleared when leaving the tab.

  useEffect(() => {
    const running = timers.current
    return () => running.forEach(clearInterval)
  }, [])

  useEffect(() => {
    let ignore = false
    listRecommendations({ user })
      .then((data) => !ignore && setRecommendations(data.recommendations))
      .catch((err) => !ignore && setError(err.message))
    return () => {
      ignore = true
    }
  }, [user])

  function replace(updated) {
    setRecommendations((current) =>
      current.map((item) => (item.id === updated.id ? updated : item)),
    )
  }

  async function handleDecide(id, form) {
    const updated = await decideRecommendation(id, form, { user })
    replace(updated)

    // Poll until the re-test has finished.
    if (updated.retest?.status === 'running') {
      const timer = setInterval(async () => {
        const latest = await getRecommendation(id, { user })
        if (latest.retest?.status !== 'running') {
          clearInterval(timer)
          replace(latest)
        }
      }, 1000)
      timers.current.push(timer)
    }
  }

  if (error) return <p className="bo-error">{error}</p>
  if (!recommendations) return <p className="bo-muted">Loading recommendations...</p>

  const pending = recommendations.filter((item) => item.status === 'pending')
  const done = recommendations.filter((item) => item.status !== 'pending')

  return (
    <div className="bo-recs">
      <p className="bo-muted">
        Suggested from recurring failures. Nothing changes until an admin approves it.
      </p>

      <h2 className="bo-section-title">Waiting for approval ({pending.length})</h2>
      {pending.length === 0 && <p className="bo-empty">No recommendations waiting.</p>}
      <div className="bo-rec-grid">
        {pending.map((item) => (
          <RecommendationCard
            key={item.id}
            recommendation={item}
            canDecide={user.role === 'admin'}
            onDecide={handleDecide}
          />
        ))}
      </div>

      {done.length > 0 && (
        <>
          <h2 className="bo-section-title">Decided</h2>
          <div className="bo-rec-grid">
            {done.map((item) => (
              <RecommendationCard key={item.id} recommendation={item} canDecide={false} />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

export default Recommendations
