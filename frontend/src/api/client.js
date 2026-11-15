/*
  Shared API client for the React app.
  Every call follows docs/api-contract.md (React <-> Node).

  The back office uses the real Node API by default.
  To use the built-in sample data instead (no backend needed),
  create frontend/.env.local with:
    VITE_USE_MOCK=true
  To point at a backend that is not on this laptop:
    VITE_API_URL=http://<laptop-ip>:3000
*/

export const USE_MOCK = import.meta.env.VITE_USE_MOCK === 'true'
export const API_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

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
