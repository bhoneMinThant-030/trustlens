
/*
  Officer Workspace API functions.

  This file connects the Officer Workspace to the Node.js backend.

  We use the shared request() function from client.js
  instead of writing fetch() directly in our React component.
*/

import { request } from './client'

// Demo officer account used by our backend.
const OFFICER = {
  id: 'officer-1',
  role: 'officer',
}

// GET /api/officer/emails
// Load the emails belonging to this officer.
export async function getOfficerEmails() {
  return request('/api/officer/emails', {
    user: OFFICER,
  })
}

// GET /api/officer/emails/:emailId/answer
// Load the existing AI answer for a selected email.
// The backend returns 404 if the email has no answer yet.
export async function getEmailAnswer(emailId) {
  return request(`/api/officer/emails/${encodeURIComponent(emailId)}/answer`, {
    user: OFFICER,
  })
}

// POST /api/ask
// Generate an AI answer only when the officer clicks the button.
export async function generateAnswer(emailId, question) {
  return request('/api/ask', {
    method: 'POST',
    user: OFFICER,
    body: {
      emailId,
      question,
    },
  })
}

// POST /api/answers/:answerId/review
// Manually request a human review for an existing answer.
export async function requestHumanReview(answerId, note = '') {
  return request(`/api/answers/${encodeURIComponent(answerId)}/review`, {
    method: 'POST',
    user: OFFICER,
    body: { note },
  })
}
