const SKIP_HEADERS = new Set([
  'content-encoding',
  'content-security-policy',
  'x-frame-options',
  'strict-transport-security',
])

export function createResponseHeaders(originalHeaders: Headers): Headers {
  const headers = new Headers()

  for (const [key, value] of originalHeaders) {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }

  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  headers.set('access-control-allow-headers', '*, Authorization')

  return headers
}

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': 'GET, HEAD, OPTIONS',
  'access-control-allow-headers': '*, Authorization',
}
