// Dropped from every reply: framing the proxy undoes, and origin policy that
// would bind the proxy's origin or restrict the page that reads the reply.
const SKIP_HEADERS = new Set([
  'content-encoding',
  'content-security-policy',
  'content-security-policy-report-only',
  'x-frame-options',
  'strict-transport-security',
  'cross-origin-resource-policy',
  'cross-origin-opener-policy',
  'cross-origin-embedder-policy',
  'x-content-type-options',
  'clear-site-data',
])

// A browser refuses a wildcard on a request that carries credentials, so the
// Origin and the preflight's own asks are echoed. Exposed headers are listed
// by name for the same reason.
export function corsHeaders(request: Request, exposed?: Headers): Record<string, string> {
  return {
    'access-control-allow-origin': request.headers.get('origin') ?? '*',
    'access-control-allow-credentials': 'true',
    'access-control-allow-methods': request.headers.get('access-control-request-method') ?? '*',
    'access-control-allow-headers': request.headers.get('access-control-request-headers') ?? '*, Authorization',
    'access-control-expose-headers': exposed ? [...exposed.keys()].join(', ') : '*',
    'access-control-max-age': '86400',
    'cross-origin-resource-policy': 'cross-origin',
    'timing-allow-origin': '*',
    'vary': 'Origin',
  }
}

export function createResponseHeaders(originalHeaders: Headers, request: Request): Headers {
  const headers = new Headers()

  for (const [key, value] of originalHeaders) {
    if (!SKIP_HEADERS.has(key.toLowerCase())) {
      headers.append(key, value)
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

  const vary = headers.get('vary')
  for (const [key, value] of Object.entries(corsHeaders(request, headers))) {
    headers.set(key, value)
  }
  if (vary) headers.set('vary', `${vary}, Origin`)

  return headers
}
