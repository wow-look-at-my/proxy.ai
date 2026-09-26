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

  // Cloudflare compresses a compressible response on its way to the visitor,
  // and a compressor buffers. An event stream then reaches the page in one
  // piece at the end, which reads as "streaming does not work". no-transform is
  // the documented off switch: "Compression is disabled when the no-transform
  // directive is present" (Cloudflare, Cache Control).
  if ((originalHeaders.get('content-type') || '').includes('text/event-stream')) {
    const cc = headers.get('cache-control') || 'no-cache'
    if (!cc.includes('no-transform')) headers.set('cache-control', `${cc}, no-transform`)
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
