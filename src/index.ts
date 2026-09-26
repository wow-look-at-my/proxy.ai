import { createResponseHeaders, CORS_HEADERS } from './headers'
import { rewriteHtml } from './rewrite-html'
import { rewriteCss } from './rewrite-css'

const LLMS_TXT = `# proxy.pazer.ai

> Cloudflare Worker web proxy. Fetches a target web page and rewrites its links, CSS url() references, and form actions so they continue to route back through the proxy. Every response is decorated with permissive CORS headers so cross-origin browser JavaScript can read the result.

## Usage

Pass a URL-encoded target URL as the \`?url=\` query parameter:

    https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com

HTML and CSS responses are rewritten so their links keep routing through the proxy. JavaScript is linked directly to the origin and is not proxied, to avoid breaking scripts.

## What this is not

- Not a forward/HTTP proxy: it cannot be used as a browser/OS proxy setting, an \`HTTP_PROXY\` value, or a \`curl -x\` target. It does not implement HTTP CONNECT tunneling.
- Not a SOCKS5 or Shadowsocks proxy: it does not implement any tunneling protocol.
`

async function resolveHostname(hostname: string): Promise<string | null> {
  const resp = await fetch(
    `https://cloudflare-dns.com/dns-query?name=${encodeURIComponent(hostname)}&type=A`,
    { headers: { 'Accept': 'application/dns-json' } },
  )
  const data: { Answer?: { type: number; data: string }[] } = await resp.json()
  if (data.Answer) {
    const aRecord = data.Answer.find(r => r.type === 1)
    if (aRecord) return aRecord.data
  }
  return null
}

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

      const response = await fetch(targetUrl, {
        method: request.method,
        headers: proxyHeaders,
        body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined,
        redirect: 'manual',
      })

      if (response.status >= 300 && response.status < 400) {
        const location = response.headers.get('location')
        if (location) {
          try {
            const redirectUrl = new URL(location)
            const ip = await resolveHostname(redirectUrl.hostname)
            if (ip) {
              const originalHost = redirectUrl.hostname
              redirectUrl.hostname = ip
              const headers = createResponseHeaders(response.headers)
              headers.set('location', redirectUrl.toString())
              headers.set('x-proxy-host', originalHost)
              return new Response(null, {
                status: response.status,
                statusText: response.statusText,
                headers,
              })
            }
          } catch {
            // DNS resolution failed, fall through to stream content
          }

          const finalResponse = await fetch(location, {
            method: request.method,
            headers: proxyHeaders,
            redirect: 'follow',
          })
          return new Response(finalResponse.body, {
            status: finalResponse.status,
            statusText: finalResponse.statusText,
            headers: createResponseHeaders(finalResponse.headers),
          })
        }
      }

      const contentType = response.headers.get('content-type') || ''

      if (contentType.includes('text/html')) {
        const rewrittenResponse = rewriteHtml(response, target, url.origin)
        return new Response(rewrittenResponse.body, {
          status: response.status,
          statusText: response.statusText,
          headers: createResponseHeaders(response.headers),
        })
      }

      if (contentType.includes('text/css')) {
        const css = await response.text()
        const rewrittenCss = rewriteCss(css, target, url.origin, null)
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
