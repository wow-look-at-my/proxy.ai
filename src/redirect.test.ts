import { test, before, after } from 'node:test'
import assert from 'node:assert/strict'
import { createServer, type Server } from 'node:http'
import type { AddressInfo } from 'node:net'
import worker from './index.ts'

let server: Server
let origin: string

before(async () => {
	server = createServer((req, res) => {
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
				res.writeHead(303, { location: '/done' })
				return res.end()
			case '/done':
				res.writeHead(200, { 'content-type': 'text/plain' })
				return res.end(req.method)
		}
		res.writeHead(404)
		res.end()
	})
	await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve))
	origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

after(() => server.close())

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

test('links resolve against the URL the redirects end at', async () => {
	const res = await proxied(`${origin}/old/style.css`)
	const css = await res.text()
	const expected = `https://proxy.test/?url=${encodeURIComponent(`${origin}/new/bg.png`)}`
	assert.ok(css.includes(expected), `bg.png must resolve under /new/, got: ${css}`)
})

test('a 303 after a POST is followed with a GET', async () => {
	const res = await proxied(`${origin}/form`, { method: 'POST', body: 'x=1' })
	const body = await res.text()
	assert.equal(res.status, 200, body)
	assert.equal(body, 'GET')
})
