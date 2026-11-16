import { useEffect, useRef, useState } from 'react'
import { io } from 'socket.io-client'
import { API_URL } from '../../api/client'
import { generateAnswer } from '../../api/officer'
import { CLAIM_LABELS } from '../../constants/labels'
import { REVIEW_REASONS } from './reviewText'
import './AskTrustLens.css'

/*
  "Ask TrustLens" chat for officers.
  Each question goes through the same checks as an email answer:
  POST /api/ask with a chat_ id, so risky answers still go to a reviewer.
  When the reviewer decides, review:resolved updates the message live.
  The thread lives in page memory only, and each question stands alone.
*/

const STARTER_QUESTIONS = [
  'What is the minimum monthly payment on my credit card?',
  'What is the monthly cashback cap on the OCBC 365 card?',
  'Can I use my credit card to buy cryptocurrency?',
]

function newChatId() {
  return `chat_${crypto.randomUUID()}`
}

// Badge + one line telling the officer whether the answer can be used.
function ReplyStatus({ result, reviewed }) {
  if (reviewed) {
    return (
      <div className="chat-status chat-status-good">
        <span className="chat-badge chat-badge-good">
          {reviewed.decision === 'corrected' ? 'Reviewed: corrected' : 'Reviewed: approved'}
        </span>
        <span>A reviewer checked this answer. You can use it.</span>
      </div>
    )
  }
  if (result.review) {
    return (
      <div className="chat-status chat-status-wait">
        <span className="chat-badge chat-badge-wait">Sent to review</span>
        <span>
          {REVIEW_REASONS[result.review.trigger] ?? 'Flagged for a human check'}. Don't use this answer
          until a reviewer checks it.
        </span>
      </div>
    )
  }
  return (
    <div className="chat-status chat-status-good">
      <span className="chat-badge chat-badge-good">Verified</span>
      <span>Every claim is backed by a current official source.</span>
    </div>
  )
}

function Evidence({ result }) {
  const claims = result.claims ?? []
  const sources = result.sources ?? []
  if (claims.length === 0 && sources.length === 0) return null

  return (
    <details className="chat-evidence">
      <summary>
        Evidence: {claims.length} {claims.length === 1 ? 'claim' : 'claims'}, {sources.length}{' '}
        {sources.length === 1 ? 'source' : 'sources'}
      </summary>

      {claims.map((claim, index) => (
        <div className="chat-claim" key={claim.id ?? index}>
          <span className={`bo-label bo-label-${claim.label}`}>
            {CLAIM_LABELS[claim.label] ?? claim.label}
          </span>
          <p>{claim.text}</p>
          {claim.quote && <blockquote>{claim.quote}</blockquote>}
          {claim.reason && <p className="chat-muted">{claim.reason}</p>}
        </div>
      ))}

      {sources.length > 0 && (
        <ul className="chat-sources">
          {sources.map((source) => (
            <li key={source.id}>
              <strong>{source.title}</strong> · v{source.version}
              {source.cited === false ? ' · also found' : ' · cited'}
              {source.authority === 'unofficial' && (
                <span className="chat-flag"> · unofficial, don't rely on it</span>
              )}
              {source.outdated && (
                <span className="chat-flag">
                  {' '}
                  · outdated{source.newerVersion ? `, replaced by v${source.newerVersion}` : ''}
                </span>
              )}
            </li>
          ))}
        </ul>
      )}
    </details>
  )
}

function Reply({ message }) {
  if (message.status === 'loading') {
    return (
      <div className="chat-bubble chat-bubble-bot chat-loading" role="status">
        Checking against the knowledge base…
      </div>
    )
  }
  if (message.status === 'error') {
    return (
      <div className="chat-bubble chat-bubble-bot chat-error" role="alert">
        {message.error} Try again.
      </div>
    )
  }

  const { result, reviewed } = message
  const corrected = reviewed?.decision === 'corrected' && reviewed.correctedAnswer
  const confidence = typeof result.confidence === 'number' ? Math.round(result.confidence * 100) : null

  return (
    <div className="chat-bubble chat-bubble-bot">
      <ReplyStatus result={result} reviewed={reviewed} />

      <p className="chat-answer">{corrected ? reviewed.correctedAnswer : result.answer}</p>

      {corrected && (
        <details className="chat-original">
          <summary>Original AI answer</summary>
          <p>{result.answer}</p>
        </details>
      )}
      {reviewed?.reason && <p className="chat-muted">Reviewer: {reviewed.reason}</p>}

      {confidence !== null && <p className="chat-meta">AI confidence {confidence}%</p>}

      <Evidence result={result} />
    </div>
  )
}

function AskTrustLens() {
  const [messages, setMessages] = useState([])
  const [input, setInput] = useState('')
  const [inputError, setInputError] = useState('')
  const endRef = useRef(null)
  const sending = messages.some((message) => message.status === 'loading')

  // Live: a reviewer's decision on a chat answer updates that message.
  useEffect(() => {
    const socket = io(API_URL, { query: { role: 'officer', userId: 'officer-1' } })
    socket.on('review:resolved', (event) => {
      if (!event.emailId?.startsWith('chat_')) return
      setMessages((current) =>
        current.map((message) =>
          message.chatId === event.emailId
            ? {
                ...message,
                reviewed: {
                  decision: event.decision,
                  correctedAnswer: event.correctedAnswer,
                  reason: event.reason,
                },
              }
            : message,
        ),
      )
    })
    return () => socket.disconnect()
  }, [])

  // Keep the newest message in view.
  useEffect(() => {
    endRef.current?.scrollIntoView?.({ behavior: 'smooth', block: 'nearest' })
  }, [messages])

  async function ask(text) {
    const question = text.trim()
    if (!question) {
      setInputError('Type a question first.')
      return
    }
    if (sending) return

    const chatId = newChatId()
    setInput('')
    setInputError('')
    setMessages((current) => [
      ...current,
      { id: `${chatId}-q`, role: 'officer', text: question },
      { id: `${chatId}-a`, role: 'trustlens', chatId, status: 'loading' },
    ])

    try {
      const result = await generateAnswer(chatId, question)
      setMessages((current) =>
        current.map((message) =>
          message.chatId === chatId && message.role === 'trustlens'
            ? { ...message, status: 'done', result }
            : message,
        ),
      )
    } catch (error) {
      setMessages((current) =>
        current.map((message) =>
          message.chatId === chatId && message.role === 'trustlens'
            ? { ...message, status: 'error', error: error.message }
            : message,
        ),
      )
    }
  }

  function handleSubmit(event) {
    event.preventDefault()
    ask(input)
  }

  return (
    <section className="ask-trustlens">
      <div className="ask-head">
        <h2>Ask TrustLens</h2>
        <p>
          Ask about card policies. Every answer is checked against the knowledge base, and risky
          ones go to a reviewer first. Each question stands alone, and answers take 5 to 15 seconds.
        </p>
      </div>

      <div className="chat-thread" aria-live="polite">
        {messages.length === 0 && (
          <p className="chat-empty">No questions yet. Try one of these:</p>
        )}

        {messages.map((message) =>
          message.role === 'officer' ? (
            <div key={message.id} className="chat-bubble chat-bubble-officer">
              {message.text}
            </div>
          ) : (
            <Reply key={message.id} message={message} />
          ),
        )}
        <div ref={endRef} />
      </div>

      <div className="chat-starters">
        {STARTER_QUESTIONS.map((question) => (
          <button
            key={question}
            type="button"
            className="chat-starter"
            onClick={() => ask(question)}
            disabled={sending}
          >
            {question}
          </button>
        ))}
      </div>

      <form className="chat-form" onSubmit={handleSubmit}>
        <input
          type="text"
          value={input}
          onChange={(event) => {
            setInput(event.target.value)
            if (inputError) setInputError('')
          }}
          placeholder="What is the late payment fee?"
          aria-label="Your question"
          maxLength={2000}
        />
        <button type="submit" className="chat-send" disabled={sending}>
          {sending ? 'Checking…' : 'Ask'}
        </button>
      </form>
      {inputError && (
        <p className="chat-input-error" role="alert">
          {inputError}
        </p>
      )}
    </section>
  )
}

export default AskTrustLens
