// useEffect runs code when the page first loads.
import { useEffect, useRef, useState } from 'react'
//update automatically without refreshing the browser
import { io } from 'socket.io-client'

// API functions used by the Officer Workspace.
import {
  getOfficerEmails,
  getEmailAnswer,
  generateAnswer,
  requestHumanReview
} from '../../api/officer'
import AskTrustLens from './AskTrustLens'
import { REVIEW_REASONS, inboxStatus } from './reviewText'
import {
  CLAIM_LABELS,
  CONFIDENCE_THRESHOLD,
  categoryLabel,
  formatDateTime,
} from '../../constants/labels'
import './OfficerWorkspace.css'

function OfficerWorkspace() {
  // Which tab is open: 'inbox' (customer emails) or 'chat' (Ask TrustLens).
const [view, setView] = useState('inbox')

  // Store emails received from the backend.
const [emails, setEmails] = useState([])

// No email is selected until the backend finishes loading.
const [selectedEmail, setSelectedEmail] = useState(null)

// Show whether the inbox is loading.
const [loadingEmails, setLoadingEmails] = useState(true)

// Store any error while loading emails.
const [emailError, setEmailError] = useState('')

// Store the AI answer returned by the backend.
const [apiAnswer, setApiAnswer] = useState(null)

// Show a loading message while retrieving an existing answer.
const [loadingAnswer, setLoadingAnswer] = useState(false)

// Store errors when retrieving an AI answer.
const [answerError, setAnswerError] = useState('')

// True while the backend is generating and verifying an AI answer.
const [generatingAnswer, setGeneratingAnswer] = useState(false)

// Stores errors that happen during AI generation.
const [generationError, setGenerationError] = useState('')

// True while sending a human review request.
const [sendingReview, setSendingReview] = useState(false)

// Stores any error from the review API.
const [reviewError, setReviewError] = useState('')

// Stores review requests successfully submitted in this session.
const [, setSubmittedReviewIds] = useState([])

// Remember the currently selected email, even during an API request.
const selectedEmailIdRef = useRef(null)

// Load the officer's emails when the page opens.
useEffect(() => {
    async function loadEmails() {
        try {
            // Call our officer.js API function.
            const data = await getOfficerEmails()

            // Save the emails returned by the backend.
            setEmails(data.emails)

            // Automatically select the first email.
            if (data.emails.length > 0) {
                selectedEmailIdRef.current = data.emails[0].emailId
                setSelectedEmail(data.emails[0])
            }
        } catch (error) {
            // Show an error if the backend cannot be reached.
            setEmailError(error.message)
        } finally {
            // Stop displaying the loading message.
            setLoadingEmails(false)
        }
    }

    loadEmails()
}, [])


    // Listen for completed human reviews from the backend.
    useEffect(() => {

        // Connect to the backend as the officer.
        const socket = io(
            import.meta.env.VITE_API_URL || 'http://localhost:3000',
            {
                query: {
                    role: 'officer',
                    userId: 'officer-1'
                }
            }
        )

        // When a reviewer completes a review, refresh the inbox.
        async function handleReviewResolved(event) {
            console.log('Human review completed:', event)

            try {
                const inbox = await getOfficerEmails()

                // Update the status badges in the inbox.
                setEmails(inbox.emails)

                // Refresh the answer currently being viewed.
                const currentEmailId = selectedEmailIdRef.current

                if (currentEmailId) {
                    const currentEmail = inbox.emails.find(
                        (email) => email.emailId === currentEmailId
                    )

                    if (currentEmail) {
                        setSelectedEmail(currentEmail)
                    }

                    // Retrieve the latest saved answer, including corrections.
                    if (currentEmail?.answerId) {
                        const updatedAnswer = await getEmailAnswer(currentEmailId)

                        // Avoid displaying another customer's answer.
                        if (selectedEmailIdRef.current === currentEmailId) {
                            setApiAnswer(updatedAnswer)
                        }
                    }
                }

            } catch (error) {
                console.error('Unable to refresh completed review:', error)
            }
        }

        socket.on('connect', () => console.log('Officer Socket.IO connected:', socket.id))
        socket.on('connect_error', (error) => console.error('Socket.IO connection failed:', error.message))
        // Subscribe to the event sent by the backend.
        socket.on('review:resolved', handleReviewResolved)

        // Disconnect when the Officer Workspace closes.
        return () => {
            socket.off('review:resolved', handleReviewResolved)
            socket.disconnect()
        }

    }, [])



        // Send an existing AI answer to the human review queue.
        async function handleRequestReview() {

            // Only request review if an AI answer exists.
            if (!selectedResult?.answerId || sendingReview || isReviewPending) {
                return
            }

            // Remember which answer and email the request belongs to.
            const answerId = selectedResult.answerId
            const emailId = selectedEmail.emailId

            setSendingReview(true)
            setReviewError('')

            try {
                // Send the request to the backend review queue.
                await requestHumanReview(answerId)
                // Refresh the inbox after requesting human review.
                const updatedInbox = await getOfficerEmails()
                setEmails(updatedInbox.emails)

                // Remember that this answer has been submitted.
                setSubmittedReviewIds((previous) =>
                    previous.includes(answerId)
                        ? previous
                        : [...previous, answerId]
                )

                // Refresh the answer to get the latest review status.
                // Only update the screen if the same email is still selected.
                if (selectedEmailIdRef.current === emailId) {
                    const updatedAnswer = await getEmailAnswer(emailId)

                    if (selectedEmailIdRef.current === emailId) {
                        setApiAnswer(updatedAnswer)
                    }
                }

            } catch (error) {
                if (selectedEmailIdRef.current === emailId) {
                    setReviewError(error.message)
                }
            } finally {
                setSendingReview(false)
            }
        }

        // Generate an AI answer when the officer clicks the button.
        async function handleGenerateAnswer() {
        // Stop if no email is selected or a request is already running.
        if (!selectedEmail || generatingAnswer || loadingAnswer) {
            return
        }

        // Remember which email we are generating an answer for.
        const emailId = selectedEmail.emailId
        const question = selectedEmail.question

        // If this email already has an answer, display it.
        if (apiAnswer?.emailId === emailId) {
            setShowResult(true)
            return
        }

        // Start loading and clear previous errors.
        setGeneratingAnswer(true)
        setGenerationError('')
        setShowResult(false)

        try {
            // Request an AI answer from the backend.
            const result = await generateAnswer(emailId, question)

            // Refresh the inbox so its answerId and status match the backend.
            // A refresh failure should not hide a successfully generated answer.
            try {
                const inbox = await getOfficerEmails()

                setEmails(inbox.emails)

                // Update the selected email only if it is still being viewed.
                if (selectedEmailIdRef.current === emailId) {
                    const updatedEmail = inbox.emails.find(
                        (email) => email.emailId === emailId
                    )

                    if (updatedEmail) {
                        setSelectedEmail(updatedEmail)
                    }
                }
            } catch (refreshError) {
                console.error('Unable to refresh inbox:', refreshError)
            }

            // Only show the result if the officer is still viewing this email.
            if (
                result.emailId === emailId &&
                selectedEmailIdRef.current === emailId
            ) {
                setApiAnswer(result)
                setShowResult(true)
            }

        } catch (error) {
            if (selectedEmailIdRef.current === emailId) {
                setGenerationError(
                    error.code === 'LAMBDA_FAILED'
                        ? 'The AI verification service is temporarily unavailable. Please try again.'
                        : error.message
                )
            }
        } finally {
            setGeneratingAnswer(false)
        }
    }

    // Load an existing AI answer whenever the selected email changes.
    useEffect(() => {


        // Do nothing if no email has been selected yet.
        if (!selectedEmail) {
            return
        }

        // Prevent an older request from updating the wrong email.
        let cancelled = false

        async function loadExistingAnswer() {

            // Clear the previous email's answer and errors.
            setApiAnswer(null)
            setAnswerError('')
            setGenerationError('')

            // Unanswered emails have no saved answer to fetch.
            if (selectedEmail.answerId == null) {
                setLoadingAnswer(false)
                return
            }

            setLoadingAnswer(true)

            try {
                // Ask the backend whether this email already has an AI answer.
                const data = await getEmailAnswer(selectedEmail.emailId)

                // Save the answer only if this email is still selected.
                if (!cancelled) {
                    // Display the backend response in the browser console.
                    console.log('Existing AI answer:', data)

                    // Store the answer in React.
                    setApiAnswer(data)
                }

            } catch (error) {

                if (!cancelled) {

                    // A 404 means this email has no AI answer yet.
                    // This is normal for unanswered customer emails.
                    if (error.status === 404) {
                        setApiAnswer(null)
                    } else {
                        // Show unexpected errors, such as backend connection problems.
                        setAnswerError(error.message)
                    }
                }

            } finally {

                if (!cancelled) {
                    setLoadingAnswer(false)
                }
            }
        }

        loadExistingAnswer()

        // Ignore outdated responses if the officer selects another email.
        return () => {
            cancelled = true
        }

    }, [selectedEmail])


  const [showResult, setShowResult] = useState(false)

  // Only show an AI answer if it belongs to the selected email.
  const selectedResult = apiAnswer?.emailId === selectedEmail?.emailId ? apiAnswer : null

  const confidence = typeof selectedResult?.confidence === 'number' ? selectedResult.confidence : null
  const backendReview = selectedResult?.review

  const isReviewCompleted =
    selectedResult?.status === 'reviewed_approved' ||
    selectedResult?.status === 'reviewed_corrected' ||
    backendReview?.status === 'approved' ||
    backendReview?.status === 'corrected'

  const isReviewPending =
    !isReviewCompleted &&
    (backendReview?.status === 'pending' || selectedResult?.status === 'pending_review')

  const hasContradiction = selectedResult?.claims?.some((claim) => claim.label === 'contradicted') ?? false

  // Same rule as the backend: review when flagged, contradicted or below the threshold.
  const needsReview = selectedResult
    ? isReviewPending || hasContradiction || (confidence ?? 0) < CONFIDENCE_THRESHOLD
    : false

  const wasCorrected = selectedResult?.status === 'reviewed_corrected'
  const citedIds = new Set(selectedResult?.claims?.map((claim) => claim.sourceId).filter(Boolean))
  const otherSources = selectedResult?.sources?.filter((source) => !citedIds.has(source.id)) ?? []

  // One banner that tells the officer whether the answer can be sent.
  let banner = null
  if (selectedResult) {
    if (isReviewCompleted) {
      banner = {
        tone: 'good',
        title: wasCorrected ? 'Reviewed: corrected' : 'Reviewed: approved',
        text: 'A reviewer checked this answer. You can send it.',
      }
    } else if (isReviewPending) {
      banner = {
        tone: 'wait',
        title: 'Sent to review',
        text: `${REVIEW_REASONS[backendReview?.trigger] ?? 'Flagged for a human check'}. Don't send it yet.`,
      }
    } else if (needsReview) {
      banner = { tone: 'wait', title: 'Needs a human check', text: "Don't send it until a reviewer approves it." }
    } else {
      banner = {
        tone: 'good',
        title: 'Verified',
        text: 'Every claim is backed by a current official source. Read it before sending.',
      }
    }
  }

  function selectEmail(email) {
    // Remember the selection straight away, so late responses for other emails are ignored.
    selectedEmailIdRef.current = email.emailId
    setSelectedEmail(email)
    setShowResult(false)
  }

  function sourceTags(source) {
    return (
      <>
        <span className={`bo-label bo-authority-${source.authority}`}>
          {source.authority === 'official' ? 'Official' : 'Unofficial'}
        </span>
        {source.outdated && (
          <span className="bo-label bo-label-outdated">
            Outdated{source.newerVersion ? `, replaced by v${source.newerVersion}` : ''}
          </span>
        )}
      </>
    )
  }

  return (
    <div className="officer-workspace">
      <header className="ow-topbar">
        <p className="bo-wordmark">
          <strong>OCBC</strong>
          <span className="bo-wordmark-rule" />
          TrustLens
          <span className="bo-wordmark-sub">Officer workspace</span>
        </p>
        <nav className="ow-tabs" role="tablist" aria-label="Officer workspace">
          <button
            role="tab"
            aria-selected={view === 'inbox'}
            className={view === 'inbox' ? 'active' : ''}
            onClick={() => setView('inbox')}
          >
            Customer inbox
          </button>
          <button
            role="tab"
            aria-selected={view === 'chat'}
            className={view === 'chat' ? 'active' : ''}
            onClick={() => setView('chat')}
          >
            Ask TrustLens
          </button>
        </nav>
      </header>

      {/* Both views stay mounted, so switching tabs keeps the chat thread and the selected email. */}
      <div className="ow-main" hidden={view !== 'chat'}>
        <AskTrustLens />
      </div>

      <div
        hidden={view !== 'inbox'}
        className={`ow-main officer-layout ${showResult && selectedResult ? 'with-result' : 'without-result'}`}
      >
        <section className="ow-card ow-inbox">
          <div className="ow-card-head">
            <h2>Customer inbox</h2>
            <span className="ow-count">{emails.length}</span>
          </div>

          {loadingEmails && <p className="ow-muted">Loading customer emails...</p>}
          {emailError && (
            <p role="alert" className="ow-error">
              {emailError}
            </p>
          )}
          {!loadingEmails && !emailError && emails.length === 0 && (
            <p className="ow-muted">No customer emails found.</p>
          )}

          <div className="ow-email-list">
            {emails.map((email) => {
              const chip = inboxStatus(email)
              return (
                <button
                  key={email.emailId}
                  className={`ow-email ${selectedEmail?.emailId === email.emailId ? 'selected' : ''}`}
                  onClick={() => selectEmail(email)}
                >
                  <span className="ow-email-name">{email.customerName}</span>
                  <span className="ow-email-question">{email.question}</span>
                  <span className="ow-email-foot">
                    <span className={`ow-chip ow-chip-${chip.tone}`}>{chip.label}</span>
                    <span className="ow-muted">{formatDateTime(email.createdAt)}</span>
                  </span>
                </button>
              )
            })}
          </div>
        </section>

        <section className="ow-card ow-details">
          <h2>Email details</h2>

          {selectedEmail ? (
            <>
              <dl className="ow-facts">
                <div>
                  <dt>From</dt>
                  <dd>
                    {selectedEmail.customerName}
                    <span className="ow-muted"> · {selectedEmail.customerEmail}</span>
                  </dd>
                </div>
                <div>
                  <dt>Card</dt>
                  <dd>{selectedEmail.cardType}</dd>
                </div>
                <div>
                  <dt>Received</dt>
                  <dd>{formatDateTime(selectedEmail.createdAt)}</dd>
                </div>
              </dl>
              <span className="bo-tag">{categoryLabel(selectedEmail.category)}</span>

              <div className="ow-message">
                <p className="ow-label">Customer message</p>
                <p>{selectedEmail.question}</p>
              </div>

              <button
                className="ow-primary"
                disabled={loadingAnswer || generatingAnswer}
                onClick={() => (selectedResult ? setShowResult(true) : handleGenerateAnswer())}
              >
                {generatingAnswer
                  ? 'Checking… (5 to 15 seconds)'
                  : loadingAnswer
                    ? 'Loading answer…'
                    : selectedResult
                      ? 'View TrustLens result'
                      : 'Check with TrustLens'}
              </button>
              {selectedEmail.answerId == null && !selectedResult && !generatingAnswer && (
                <p className="ow-muted">Not checked yet.</p>
              )}
            </>
          ) : (
            <p className="ow-muted">Select an email to see its details.</p>
          )}

          {generationError && (
            <p role="alert" className="ow-error">
              {generationError}
            </p>
          )}
          {answerError && (
            <p role="alert" className="ow-error">
              Unable to load the answer: {answerError}
            </p>
          )}
        </section>

        {showResult && selectedResult && (
          <section className="ow-card ow-result">
            <h2>TrustLens verification</h2>

            <div className={`ow-banner ow-banner-${banner.tone}`}>
              <strong>{banner.title}</strong>
              <span>{banner.text}</span>
            </div>

            {confidence !== null && (
              <div className="ow-confidence">
                <p className="bo-confidence">
                  <span>{isReviewCompleted ? 'Original AI confidence' : 'AI confidence'}</span>
                  <strong className={confidence < CONFIDENCE_THRESHOLD ? 'bo-low' : ''}>
                    {Math.round(confidence * 100)}%
                  </strong>
                </p>
                {/* Bar with a tick where the review threshold sits */}
                <div className="bo-meter" aria-hidden="true">
                  <span style={{ width: `${confidence * 100}%` }} />
                  <i style={{ left: `${CONFIDENCE_THRESHOLD * 100}%` }} />
                </div>
              </div>
            )}

            <div>
              <p className="ow-label">
                {isReviewCompleted
                  ? "Reviewer's answer"
                  : needsReview
                    ? "Suggested answer (don't send yet)"
                    : 'Suggested answer'}
              </p>
              <p className={`ow-answer ${isReviewCompleted ? 'ow-answer-reviewed' : ''}`}>
                {selectedResult.answer}
              </p>
              {wasCorrected && selectedResult.aiAnswer && selectedResult.aiAnswer !== selectedResult.answer && (
                <details className="ow-original">
                  <summary>Original AI answer</summary>
                  <p>{selectedResult.aiAnswer}</p>
                </details>
              )}
              {backendReview?.decision?.reason && (
                <p className="ow-muted">Reviewer: {backendReview.decision.reason}</p>
              )}
            </div>

            <div>
              <p className="ow-label">
                {isReviewCompleted ? 'Claims in the original AI answer' : 'Claims'} (
                {selectedResult.claims?.length ?? 0})
              </p>
              {(selectedResult.claims ?? []).length === 0 && (
                <p className="ow-muted">No claims could be checked.</p>
              )}
              {selectedResult.claims?.map((claim, index) => {
                const source = selectedResult.sources?.find((item) => item.id === claim.sourceId)
                return (
                  <div className="ow-claim" key={claim.id ?? index}>
                    <span className={`bo-label bo-label-${claim.label}`}>
                      {CLAIM_LABELS[claim.label] ?? claim.label}
                    </span>
                    <p>{claim.text}</p>
                    {claim.quote && <blockquote>{claim.quote}</blockquote>}
                    {source && (
                      <p className="ow-source-line">
                        <span>
                          {source.title} · v{source.version}
                        </span>
                        {sourceTags(source)}
                        {source.url && (
                          <a href={source.url} target="_blank" rel="noopener noreferrer">
                            Open
                          </a>
                        )}
                      </p>
                    )}
                    {claim.reason && <p className="ow-muted">{claim.reason}</p>}
                  </div>
                )
              })}
            </div>

            {otherSources.length > 0 && (
              <div>
                <p className="ow-label">Other sources found ({otherSources.length})</p>
                <ul className="ow-sources">
                  {otherSources.map((source) => (
                    <li key={source.id}>
                      <span>
                        {source.title} · v{source.version}
                      </span>
                      {sourceTags(source)}
                    </li>
                  ))}
                </ul>
              </div>
            )}

            <div className="ow-result-foot">
              {isReviewPending ? (
                <span className="ow-chip ow-chip-wait">Waiting for a reviewer</span>
              ) : (
                !isReviewCompleted && (
                  <button className="ow-secondary" onClick={handleRequestReview} disabled={sendingReview}>
                    {sendingReview ? 'Sending for review…' : 'Request human review'}
                  </button>
                )
              )}
              {reviewError && (
                <p role="alert" className="ow-error">
                  {reviewError}
                </p>
              )}
            </div>
          </section>
        )}
      </div>
    </div>
  )
}

export default OfficerWorkspace
