import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResponseHeaders, corsHeaders } from './headers.ts'

const plain = new Request('https://proxy.test/')
const fromPage = new Request('https://proxy.test/', { headers: { origin: 'https://page.example' } })

// An event stream must reach the page as it is produced. Cloudflare compresses
// a compressible response on the way out and a compressor buffers, so without
// no-transform the tokens arrive in one lump at the end.
test('an event stream is marked no-transform', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }), plain)
  assert.match(h.get('cache-control') ?? '', /no-transform/)
})

test('an existing cache-control keeps its own directives', () => {
  const h = createResponseHeaders(
    new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, private' }),
    plain,
  )
  const cc = h.get('cache-control') ?? ''
  assert.match(cc, /no-cache/)
  assert.match(cc, /private/)
  assert.match(cc, /no-transform/)
})

test('no-transform is not appended twice', () => {
  const h = createResponseHeaders(
    new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' }),
    plain,
  )
  assert.equal((h.get('cache-control') ?? '').match(/no-transform/g)?.length, 1)
})

// Only the streaming case is opted out of compression: everything else still
// gets compressed on the way to the visitor, which is what we want.
test('a non-streaming response is left compressible', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'application/json' }), plain)
  assert.equal(h.get('cache-control'), null)
})

test('content-encoding is dropped, because the body is passed through decoded', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/html', 'content-encoding': 'gzip' }), plain)
  assert.equal(h.get('content-encoding'), null)
})

test('without an Origin the wildcard is used', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/plain' }), plain)
  assert.equal(h.get('access-control-allow-origin'), '*')
  assert.match(h.get('access-control-allow-headers') ?? '', /Authorization/)
})

// A browser rejects a wildcard on a request made with credentials, so the
// page's own Origin must come back, with credentials allowed.
test('an Origin is echoed with credentials allowed', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/plain', vary: 'Accept-Encoding' }), fromPage)
  assert.equal(h.get('access-control-allow-origin'), 'https://page.example')
  assert.equal(h.get('access-control-allow-credentials'), 'true')
  assert.equal(h.get('vary'), 'Accept-Encoding, Origin')
})

test('a preflight echoes the requested method and headers', () => {
  const h = corsHeaders(new Request('https://proxy.test/', {
    method: 'OPTIONS',
    headers: {
      origin: 'https://page.example',
      'access-control-request-method': 'PUT',
      'access-control-request-headers': 'x-custom, authorization',
    },
  }))
  assert.equal(h['access-control-allow-methods'], 'PUT')
  assert.equal(h['access-control-allow-headers'], 'x-custom, authorization')
})

test('exposed headers are listed by name, because * is literal with credentials', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/plain', etag: '"1"' }), fromPage)
  const exposed = h.get('access-control-expose-headers') ?? ''
  assert.match(exposed, /content-type/)
  assert.match(exposed, /etag/)
})

test('origin policy that would restrict the page is dropped', () => {
  const h = createResponseHeaders(new Headers({
    'content-type': 'text/plain',
    'content-security-policy-report-only': "default-src 'none'",
    'cross-origin-resource-policy': 'same-origin',
    'cross-origin-opener-policy': 'same-origin',
    'cross-origin-embedder-policy': 'require-corp',
    'x-content-type-options': 'nosniff',
    'clear-site-data': '"*"',
  }), plain)
  for (const name of ['content-security-policy-report-only', 'cross-origin-opener-policy', 'cross-origin-embedder-policy', 'x-content-type-options', 'clear-site-data']) {
    assert.equal(h.get(name), null, name)
  }
  assert.equal(h.get('cross-origin-resource-policy'), 'cross-origin')
  assert.equal(h.get('timing-allow-origin'), '*')
})

test('several set-cookie headers all survive', () => {
  const from = new Headers()
  from.append('set-cookie', 'a=1')
  from.append('set-cookie', 'b=2')
  const h = createResponseHeaders(from, plain)
  const cookies = [...h].filter(([name]) => name === 'set-cookie').map(([, value]) => value)
  assert.deepEqual(cookies, ['a=1', 'b=2'])
})
