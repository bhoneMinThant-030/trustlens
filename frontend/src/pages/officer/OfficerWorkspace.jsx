// useEffect runs code when the page first loads.
import { useEffect, useState } from 'react'

// Get the officer's emails from the backend API.
import { getOfficerEmails, getEmailAnswer } from '../../api/officer'
import './OfficerWorkspace.css'
import { mockResults } from '../../data/mockResults'

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

  const [showResult, setShowResult] = useState(false)
  const [reviewRequested, setReviewRequested] = useState(false) // Store whether the officer has requested human review.
  const [reviewCompleted, setReviewCompleted] = useState(false)// Remember whether the demo reviewer has returned an answer.
    // Find the matching mock result only when an email is selected.
    // ?. prevents an error while the backend emails are loading.
    // This mock-result lookup is temporary until we connect the answer API.
    const selectedResult = selectedEmail
        ? mockResults.find((result) => result.id === selectedEmail.emailId)
        : null
    
  // Checking whether any claim contradicts the approved evidence.
  const hasContradiction = selectedResult?.claims?.some(
    (claim) => claim.status === 'Contradicted'
  ) ?? false

  // Human review is needed if the score is below 70%
  // or if at least one claim is contradicted.
  const needsReview = selectedResult
    ? selectedResult.confidence < 70 || hasContradiction
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
              key={email.id}
              className={`officer-email-item ${selectedEmail?.emailId === email.emailId ? 'selected' : ''}`}
                onClick={() => {
                    // Change the currently selected email.
                    setSelectedEmail(email)

                    // Hide the old AI result until the officer checks again.
                    setShowResult(false)

                    // Reset the review button for the newly selected email.
                    setReviewRequested(false)

                    // Hide the previous email's reviewed answer.
                    setReviewCompleted(false)
                }}
            >
            <strong>{email.customerName}</strong>
            <span>{email.cardType}</span>
            <small>{new Date(email.createdAt).toLocaleString('en-SG')}</small>
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
            <button
                className="trustlens-check-button"
                onClick={() => setShowResult(true)}
            >
                Check with TrustLens
            </button>

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
                        className={`confidence-section ${selectedResult.confidence >= 70 &&
                                selectedResult.status === "Supported"
                                ? "confidence-high"
                                : selectedResult.confidence >= 50
                                    ? "confidence-medium"
                                    : "confidence-low"
                            }`}
                    >
                        {/* Show the confidence score. */}
                        <h4>Confidence Score</h4>

                        <p className="confidence-score">
                            {selectedResult.confidence}%
                        </p>

                        {/* Show whether the answer needs review. */}
                        <p className="confidence-status">
                            {selectedResult.status}
                        </p>
                    </div>


                    {/* This displays the sample AI answer. */}
                    <div className="ai-answer-section">
                        <h4>Suggested AI Answer</h4>

                        <p>{selectedResult.answer}</p>
                    </div>

                    {/* This displays each verification message as a separate line. */}
                    <div className="verification-section">
                        <h4>Verification Result</h4>

                        {selectedResult.verification.map((message, index) => (
                            <p key={index}>
                                {message}
                            </p>
                        ))}
                    </div>
                    
                    {/* Show each claim checked by TrustLens. */}
                    <div className="claims-section">
                        <h4>Claim-by-Claim Verification</h4>

                        {/* Loop through all claims in the selected result. */}
                        {selectedResult.claims.map((claim) => (

                            <div className="claim-card" key={claim.id}>

                                {/* Show the claim number and its verification status. */}
                                <div className="claim-header">
                                    <strong>Claim {claim.id}</strong>

                                    <span
                                        className={`claim-status ${claim.status === "Supported"
                                                ? "claim-supported"
                                                : claim.status === "Contradicted"
                                                    ? "claim-contradicted"
                                                    : "claim-insufficient"
                                            }`}
                                    >
                                        {claim.status}
                                    </span>
                                </div>

                                {/* Display the statement that was checked. */}
                                <p>{claim.text}</p>

                                
                                    {/* Show the evidence used to check this AI claim. */}
                                    <div className="claim-source">

                                        {/* Display the name of the source document. */}
                                        <strong>Evidence Source:</strong>

                                        <p>
                                            {claim.source
                                                ? claim.source
                                                : "No matching approved source found"}
                                        </p>

                                        
                                                {/* Allow the officer to expand or hide the source passage. */}
                                                {claim.sourcePassage && (

                                                    <details className="source-details">

                                                        {/* Clicking this heading opens or closes the passage. */}
                                                        <summary>View Source Evidence</summary>

                                                        {/* Display the exact source passage when expanded. */}
                                                        <div className="source-passage">
                                                            <strong>Source Passage:</strong>
                                                            <p>{claim.sourcePassage}</p>
                                                        </div>
                                                    </details>
                                                )}


                                    </div>


                            </div>
                        ))}
                    </div>
                    
                    {/* Allow the officer to request human review. */}
                    <div className="review-action-section">

                    {/* Show this button only if review has not been requested. */}
                    {!reviewRequested ? (

                        
                        <button
                            className="send-review-button"

                            // Save that the officer requested a review.
                            onClick={() => setReviewRequested(true)}
                        >
                            {/* Change the button text based on the verification result. */}
                            {needsReview
                                ? 'Send for Human Review'
                                : 'Request Manual Review'}
                        </button>


                    ) : (
                        
                        <div className="review-success-message">
                            {/* Show the review status after the officer clicks the review button. */}

                            
                        {/* Show whether the review is pending or completed. */}
                        <div className="review-status-header">

                            <strong>Human Review</strong>

                            <span
                                className={
                                    reviewCompleted
                                        ? "review-approved-badge"
                                        : "review-pending-badge"
                                }
                            >
                                {reviewCompleted
                                    ? "Review Completed"
                                    : "Pending Review"}
                            </span>

                        </div>


                            
                            {/* Change the message based on the review status. */}
                            <p>
                                {reviewCompleted
                                    ? "The demo reviewer has returned a reviewed answer. Check the response below."
                                    : "This answer is waiting for a human reviewer to check it. Do not send it to the customer yet."}
                            </p>


                            {/* Explain that the review request is only stored in React for now. */}
                            <small>
                                Demo only — request recorded locally.
                                Not yet sent to the backend or reviewer queue.
                            </small>
                            
                            {/* Demo button to simulate a completed human review. */}
                            {reviewRequested && !reviewCompleted && selectedResult.reviewedAnswer && (
                            <button
                                className="demo-review-button"
                                onClick={() => setReviewCompleted(true)}
                            >
                                Simulate Reviewer Response (Demo)
                            </button>
                            )}

                            {/* Show the reviewed answer after the demo reviewer responds. */}
                            {reviewCompleted && selectedResult.reviewedAnswer && (
                            <div className="reviewed-answer-section">

                                <h4>Human-Reviewed Answer</h4>

                                <p>{selectedResult.reviewedAnswer}</p>

                                <small>
                                Sample reviewer response only.
                                Not received from the backend.
                                </small>

                            </div>
                            )}


                        </div>
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
