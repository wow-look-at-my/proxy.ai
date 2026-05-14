const SKIP_HEADERS = new Set([
  'content-encoding',
  'content-security-policy',
  'x-frame-options',
  'strict-transport-security',
  'location',
])

export function createResponseHeaders(originalHeaders: Headers): Headers {
  const headers = new Headers()

  for (const [key, value] of originalHeaders) {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }

  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', '*')
  // Authorization is explicitly excluded from the CORS wildcard by spec
  headers.set('access-control-allow-headers', '*, Authorization')
  headers.set('access-control-expose-headers', '*')
  headers.set('access-control-max-age', '86400')

  return headers
}

export const CORS_HEADERS: Record<string, string> = {
  'access-control-allow-origin': '*',
  'access-control-allow-methods': '*',
  'access-control-allow-headers': '*, Authorization',
  'access-control-expose-headers': '*',
  'access-control-max-age': '86400',
}
