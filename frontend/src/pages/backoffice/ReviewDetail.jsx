import { useState } from 'react'
import {
  CLAIM_LABELS,
  CONFIDENCE_THRESHOLD,
  STATUS_LABELS,
  TRIGGER_LABELS,
  categoryLabel,
  formatDateTime,
  formatPercent,
} from '../../constants/labels'
import { ChevronIcon } from './Icons'

// Explains in plain words why this answer was sent for review.
function triggerExplanation(review) {
  const contradicted = review.claims.filter((claim) => claim.label === 'contradicted').length
  switch (review.trigger) {
    case 'auto_threshold':
      return `Confidence ${formatPercent(review.confidence)} is below the ${formatPercent(CONFIDENCE_THRESHOLD)} threshold.`
    case 'auto_contradiction':
      return `${contradicted} claim${contradicted === 1 ? '' : 's'} contradict${contradicted === 1 ? 's' : ''} an approved source.`
    case 'auto_safety':
      return 'The AI changed fixed safety wording. Safety wording must appear exactly as approved.'
    case 'manual':
      return 'The officer sent this answer for review.'
    default:
      return ''
  }
}

// One claim with its label and the source passage behind it.
function ClaimCard({ claim, source }) {
  return (
    <div className={`bo-claim bo-claim-${claim.label}`}>
      <div className="bo-claim-body">
        <p className="bo-claim-text">{claim.text}</p>
        <p className="bo-claim-reason">{claim.reason}</p>
        <div className="bo-pill-row">
          <span className={`bo-label bo-label-${claim.label}`}>{CLAIM_LABELS[claim.label]}</span>
          {claim.outdated && (
            <span className="bo-label bo-label-outdated">Newer version exists</span>
          )}
        </div>

        {source ? (
          <details className="bo-source-details">
            <summary>
              <ChevronIcon size={16} />
              <span>
                Source: {source.title} (v{source.version})
              </span>
            </summary>
            <SourcePassage source={source} />
          </details>
        ) : (
          <p className="bo-muted bo-no-source">No matching approved source found.</p>
        )}
      </div>
    </div>
  )
}

function SourcePassage({ source }) {
  return (
    <div className="bo-source">
      <div className="bo-source-meta">
        <span className={`bo-label bo-authority-${source.authority}`}>
          {source.authority === 'official' ? 'Official' : 'Unofficial'}
        </span>
        <span>Version {source.version}</span>
        <span>Effective {source.effectiveDate}</span>
      </div>
      <blockquote>{source.excerpt}</blockquote>
      {source.url && (
        <a href={source.url} target="_blank" rel="noreferrer">
          Open original document
        </a>
      )}
    </div>
  )
}

function DecisionLog({ review }) {
  const { decision } = review
  return (
    <div className={`bo-card bo-decision-log bo-decision-${decision.decision}`}>
      <div className="bo-decision-head">
        <h3>Decision</h3>
        <span className={`bo-tag bo-status-${decision.decision}`}>
          {STATUS_LABELS[decision.decision]}
        </span>
      </div>
      <p className="bo-muted">
        By {decision.reviewer} on {formatDateTime(decision.decidedAt)}
      </p>
      <p>
        <strong>Reason:</strong> {decision.reason}
      </p>
      {decision.correctedAnswer && (
        <>
          <strong>Answer sent back to the officer:</strong>
          <p className="bo-answer-box">{decision.correctedAnswer}</p>
        </>
      )}
    </div>
  )
}

// Approve the answer as it is, or correct it. Both need a reason,
// because every decision is logged with reviewer, time and reason.
function DecisionForm({ review, onDecide }) {
  const [decision, setDecision] = useState('corrected')
  const [correctedAnswer, setCorrectedAnswer] = useState(review.answer)
  const [reason, setReason] = useState('')
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState('')

  const hasContradiction = review.claims.some((claim) => claim.label === 'contradicted')

  async function handleSubmit(event) {
    event.preventDefault()
    if (!reason.trim()) {
      setError('Add a reason. It is saved in the audit log.')
      return
    }
    if (decision === 'corrected' && correctedAnswer.trim() === review.answer.trim()) {
      setError('The corrected answer is the same as the AI answer. Edit it, or choose Approve.')
      return
    }
    setSubmitting(true)
    setError('')
    try {
      await onDecide({
        decision,
        correctedAnswer: correctedAnswer.trim(),
        reason: reason.trim(),
      })
    } catch (err) {
      setError(err.message)
      setSubmitting(false)
    }
  }

  return (
    <form className="bo-card bo-decision-form" onSubmit={handleSubmit}>
      <h3>Your decision</h3>

      <div className="bo-pills bo-radio-row">
        <label className={decision === 'approved' ? 'selected' : ''}>
          <input
            type="radio"
            name="decision"
            value="approved"
            checked={decision === 'approved'}
            onChange={() => setDecision('approved')}
          />
          Approve as it is
        </label>
        <label className={decision === 'corrected' ? 'selected' : ''}>
          <input
            type="radio"
            name="decision"
            value="corrected"
            checked={decision === 'corrected'}
            onChange={() => setDecision('corrected')}
          />
          Correct the answer
        </label>
      </div>

      {decision === 'approved' && hasContradiction && (
        <p className="bo-warning">
          This answer has a contradicted claim. Approving sends it to the officer unchanged.
        </p>
      )}

      {decision === 'corrected' && (
        <label className="bo-field">
          Corrected answer
          <textarea
            rows={5}
            value={correctedAnswer}
            onChange={(event) => setCorrectedAnswer(event.target.value)}
          />
        </label>
      )}

      <label className="bo-field">
        Reason (saved in the audit log)
        <textarea
          rows={2}
          value={reason}
          placeholder="e.g. 24-month tenure came from the 2023 PayLite page"
          onChange={(event) => setReason(event.target.value)}
        />
      </label>

      {error && <p className="bo-error">{error}</p>}

      <button className="bo-primary-button" type="submit" disabled={submitting}>
        {submitting
          ? 'Saving...'
          : decision === 'approved'
            ? 'Approve and send to officer'
            : 'Send correction to officer'}
      </button>
    </form>
  )
}

function ReviewDetail({ review, canDecide, onDecide }) {
  // Look up each claim's source passage by its sourceId.
  const sourcesById = Object.fromEntries(review.sources.map((source) => [source.id, source]))
  const countClaims = (label) => review.claims.filter((claim) => claim.label === label).length
  const belowThreshold = (review.confidence ?? 0) < CONFIDENCE_THRESHOLD

  return (
    <div className="bo-detail">
      <div className="bo-card bo-question">
        <p className="bo-mono">
          {review.id} · email {review.emailId} · {review.officerId} ·{' '}
          {formatDateTime(review.createdAt)}
        </p>
        <h2>{review.question}</h2>
        <div className="bo-pill-row">
          <span className="bo-tag">{categoryLabel(review.category)}</span>
          <span className={`bo-tag bo-status-${review.status}`}>
            {STATUS_LABELS[review.status]}
          </span>
        </div>

        <p className={`bo-flag bo-flag-${review.trigger}`}>
          <strong>{TRIGGER_LABELS[review.trigger]}.</strong> {triggerExplanation(review)}
        </p>

        <div className="bo-answer-grid">
          <div>
            <p className="bo-field-label">AI answer</p>
            <p className="bo-answer-box">{review.answer}</p>
          </div>

          <div className="bo-check-summary">
            <p className="bo-confidence">
              <span>Confidence</span>
              <strong className={belowThreshold ? 'bo-low' : ''}>
                {formatPercent(review.confidence)}
              </strong>
            </p>
            {/* Bar with a tick where the review threshold sits */}
            <div className="bo-meter" aria-hidden="true">
              <span style={{ width: `${(review.confidence ?? 0) * 100}%` }} />
              <i style={{ left: `${CONFIDENCE_THRESHOLD * 100}%` }} />
            </div>
            <p className="bo-muted">Needs {formatPercent(CONFIDENCE_THRESHOLD)} to skip review</p>
            <dl>
              <div>
                <dt>Supported</dt>
                <dd>{countClaims('supported')}</dd>
              </div>
              <div>
                <dt>Contradicted</dt>
                <dd>{countClaims('contradicted')}</dd>
              </div>
              <div>
                <dt>No evidence</dt>
                <dd>{countClaims('insufficient_evidence')}</dd>
              </div>
            </dl>
          </div>
        </div>

        {review.note && (
          <p className="bo-note">
            <strong>Officer note:</strong> {review.note}
          </p>
        )}
      </div>

      <section className="bo-card">
        <h3>Claims checked ({review.claims.length})</h3>
        <div className="bo-claims">
          {review.claims.map((claim) => (
            <ClaimCard key={claim.id} claim={claim} source={sourcesById[claim.sourceId]} />
          ))}
        </div>
      </section>

      <section className="bo-card">
        <h3>Sources retrieved ({review.sources.length})</h3>
        <div className="bo-source-list">
          {review.sources.map((source) => (
            <details key={source.id} className="bo-source-details bo-source-row">
              <summary>
                <ChevronIcon size={16} />
                <span>
                  {source.title} (v{source.version})
                  {source.authority === 'unofficial' && ' · unofficial'}
                </span>
              </summary>
              <SourcePassage source={source} />
            </details>
          ))}
        </div>
      </section>

      {review.status === 'pending' ? (
        canDecide ? (
          // `key` resets the form when another review is selected.
          <DecisionForm key={review.id} review={review} onDecide={onDecide} />
        ) : (
          <p className="bo-card bo-muted bo-readonly">
            Only reviewers can approve or correct answers. Switch to the Reviewer role to decide.
          </p>
        )
      ) : (
        <DecisionLog review={review} />
      )}
    </div>
  )
}

export default ReviewDetail
