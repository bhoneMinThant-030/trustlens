/*
  Shared API client for the React app.
  Every call follows docs/api-contract.md (React <-> Node).

  While the Node back end is not ready, USE_MOCK is true and the
  back office reads from src/api/mockBackofficeStore.js instead.
  To use the real API, create frontend/.env.local with:
    VITE_USE_MOCK=false
    VITE_API_URL=http://localhost:3000
*/

export const USE_MOCK = import.meta.env.VITE_USE_MOCK !== 'false'
const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

// Error thrown for any failed request. `code` comes from the
// contract's error shape: { "error": { "code", "message" } }
export class ApiError extends Error {
  constructor(code, message, status) {
    super(message)
    this.code = code
    this.status = status
  }
}

// `user` is a demo user, e.g. { id: 'reviewer-1', role: 'reviewer' }.
// The contract has no login; it uses X-User-Id and X-Role headers.
export async function request(path, { method = 'GET', body, user } = {}) {
  const headers = { 'Content-Type': 'application/json' }
  if (user) {
    headers['X-User-Id'] = user.id
    headers['X-Role'] = user.role
  }

  let response
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers,
      body: body ? JSON.stringify(body) : undefined,
    })
  } catch {
    throw new ApiError('NETWORK_ERROR', 'Could not reach the TrustLens server.', 0)
  }

  const data = await response.json().catch(() => null)
  if (!response.ok) {
    const error = data?.error ?? {}
    throw new ApiError(
      error.code ?? 'HTTP_ERROR',
      error.message ?? `Request failed (${response.status})`,
      response.status,
    )
  }
  return data
}
