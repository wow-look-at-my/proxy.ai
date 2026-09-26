import { createResponseHeaders, CORS_HEADERS } from './headers.ts'
import { rewriteHtml } from './rewrite-html.ts'
import { rewriteCss } from './rewrite-css.ts'

const LLMS_TXT = `# proxy.pazer.ai

> Cloudflare Worker web proxy. Fetches a target web page and rewrites its links, CSS url() references, and form actions so they continue to route back through the proxy. Every response is decorated with permissive CORS headers so cross-origin browser JavaScript can read the result.

## Usage

Pass a URL-encoded target URL as the \`?url=\` query parameter:

    https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com

The proxy follows up to 20 redirects itself and returns the final page. An Authorization header follows a redirect to the same host. To let it follow a redirect to another host, list the hosts in an \`x-proxy-redirect-hosts\` request header (comma-separated, or \`*\`). Without that, a redirect that would carry it to another host is answered with 400 and the name of the host.

    curl -H "Authorization: token TOKEN" -H "x-proxy-redirect-hosts: codeload.github.com" \\
      "https://proxy.pazer.ai/?url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO%2Farchive%2Frefs%2Fheads%2Fmaster.zip"

A browser address bar cannot set headers or a method. Query parameters do the same job: \`method=POST\`, \`body=...\`, and \`header=Name: Value\` (repeat it for several headers, URL-encoded). A query header replaces a request header of the same name. A secret in a URL lands in browser history and server logs.

    https://proxy.pazer.ai/?url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO%2Farchive%2Frefs%2Fheads%2Fmaster.zip&header=Authorization%3A%20token%20TOKEN&header=x-proxy-redirect-hosts%3A%20codeload.github.com

HTML and CSS responses are rewritten so their links keep routing through the proxy, relative to the URL where the redirects end. JavaScript is linked directly to the origin and is not proxied, to avoid breaking scripts.

## What this is not

- Not a forward/HTTP proxy: it cannot be used as a browser/OS proxy setting, an \`HTTP_PROXY\` value, or a \`curl -x\` target. It does not implement HTTP CONNECT tunneling.
- Not a SOCKS5 or Shadowsocks proxy: it does not implement any tunneling protocol.
`

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308])
const MAX_REDIRECTS = 20

// The client lists the hosts a redirect may carry its Authorization header to.
const REDIRECT_HOSTS_HEADER = 'x-proxy-redirect-hosts'

// These are for the proxy, not the origin. fetch frames its own body.
const HOP_HEADERS = ['host', 'content-length', 'transfer-encoding', 'connection', 'keep-alive', 'expect', 'te', 'upgrade', REDIRECT_HOSTS_HEADER]
// A request that loses its body on a redirect loses these with it.
const BODY_HEADERS = ['content-type', 'content-encoding', 'content-language', 'content-location']

export default {
  async fetch(request: Request): Promise<Response> {
    if (request.method === 'OPTIONS') {
      return new Response(null, { status: 200, headers: CORS_HEADERS })
    }

    const url = new URL(request.url)

    if (url.pathname === '/robots.txt') {
      return new Response('User-agent: *\nAllow: /', {
        headers: { 'content-type': 'text/plain', ...CORS_HEADERS },
      })
    }

    if (url.pathname === '/llms.txt') {
      return new Response(LLMS_TXT, {
        headers: { 'content-type': 'text/plain; charset=utf-8', ...CORS_HEADERS },
      })
    }

    const targetUrl = url.searchParams.get('url')

    if (!targetUrl) {
      return new Response(
        'Web proxy. Pass a URL-encoded target as ?url=\n\n' +
        'Example: https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com\n\n' +
        'Optional: &method=POST &body=... &header=Name%3A%20Value (repeatable). See /llms.txt',
        { status: 200, headers: { 'content-type': 'text/plain', ...CORS_HEADERS } },
      )
    }

    let target: URL
    try {
      target = new URL(targetUrl)
    } catch {
      return textResponse('Invalid URL', 400)
    }

    if (target.hostname === url.hostname) {
      return textResponse('Cannot proxy self', 400)
    }

    // A browser address bar cannot set headers or a method. The query string
    // can. A query header replaces a request header, the user agent included.
    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.set('user-agent', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0')
    for (const header of url.searchParams.getAll('header')) {
      const colon = header.indexOf(':')
      try {
        if (colon < 1) throw new TypeError('expected Name: Value')
        proxyHeaders.set(header.slice(0, colon).trim(), header.slice(colon + 1).trim())
      } catch {
        return textResponse(`Invalid header in query: ${header}`, 400)
      }
    }
    const method = (url.searchParams.get('method') ?? request.method).toUpperCase()
    if (!/^[A-Z]+$/.test(method)) {
      return textResponse(`Invalid method: ${method}`, 400)
    }

    const redirectHosts = new Set(
      (proxyHeaders.get(REDIRECT_HOSTS_HEADER) ?? '').toLowerCase().split(',').map(h => h.trim()).filter(Boolean),
    )

    try {
      for (const name of HOP_HEADERS) proxyHeaders.delete(name)
      // Ask the origin for bytes, not a compressed stream. A compressor holds
      // small writes back until it has a block worth emitting, which turns a
      // token-by-token event stream into one lump at the end. The client asked
      // this proxy for an encoding, not the origin, and createResponseHeaders
      // drops content-encoding anyway.
      proxyHeaders.set('accept-encoding', 'identity')

      // The body is buffered so a 307 or 308 can send it a second time.
      let hopMethod = method
      let body: BodyInit | undefined = await requestBody(request, url, method)

      // The proxy follows the redirects itself, so each hop gets the same
      // checks as the first request. Links in the reply resolve against the
      // URL where the chain ends, not the URL in ?url=.
      let current = target
      let response: Response
      for (let hops = 0; ; hops++) {
        response = await fetch(current, { method: hopMethod, headers: proxyHeaders, body, redirect: 'manual' })
        const location = response.headers.get('location')
        if (!REDIRECT_STATUSES.has(response.status) || !location) break
        if (hops >= MAX_REDIRECTS) throw new Error(`Too many redirects (${MAX_REDIRECTS})`)
        await response.body?.cancel()

        const next = new URL(location, current)
        if (next.protocol !== 'http:' && next.protocol !== 'https:') {
          throw new Error(`Redirect to unsupported scheme: ${next.protocol}`)
        }
        if (next.hostname === url.hostname) {
          return textResponse('Cannot proxy self', 400)
        }
        if (
          next.hostname !== current.hostname && proxyHeaders.has('authorization')
          && !redirectHosts.has('*') && !redirectHosts.has(next.hostname)
        ) {
          return textResponse(
            `Redirect to ${next.hostname} would carry the Authorization header. ` +
            `Allow it with ${REDIRECT_HOSTS_HEADER}: ${next.hostname}`,
            400,
          )
        }

        // A 303 turns the request into a GET. So does a 301 or 302 on a POST.
        const toGet = response.status === 303
          ? hopMethod !== 'GET' && hopMethod !== 'HEAD'
          : (response.status === 301 || response.status === 302) && hopMethod === 'POST'
        if (toGet) {
          hopMethod = 'GET'
          body = undefined
          for (const name of BODY_HEADERS) proxyHeaders.delete(name)
        }

        current = next
      }

      const init = {
        status: response.status,
        statusText: response.statusText,
        headers: createResponseHeaders(response.headers),
      }
      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('text/html')) {
        return new Response(rewriteHtml(response, current, url.origin).body, init)
      }

      if (contentType.includes('text/css')) {
        return new Response(rewriteCss(await response.text(), current, url.origin), init)
      }

      return new Response(response.body, init)
    } catch (error) {
      return textResponse(`Proxy error: ${(error as Error).message}`, 500)
    }
  },
}

// The text can echo client input or an origin's header. A fixed type and
// nosniff keep a browser from reading it as HTML on the proxy's origin.
function textResponse(text: string, status: number): Response {
  return new Response(text, {
    status,
    headers: { 'content-type': 'text/plain; charset=utf-8', 'x-content-type-options': 'nosniff', ...CORS_HEADERS },
  })
}

// A body query parameter wins over the request body. Neither is sent with
// a method that has no body.
async function requestBody(request: Request, url: URL, method: string): Promise<BodyInit | undefined> {
  if (method === 'GET' || method === 'HEAD') return undefined
  const fromQuery = url.searchParams.get('body')
  if (fromQuery !== null) return fromQuery
  if (request.method === 'GET' || request.method === 'HEAD') return undefined
  return request.arrayBuffer()
}
