import { createResponseHeaders, CORS_HEADERS } from './headers.ts'
import { rewriteHtml } from './rewrite-html.ts'
import { rewriteCss } from './rewrite-css.ts'

const LLMS_TXT = `# proxy.pazer.ai

> Cloudflare Worker web proxy. Fetches a target web page and rewrites its links, CSS url() references, and form actions so they continue to route back through the proxy. Every response is decorated with permissive CORS headers so cross-origin browser JavaScript can read the result.

## Usage

Pass a URL-encoded target URL as the \`?url=\` query parameter:

    https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com

The proxy follows redirects itself and returns the final page. HTML and CSS responses are rewritten so their links keep routing through the proxy, relative to the URL where the redirects end. JavaScript is linked directly to the origin and is not proxied, to avoid breaking scripts.

## What this is not

- Not a forward/HTTP proxy: it cannot be used as a browser/OS proxy setting, an \`HTTP_PROXY\` value, or a \`curl -x\` target. It does not implement HTTP CONNECT tunneling.
- Not a SOCKS5 or Shadowsocks proxy: it does not implement any tunneling protocol.
`

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
        'Example: https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com',
        { status: 200, headers: { 'content-type': 'text/plain', ...CORS_HEADERS } },
      )
    }

    let target: URL
    try {
      target = new URL(targetUrl)
    } catch {
      return new Response('Invalid URL', { status: 400, headers: { ...CORS_HEADERS } })
    }

    if (target.hostname === url.hostname) {
      return new Response('Cannot proxy self', { status: 400, headers: { ...CORS_HEADERS } })
    }

    try {
      const proxyHeaders = new Headers(request.headers)
      proxyHeaders.delete('host')
      proxyHeaders.set('user-agent', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0')
      // Ask the origin for bytes, not a compressed stream. A compressor holds
      // small writes back until it has a block worth emitting, which turns a
      // token-by-token event stream into one lump at the end. The client asked
      // this proxy for an encoding, not the origin, and createResponseHeaders
      // drops content-encoding anyway.
      proxyHeaders.set('accept-encoding', 'identity')

      // The proxy follows the redirects itself. Relative links in the reply
      // resolve against the URL where the chain ends, not the URL in ?url=.
      const response = await fetch(target, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'follow',
        // The Fetch spec requires duplex for a stream body. The Workers types omit it.
        duplex: 'half',
      } as RequestInit)
      const finalUrl = response.url ? new URL(response.url) : target

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('text/html')) {
        const rewrittenResponse = rewriteHtml(response, finalUrl, url.origin)
        return new Response(rewrittenResponse.body, {
          status: response.status,
          statusText: response.statusText,
          headers: createResponseHeaders(response.headers),
        })
      }

      if (contentType.includes('text/css')) {
        const css = await response.text()
        const rewrittenCss = rewriteCss(css, finalUrl, url.origin, null)
        return new Response(rewrittenCss, {
          status: response.status,
          statusText: response.statusText,
          headers: createResponseHeaders(response.headers),
        })
      }

      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: createResponseHeaders(response.headers),
      })
    } catch (error) {
      return new Response(`Proxy error: ${(error as Error).message}`, { status: 500, headers: { ...CORS_HEADERS } })
    }
  },
}
