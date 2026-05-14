import { createResponseHeaders, CORS_HEADERS } from './headers'
import { rewriteHtml } from './rewrite-html'
import { rewriteCss } from './rewrite-css'

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
        headers: { 'content-type': 'text/plain' },
      })
    }

    let targetUrl = url.searchParams.get('url')

    if (!targetUrl) {
      const fullMatch = url.pathname.match(/^\/(https?:\/\/.+)/)
      const collapsedMatch = url.pathname.match(/^\/(https?:\/.+)/)
      if (fullMatch) {
        targetUrl = fullMatch[1] + url.search
      } else if (collapsedMatch) {
        targetUrl = collapsedMatch[1].replace(/^(https?:\/)/, '$1/') + url.search
      } else if (/^\/[a-zA-Z0-9-]+\.[a-zA-Z]/.test(url.pathname)) {
        targetUrl = 'https:/' + url.pathname + url.search
      }
    }

    if (!targetUrl) {
      return new Response(
        'Web proxy. Pass a URL-encoded target as ?url=\n\n' +
        'Example: https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com',
        { status: 200, headers: { 'content-type': 'text/plain' } },
      )
    }

    let target: URL
    try {
      target = new URL(targetUrl)
    } catch {
      return new Response('Invalid URL', { status: 400 })
    }

    if (target.hostname === url.hostname) {
      return new Response('Cannot proxy self', { status: 400 })
    }

    try {
      const proxyHeaders = new Headers(request.headers)
      proxyHeaders.delete('host')
      proxyHeaders.set('user-agent', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0')

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
      return new Response(`Proxy error: ${(error as Error).message}`, { status: 500 })
    }
  },
}
