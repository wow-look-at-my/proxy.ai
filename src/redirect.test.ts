import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import worker from './index.ts'

// Both servers run one handler.
let server: Server
let other: Server
let origin: string
let otherOrigin: string

async function handle(req: IncomingMessage, res: ServerResponse) {
	switch (req.url) {
		case '/start':
			res.writeHead(302, { location: '/hop' })
			return res.end()
		case '/hop':
			res.writeHead(301, { location: `${origin}/final/page.txt` })
			return res.end()
		case '/final/page.txt':
			res.writeHead(200, { 'content-type': 'text/plain' })
			return res.end('arrived')
		case '/old/style.css':
			res.writeHead(302, { location: '/new/style.css' })
			return res.end()
		case '/new/style.css':
			res.writeHead(200, { 'content-type': 'text/css' })
			return res.end('body { background: url(bg.png) }')
		case '/form':
			res.writeHead(303, { location: '/echo' })
			return res.end()
		case '/keep':
			res.writeHead(307, { location: '/echo' })
			return res.end()
		case '/echo': {
			const chunks: Buffer[] = []
			for await (const chunk of req) chunks.push(chunk)
			res.writeHead(200, { 'content-type': 'application/json' })
			return res.end(JSON.stringify({
				method: req.method,
				length: req.headers['content-length'] ?? null,
				body: Buffer.concat(chunks).toString(),
			}))
		}
		case '/same':
			res.writeHead(302, { location: '/headers' })
			return res.end()
		case '/cross':
			res.writeHead(302, { location: `${otherOrigin}/headers` })
			return res.end()
		case '/headers':
			res.writeHead(200, { 'content-type': 'text/plain' })
			return res.end([
				req.headers.authorization ?? '-',
				req.headers.cookie ?? '-',
				req.headers['x-proxy-redirect-hosts'] ?? '-',
			].join(' '))
		case '/ua':
			res.writeHead(200, { 'content-type': 'text/plain' })
			return res.end(req.headers['user-agent'])
		case '/loop':
			res.writeHead(302, { location: '/loop' })
			return res.end()
		case '/data':
			res.writeHead(302, { location: 'data:text/plain,evil' })
			return res.end()
		case '/self':
			res.writeHead(302, { location: `https://proxy.test/?url=${encodeURIComponent(`${origin}/final/page.txt`)}` })
			return res.end()
		case '/create':
			res.writeHead(201, { 'content-type': 'text/plain', location: `${origin}/final/page.txt` })
			return res.end('created')
		case '/unchanged':
			res.writeHead(304)
			return res.end()
	}
	res.writeHead(404)
	res.end()
}

async function listen(s: Server, host: string): Promise<string> {
	await new Promise<void>(resolve => s.listen(0, resolve))
	return `http://${host}:${(s.address() as AddressInfo).port}`
}

before(async () => {
	server = createServer(handle)
	other = createServer(handle)
	origin = await listen(server, '127.0.0.1')
	otherOrigin = await listen(other, 'localhost')
})

after(() => {
	server.close()
	other.close()
})

function proxied(target: string, init?: RequestInit): Promise<Response> {
	return worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(target)}`, init))
}

test('a redirect chain is followed to the final page', async () => {
	const res = await proxied(`${origin}/start`)
	assert.equal(res.status, 200, 'the proxy must not hand a 3xx back to the client')
	assert.equal(await res.text(), 'arrived')
	assert.equal(res.headers.get('location'), null)
	assert.equal(res.headers.get('access-control-allow-origin'), '*')
})

test('a preflight is answered by the proxy for any origin, method and header', async () => {
	const res = await worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(`${origin}/final/page.txt`)}`, {
		method: 'OPTIONS',
		headers: {
			origin: 'https://page.example',
			'access-control-request-method': 'DELETE',
			'access-control-request-headers': 'authorization, x-proxy-redirect-hosts',
		},
	}))
	assert.equal(res.status, 204)
	assert.equal(res.headers.get('access-control-allow-origin'), 'https://page.example')
	assert.equal(res.headers.get('access-control-allow-credentials'), 'true')
	assert.equal(res.headers.get('access-control-allow-methods'), 'DELETE')
	assert.equal(res.headers.get('access-control-allow-headers'), 'authorization, x-proxy-redirect-hosts')
})

test('a page origin is echoed on the proxied reply and on an error', async () => {
	const ok = await proxied(`${origin}/final/page.txt`, { headers: { origin: 'https://page.example' } })
	assert.equal(ok.headers.get('access-control-allow-origin'), 'https://page.example')
	assert.equal(ok.headers.get('cross-origin-resource-policy'), 'cross-origin')
	const bad = await proxied(`${origin}/loop`, { headers: { origin: 'https://page.example' } })
	assert.equal(bad.status, 500)
	assert.equal(bad.headers.get('access-control-allow-origin'), 'https://page.example')
	assert.equal(bad.headers.get('access-control-allow-credentials'), 'true')
})

test('links resolve against the URL the redirects end at', async () => {
	const res = await proxied(`${origin}/old/style.css`)
	const css = await res.text()
	const expected = `https://proxy.test/?url=${encodeURIComponent(`${origin}/new/bg.png`)}`
	assert.ok(css.includes(expected), `bg.png must resolve under /new/, got: ${css}`)
})

test('a 303 after a POST is followed with a GET and no body headers', async () => {
	const res = await proxied(`${origin}/form`, {
		method: 'POST',
		body: 'x=1',
		headers: { 'content-type': 'text/plain', 'content-length': '3' },
	})
	const body = await res.text()
	assert.equal(res.status, 200, body)
	assert.deepEqual(JSON.parse(body), { method: 'GET', length: null, body: '' })
})

test('a 307 after a POST sends the same body again', async () => {
	const res = await proxied(`${origin}/keep`, { method: 'POST', body: 'x=1' })
	const body = await res.text()
	assert.equal(res.status, 200, body)
	assert.deepEqual(JSON.parse(body), { method: 'POST', length: '3', body: 'x=1' })
})

const credentials = { authorization: 'Bearer t', cookie: 'a=1' }

test('Authorization follows a redirect within one host', async () => {
	const res = await proxied(`${origin}/same`, { headers: credentials })
	assert.equal(await res.text(), 'Bearer t a=1 -')
})

test('a redirect to another host is refused while Authorization is set', async () => {
	const res = await proxied(`${origin}/cross`, { headers: credentials })
	const body = await res.text()
	assert.equal(res.status, 400, body)
	assert.match(body, /localhost/)
	assert.match(body, /x-proxy-redirect-hosts/)
})

test('a listed host receives Authorization, and not the list itself', async () => {
	const res = await proxied(`${origin}/cross`, {
		headers: { ...credentials, 'x-proxy-redirect-hosts': 'other.example, LOCALHOST' },
	})
	assert.equal(await res.text(), 'Bearer t a=1 -')
})

test('a star allows every host', async () => {
	const res = await proxied(`${origin}/cross`, { headers: { ...credentials, 'x-proxy-redirect-hosts': '*' } })
	assert.equal(await res.text(), 'Bearer t a=1 -')
})

test('without Authorization a redirect to another host is followed', async () => {
	const res = await proxied(`${origin}/cross`, { headers: { cookie: 'a=1' } })
	assert.equal(await res.text(), '- a=1 -')
})

test('headers, the method and a body can come from the query string', async () => {
	const query = new URLSearchParams({ method: 'post', body: 'x=1' })
	query.append('header', 'content-type: text/plain')
	query.append('header', 'authorization: Bearer q')
	query.append('header', 'x-proxy-redirect-hosts: localhost')
	const res = await worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(`${origin}/keep`)}&${query}`))
	const body = await res.text()
	assert.equal(res.status, 200, body)
	assert.deepEqual(JSON.parse(body), { method: 'POST', length: '3', body: 'x=1' })

	const cross = await worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(`${origin}/cross`)}&${query}`))
	assert.equal(await cross.text(), 'Bearer q - -')
})

test('a query header without a colon is a 400 that a browser cannot read as HTML', async () => {
	const res = await worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(`${origin}/final/page.txt`)}&header=%3Cb%3Enocolon`))
	assert.equal(res.status, 400)
	assert.match(await res.text(), /<b>nocolon/)
	assert.match(res.headers.get('content-type') ?? '', /^text\/plain/)
	assert.equal(res.headers.get('x-content-type-options'), 'nosniff')
})

test('a body is ignored for a GET', async () => {
	const res = await worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(`${origin}/final/page.txt`)}&body=x`))
	assert.equal(res.status, 200)
	assert.equal(await res.text(), 'arrived')
})

test('the user agent is spoofed unless a query header names one', async () => {
	const spoofed = await proxied(`${origin}/ua`, { headers: { 'user-agent': 'client/1' } })
	assert.match(await spoofed.text(), /^Mozilla\/5\.0 /)
	const named = await worker.fetch(new Request(`https://proxy.test/?url=${encodeURIComponent(`${origin}/ua`)}&header=user-agent%3A%20mine%2F2`))
	assert.equal(await named.text(), 'mine/2')
})

test('a redirect loop ends with an error, not a hang', async () => {
	const res = await proxied(`${origin}/loop`)
	assert.equal(res.status, 500)
	assert.match(await res.text(), /redirect/i)
})

test('a redirect to a non-http scheme is refused', async () => {
	const res = await proxied(`${origin}/data`)
	const body = await res.text()
	assert.equal(res.status, 500, body)
	assert.doesNotMatch(body, /evil/)
})

test('a redirect back to the proxy is refused on every hop', async () => {
	const res = await proxied(`${origin}/self`)
	assert.equal(res.status, 400)
	assert.equal(await res.text(), 'Cannot proxy self')
})

test('a 201 keeps its Location header', async () => {
	const res = await proxied(`${origin}/create`)
	assert.equal(res.status, 201)
	assert.equal(res.headers.get('location'), `${origin}/final/page.txt`)
})

test('a 304 is not a redirect and passes through', async () => {
	const res = await proxied(`${origin}/unchanged`)
	assert.equal(res.status, 304)
})
