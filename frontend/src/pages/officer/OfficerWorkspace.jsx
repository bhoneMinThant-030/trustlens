// useEffect runs code when the page first loads.
import { useEffect, useRef, useState } from 'react'

// API functions used by the Officer Workspace.
import {
  getOfficerEmails,
  getEmailAnswer,
  generateAnswer,
  requestHumanReview
} from '../../api/officer'
import './OfficerWorkspace.css'

function OfficerWorkspace() {
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
const [submittedReviewIds, setSubmittedReviewIds] = useState([])

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
    // Use the real AI answer received from the backend.
    // Only display an AI answer if it belongs to the selected email.
    // This prevents showing another customer's answer.
    const selectedResult =
        apiAnswer?.emailId === selectedEmail?.emailId
            ? apiAnswer
            : null

    
  
    // Convert the backend confidence (0 to 1) into a percentage (0 to 100).
    // Example: 0.85 becomes 85.
    const confidencePercent = selectedResult
        ? Math.round(selectedResult.confidence * 100)
        : 0

    // Check whether any AI claim contradicts the evidence.
    // Backend labels use lowercase words such as "contradicted".
    const hasContradiction = selectedResult?.claims?.some(
        (claim) => claim.label === 'contradicted'
    ) ?? false

    // Check whether the backend has already requested human review.
    const hasPendingReview = selectedResult?.review?.status === 'pending'
    // Get the human review information from the backend.
    const backendReview = selectedResult?.review

    // An answer is pending review if the backend says so,
    // or if we successfully submitted it during this session.
    const isReviewPending =
        backendReview?.status === 'pending' ||
        selectedResult?.status === 'pending_review' ||
        (
            selectedResult?.answerId &&
            submittedReviewIds.includes(selectedResult.answerId)
        )

    // Check whether a human reviewer has completed the review.
    const isReviewCompleted =
        backendReview?.status === 'approved' ||
        backendReview?.status === 'rejected' ||
        backendReview?.status === 'resolved'

    // An answer needs review if:
    // 1. The backend has marked it for review,
    // 2. Its confidence is below 70%, or
    // 3. At least one claim is contradicted.
    const needsReview = selectedResult
        ? hasPendingReview ||
        confidencePercent < 70 ||
        hasContradiction ||
        selectedResult.status === 'pending_review'
        : false




  return (
    <div className="officer-workspace">
      <header className="officer-header">
        <h1>TrustLens</h1>
        <span>Officer Workspace</span>
      </header>

      
    {/* Change the layout based on whether AI results are visible. */}
    <div className={`officer-layout ${showResult && selectedResult ? 'with-result' : 'without-result'}`}>
        <section className="officer-inbox">
          <h2>Customer Inbox</h2>

        {loadingEmails && <p>Loading customer emails...</p>}

        {emailError && <p role="alert">{emailError}</p>}

        {!loadingEmails && !emailError && emails.length === 0 && (
            <p>No customer emails found.</p>
        )}

        {emails.map((email) => (
            <button
              key={email.emailId}
              className={`officer-email-item ${selectedEmail?.emailId === email.emailId ? 'selected' : ''}`}
                onClick={() => {
                    // Immediately remember which email the officer selected.
                    selectedEmailIdRef.current = email.emailId

                    // Change the currently selected email.
                    setSelectedEmail(email)

                    // Hide the old AI result until the officer checks again.
                    setShowResult(false)

                    
                }}
            >
            
                {/* Customer name */}
                <strong>{email.customerName}</strong>

                {/* Customer's card */}
                <span>{email.cardType}</span>

                {/* Show whether this email has been checked by TrustLens. */}
                <span
                    className={`inbox-status ${email.answerId == null
                            ? 'inbox-not-checked'
                            : email.status === 'pending_review'
                                ? 'inbox-under-review'
                                : email.status === 'approved'
                                    ? 'inbox-approved'
                                    : 'inbox-checked'
                        }`}
                >
                    {email.answerId == null
                        ? 'Not Checked'
                        : email.status === 'pending_review'
                            ? 'Under Review'
                            : email.status === 'approved'
                                ? 'Approved'
                                : 'Checked'}
                </span>

                {/* Date the customer email was received */}
                <small>
                    {new Date(email.createdAt).toLocaleString('en-SG')}
                </small>

            </button>
          ))}
        </section>

        <section className="officer-details">
          <h2>Email Details</h2>

            {selectedEmail ? (
                <>
                    <p><strong>From:</strong> {selectedEmail.customerName} ({selectedEmail.customerEmail})</p>
                    <p><strong>Card:</strong> {selectedEmail.cardType}</p>
                    <p><strong>Category:</strong> {selectedEmail.category}</p>
                    <p><strong>Date:</strong> {new Date(selectedEmail.createdAt).toLocaleString('en-SG')}</p>
                </>
            ) : (
                <p>Select an email to view its details.</p>
            )}

          <div className="officer-message">
            <h3>Customer Message</h3>
            <p>{selectedEmail?.question ?? 'No email selected.'}</p>
          </div>
            
            {selectedEmail &&
                selectedEmail.answerId == null &&
                !selectedResult &&
                !generatingAnswer && (
                    <p>Not checked yet.</p>
                )}
            
            {/* Check an existing answer or generate a new one. */}
            <button
                className="trustlens-check-button"

                // Prevent clicks when no email is selected,
                // while loading, or while generating an answer.
                disabled={
                    !selectedEmail ||
                    loadingAnswer ||
                    generatingAnswer
                }

                onClick={() => {
                    // If an answer already exists, display it.
                    if (selectedResult) {
                        setShowResult(true)
                    } else {
                        // Otherwise, generate a new answer through the backend.
                        handleGenerateAnswer()
                    }
                }}
            >
                {generatingAnswer
                    ? 'Generating AI Answer...'
                    : loadingAnswer
                        ? 'Loading AI Answer...'
                        : selectedResult
                            ? 'View TrustLens Result'
                            : 'Generate with TrustLens'}
            </button>

                  {/* Show an error if AI generation fails. */}
                  {generationError && (
                      <p role="alert" className="evidence-warning">
                          {generationError}
                      </p>
                  )}


                {/* Show an error if the backend request failed. */}
                {answerError && (
                    <p role="alert" className="evidence-warning">
                        Unable to load AI answer: {answerError}
                    </p>
                )}
                

            {/* End of the Email Details section. */}
            </section>

            

            
            {/* Show the AI Verification panel only after checking the email. */}
            {showResult && selectedResult && (

                // This section becomes the third column of our layout.
                <section className="officer-verification-panel">

                    {/* This box contains the AI verification results. */}
                    <div className="trustlens-result">


                    <h3>TrustLens AI Verification</h3>

                    
                    {/* Telling the officer whether human review is required. */}
                    <div className={`review-warning ${needsReview ? 'review-required' : 'review-passed'}`}>

                        {needsReview ? (
                            <>
                                <h4> Human Review Required</h4>
                                <p>
                                    This answer has low confidence or a contradicted claim.
                                    Do not send it to the customer until a reviewer approves it.
                                </p>
                            </>
                        ) : (
                            <>
                                <h4> Evidence Check Passed</h4>
                                <p>
                                    This answer meets the evidence-check rules.
                                    Review the suggested reply before using it.
                                </p>
                            </>
                        )}

                    </div>


                    
                    {/* Changes the confidence box colour based on the AI result and 
                    displays the confidence score for the selected email */}
                    <div
                        className={`confidence-section ${confidencePercent >= 70 && !needsReview
                                ? 'confidence-high'
                                : confidencePercent >= 50
                                    ? 'confidence-medium'
                                    : 'confidence-low'
                            }`}
                    >
                        {/* Show the confidence score. */}
                        <h4>Confidence Score</h4>

                        <p className="confidence-score">
                            {confidencePercent}%
                        </p>

                        {/* Show whether the answer needs review. */}
                        <p className="confidence-status">
                            {selectedResult.status === 'pending_review'
                                ? 'Under Review'
                                : selectedResult.status === 'approved'
                                    ? 'Checked'
                                    : selectedResult.status ?? 'Unknown'}
                        </p>
                    </div>


                    {/* This displays the sample AI answer. */}
                    <div className="ai-answer-section">
                        <h4>Suggested AI Answer</h4>

                        <p>{selectedResult.answer}</p>
                    </div>

                    
                    {/* Display the verification reasons returned by the backend. */}
                    <div className="verification-section">
                        <h4>Verification Result</h4>

                        {/* Show a message if the backend returned no claims. */}
                        {(!selectedResult.claims || selectedResult.claims.length === 0) && (
                            <p>No claim verification details available.</p>
                        )}

                        {/* Display the reason for each verified claim. */}
                        {selectedResult.claims?.map((claim, index) => (
                            <p key={claim.id ?? index}>

                                {/* Display the claim number and verification label. */}
                                <strong>
                                    Claim {index + 1} ({claim.label ?? 'unknown'}):
                                </strong>{' '}

                                {/* Explain why the claim was supported or contradicted. */}
                                {claim.reason || 'No explanation provided.'}

                            </p>
                        ))}
                    </div>

                    
                    
                        {/* Display the AI claims and their supporting evidence. */}
                        <div className="claims-section">
                            <h4>Claim-by-Claim Verification</h4>

                            {/* Loop through the claims returned by the backend. */}
                            {selectedResult.claims?.map((claim, index) => {

                                // Find the source document matching this claim's sourceId.
                                const source = selectedResult.sources?.find(
                                    (item) => item.id === claim.sourceId
                                )

                                // The backend uses lowercase verification labels.
                                const claimLabel = claim.label ?? claim.status ?? 'insufficient'

                                return (
                                    <div className="claim-card" key={claim.id ?? index}>

                                        {/* Claim number and verification status. */}
                                        <div className="claim-header">
                                            <strong>Claim {index + 1}</strong>

                                            <span
                                                className={`claim-status ${claimLabel === 'supported'
                                                        ? 'claim-supported'
                                                        : claimLabel === 'contradicted'
                                                            ? 'claim-contradicted'
                                                            : 'claim-insufficient'
                                                    }`}
                                            >
                                                {claimLabel}
                                            </span>
                                        </div>

                                        {/* The statement generated by AI. */}
                                        <p>{claim.text}</p>

                                        {/* Evidence source information. */}
                                        <div className="claim-source">
                                            <strong>Evidence Source:</strong>

                                            {source ? (
                                                <>
                                                    {/* Display the policy document title. */}
                                                    <p>{source.title}</p>

                                                    {/* Show whether the source is official. */}
                                                    <p>
                                                        <strong>Authority:</strong>{' '}
                                                        {source.authority === 'official'
                                                            ? 'Official Source'
                                                            : 'Unofficial Source'}
                                                    </p>

                                                    {/* Display the source document version. */}
                                                    <p>
                                                        <strong>Version:</strong> {source.version}
                                                    </p>

                                                    {/* Link to the actual policy document. */}
                                                    {source.url ? (
                                                        <p>
                                                            <a
                                                                href={source.url}
                                                                target="_blank"
                                                                rel="noopener noreferrer"
                                                            >
                                                                Open Policy Document ↗
                                                            </a>
                                                        </p>
                                                    ) : (
                                                        <p>No document link available.</p>
                                                    )}
                                                </>
                                            ) : (
                                                <p>No matching evidence source found.</p>
                                            )}

                                            {/* Warn the officer if the source is outdated. */}
                                            {claim.outdated && (
                                                <p className="evidence-warning">
                                                    ⚠️ This claim references outdated evidence.
                                                </p>
                                            )}

                                            {/* Warn the officer if the source is unofficial. */}
                                            {source?.authority === 'unofficial' && (
                                                <p className="evidence-warning">
                                                    ⚠️ Unofficial source — verify before relying on it.
                                                </p>
                                            )}

                                            {/* Show the exact evidence quoted by the backend. */}
                                            {claim.quote && (
                                                <details className="source-details">
                                                    <summary>View Exact Evidence</summary>

                                                    <div className="source-passage">
                                                        <strong>Evidence Passage:</strong>
                                                        <p>{claim.quote}</p>
                                                    </div>
                                                </details>
                                            )}

                                        </div>
                                    </div>
                                )
                            })}

                            {/* Handle answers with no claims. */}
                            {(!selectedResult.claims ||
                                selectedResult.claims.length === 0) && (
                                    <p>No claims available for verification.</p>
                                )}
                        </div>

                            

                              {/* Display the real human review status from the backend. */}
                              <div className="review-action-section">

                                  {/* Case 1: The answer is already waiting for a reviewer. */}
                                  {isReviewPending ? (
                                      <div className="review-success-message">

                                          <div className="review-status-header">
                                              <strong>Human Review</strong>
                                              <span className="review-pending-badge">
                                                  Pending Review
                                              </span>
                                          </div>

                                          <p>
                                              This answer has already been sent for human review.
                                              Please wait for a reviewer to check it.
                                          </p>

                                          <p>
                                              Do not send this AI answer to the customer yet.
                                          </p>

                                      </div>

                                  ) : isReviewCompleted ? (

                                      /* Case 2: The reviewer has already made a decision. */
                                      <div className="review-success-message">

                                          <div className="review-status-header">
                                              <strong>Human Review</strong>
                                              <span className="review-approved-badge">
                                                  Review Completed
                                              </span>
                                          </div>

                                          <p>
                                              A human reviewer has completed the review.
                                          </p>

                                      </div>

                                  ) : (

                                      /* Case 3: No review has been requested yet. */
                                        <button
                                            className="send-review-button"
                                            onClick={handleRequestReview}
                                            disabled={sendingReview}
                                        >
                                            {sendingReview
                                                ? 'Sending for Review...'
                                                : 'Request Human Review'}
                                        </button>
                                  )}
                                  {reviewError && (
                                      <p role="alert" className="evidence-warning">
                                          {reviewError}
                                      </p>
                                  )}

                              </div>

                        
                
                    </div>
            </section>
        )}
      </div>
    </div>
  )
}

export default OfficerWorkspace
