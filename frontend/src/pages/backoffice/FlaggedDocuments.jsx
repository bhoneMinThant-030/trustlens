import { useEffect, useState } from 'react'
import { listFlaggedDocuments } from '../../api/backoffice'
import { categoryLabel, formatDateTime } from '../../constants/labels'
import { ChevronIcon, RefreshIcon } from './Icons'

/*
  Flagged documents tab (admin).
  When a reviewer corrects an answer, every unofficial or outdated
  document in that answer's sources shows up here. The list and the
  detail are real data (GET /api/flagged-documents).
  The "Correct the document" panel is a prototype: nothing is saved.
*/

const REASON_LABELS = {
  unofficial: 'Unofficial',
  outdated: 'Outdated',
}

// What each prototype button would do in a full version.
const PROTOTYPE_ACTIONS = {
  save: 'Would save this text as a new version of the document and re-index it, so the next customer gets the right answer without review. The old version stays as outdated.',
  retire:
    'Would take this document out of use, so the AI can no longer find or quote it. Retired, not deleted: its history stays.',
  dismiss:
    'Would mark this document as fine and remove it from the list. The reason is logged, and it comes back if it is flagged again.',
}

const docKey = (doc) => `${doc.docId}@${doc.version}`

function reasonText(doc) {
  if (doc.reason === 'unofficial') {
    return 'Unofficial document. It was found in an answer a reviewer had to correct.'
  }
  return `Outdated version${doc.newerVersion ? `, replaced by v${doc.newerVersion}` : ''}. It was found in an answer a reviewer had to correct.`
}

function ReasonTag({ reason }) {
  const className = reason === 'unofficial' ? 'bo-authority-unofficial' : 'bo-label-outdated'
  return <span className={`bo-label ${className}`}>{REASON_LABELS[reason] ?? reason}</span>
}

// One correction that found this document: what the AI said vs the reviewer.
function EvidenceItem({ item }) {
  return (
    <div className="bo-evidence-item">
      <p className="bo-mono">
        {item.reviewId} · {item.reviewer} · {formatDateTime(item.decidedAt)}
      </p>
      <p className="bo-evidence-question">{item.question}</p>

      <div className="bo-compare-grid">
        <div>
          <p className="bo-field-label">AI said</p>
          <p className="bo-answer-box bo-answer-ai">{item.aiAnswer}</p>
        </div>
        <div>
          <p className="bo-field-label">Reviewer corrected to</p>
          <p className="bo-answer-box bo-answer-fixed">{item.correctedAnswer}</p>
        </div>
      </div>

      {item.officialSources.length > 0 && (
        <details className="bo-source-details">
          <summary>
            <ChevronIcon size={16} />
            <span>Official source says ({item.officialSources.length})</span>
          </summary>
          {item.officialSources.map((source) => (
            <div key={source.id} className="bo-source">
              <div className="bo-source-meta">
                <span className="bo-label bo-authority-official">Official</span>
                <span>{source.title}</span>
                <span>Version {source.version}</span>
              </div>
              <blockquote>{source.excerpt}</blockquote>
            </div>
          ))}
        </details>
      )}
    </div>
  )
}

// Prototype only: shows the idea, saves nothing.
function CorrectionPrototype({ doc }) {
  const [text, setText] = useState(doc.excerpt)
  const [action, setAction] = useState(null)

  return (
    <section className="bo-card bo-prototype">
      <div className="bo-prototype-head">
        <h3>Correct the document</h3>
        <span className="bo-tag bo-tag-prototype">Prototype</span>
      </div>
      <p className="bo-muted">
        Future improvement. Changes here are not applied to the knowledge base.
      </p>

      <label className="bo-field">
        Document text
        <textarea rows={4} value={text} onChange={(event) => setText(event.target.value)} />
      </label>

      <div className="bo-prototype-actions">
        <button className="bo-secondary-button" onClick={() => setAction('save')}>
          Save correction
        </button>
        <button className="bo-secondary-button" onClick={() => setAction('retire')}>
          Retire document
        </button>
        <button className="bo-secondary-button" onClick={() => setAction('dismiss')}>
          Dismiss flag
        </button>
      </div>

      {action && (
        <p className="bo-prototype-note" role="status">
          <strong>Prototype only, nothing was changed.</strong> {PROTOTYPE_ACTIONS[action]}
        </p>
      )}
    </section>
  )
}

function FlaggedDetail({ doc }) {
  return (
    <div className="bo-detail">
      <div className="bo-card bo-question">
        <p className="bo-mono">
          {doc.docId} · v{doc.version} · last flagged {formatDateTime(doc.lastFlaggedAt)}
        </p>
        <h2>{doc.title}</h2>
        <div className="bo-pill-row">
          <span className="bo-tag">{categoryLabel(doc.category)}</span>
          <ReasonTag reason={doc.reason} />
          <span className="bo-tag">
            {doc.corrections} {doc.corrections === 1 ? 'correction' : 'corrections'}
          </span>
        </div>

        <p className={`bo-flag bo-flag-${doc.reason}`}>{reasonText(doc)}</p>

        <p className="bo-field-label">This document says</p>
        <div className="bo-source">
          <blockquote>{doc.excerpt}</blockquote>
        </div>
      </div>

      <section className="bo-card">
        <h3>Corrections that found it ({doc.evidence.length})</h3>
        <div className="bo-evidence-list">
          {doc.evidence.map((item) => (
            <EvidenceItem key={item.reviewId} item={item} />
          ))}
        </div>
      </section>

      {/* `key` resets the prototype when another document is selected. */}
      <CorrectionPrototype key={docKey(doc)} doc={doc} />
    </div>
  )
}

function FlaggedDocuments({ user }) {
  const [docs, setDocs] = useState([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [selectedKey, setSelectedKey] = useState(null)
  const [reloadKey, setReloadKey] = useState(0)

  useEffect(() => {
    let ignore = false // Skip results from an older request.
    listFlaggedDocuments({ user })
      .then((data) => {
        if (!ignore) {
          setDocs(data.flaggedDocuments)
          setError('')
        }
      })
      .catch((err) => !ignore && setError(err.message))
      .finally(() => !ignore && setLoading(false))
    return () => {
      ignore = true
    }
  }, [user, reloadKey])

  function reload() {
    setLoading(true)
    setReloadKey((key) => key + 1)
  }

  // If nothing is selected yet, show the first document.
  const selected = docs.find((doc) => docKey(doc) === selectedKey) ?? docs[0] ?? null

  return (
    <div className="bo-queue-page">
      <div className="bo-queue">
        <aside className="bo-card bo-queue-list">
          <div className="bo-list-head">
            <p className="bo-flagged-count">
              {docs.length} {docs.length === 1 ? 'document' : 'documents'}
            </p>
            <button
              className="bo-icon-button"
              onClick={reload}
              disabled={loading}
              aria-label="Refresh"
              title="Refresh"
            >
              <RefreshIcon size={18} />
            </button>
          </div>

          {loading && <p className="bo-muted bo-list-note">Loading flagged documents...</p>}
          {!loading && !error && docs.length > 0 && (
            <p className="bo-muted bo-list-note">Most corrections first</p>
          )}
          {error && <p className="bo-error">{error}</p>}
          {!loading && !error && docs.length === 0 && (
            <p className="bo-empty">
              No flagged documents. They appear here after a reviewer corrects an answer that used
              an unofficial or outdated document.
            </p>
          )}

          <div className="bo-rows">
            {docs.map((doc) => (
              <button
                key={docKey(doc)}
                className={`bo-row ${selected && docKey(selected) === docKey(doc) ? 'selected' : ''}`}
                onClick={() => setSelectedKey(docKey(doc))}
              >
                <span className="bo-row-title">{doc.title}</span>
                <span className="bo-row-meta">
                  v{doc.version} · {categoryLabel(doc.category)}
                </span>
                <span className="bo-row-foot">
                  <ReasonTag reason={doc.reason} />
                  <span className="bo-row-confidence">
                    <strong>{doc.corrections}</strong>{' '}
                    {doc.corrections === 1 ? 'correction' : 'corrections'}
                  </span>
                </span>
              </button>
            ))}
          </div>
        </aside>

        {/* The first document is selected by default, so there is always one to show. */}
        <section className="bo-queue-detail">{selected && <FlaggedDetail doc={selected} />}</section>
      </div>
    </div>
  )
}

export default FlaggedDocuments
