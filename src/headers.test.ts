import { test } from 'node:test'
import assert from 'node:assert/strict'
import { createResponseHeaders } from './headers.ts'

// An event stream must reach the page as it is produced. Cloudflare compresses
// a compressible response on the way out and a compressor buffers, so without
// no-transform the tokens arrive in one lump at the end.
test('an event stream is marked no-transform', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/event-stream; charset=utf-8' }))
  assert.match(h.get('cache-control') ?? '', /no-transform/)
})

test('an existing cache-control keeps its own directives', () => {
  const h = createResponseHeaders(
    new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, private' }),
  )
  const cc = h.get('cache-control') ?? ''
  assert.match(cc, /no-cache/)
  assert.match(cc, /private/)
  assert.match(cc, /no-transform/)
})

test('no-transform is not appended twice', () => {
  const h = createResponseHeaders(
    new Headers({ 'content-type': 'text/event-stream', 'cache-control': 'no-cache, no-transform' }),
  )
  assert.equal((h.get('cache-control') ?? '').match(/no-transform/g)?.length, 1)
})

// Only the streaming case is opted out of compression: everything else still
// gets compressed on the way to the visitor, which is what we want.
test('a non-streaming response is left compressible', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'application/json' }))
  assert.equal(h.get('cache-control'), null)
})

test('content-encoding is dropped, because the body is passed through decoded', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/html', 'content-encoding': 'gzip' }))
  assert.equal(h.get('content-encoding'), null)
})

test('CORS headers are present so a browser can read the reply', () => {
  const h = createResponseHeaders(new Headers({ 'content-type': 'text/plain' }))
  assert.equal(h.get('access-control-allow-origin'), '*')
  assert.match(h.get('access-control-allow-headers') ?? '', /Authorization/)
})
