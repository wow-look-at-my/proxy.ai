import { rewriteUrl } from './rewrite-url.ts'
import { rewriteCss } from './rewrite-css.ts'

export function rewriteHtml(response: Response, targetUrl: URL, proxyOrigin: string): Response {
  let baseHref: string | null = null

  return new HTMLRewriter()
    .on('base[href]', {
      element(element) {
        if (!baseHref) {
          baseHref = element.getAttribute('href')
        }
        element.remove()
      }
    })
    .on('base', {
      element(element) {
        element.remove()
      }
    })
    .on('[src]', {
      element(element) {
        const src = element.getAttribute('src')
        if (src) {
          element.setAttribute('src', rewriteUrl(src, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    .on('[href]', {
      element(element) {
        const href = element.getAttribute('href')
        if (href) {
          element.setAttribute('href', rewriteUrl(href, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    .on('[action]', {
      element(element) {
        const action = element.getAttribute('action')
        if (action) {
          element.setAttribute('action', rewriteUrl(action, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    .on('style', {
      text(text) {
        const rewrittenCss = rewriteCss(text.text, targetUrl, proxyOrigin, baseHref)
        text.replace(rewrittenCss)
      }
    })
    .on('[style]', {
      element(element) {
        const style = element.getAttribute('style')
        if (style) {
          element.setAttribute('style', rewriteCss(style, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    .on('meta[http-equiv="refresh"]', {
      element(element) {
        const content = element.getAttribute('content')
        if (content && content.includes('url=')) {
          const newContent = content.replace(
            /url=([^;]+)/i,
            (_match, url: string) => `url=${rewriteUrl(url.trim(), targetUrl, proxyOrigin, baseHref)}`
          )
          element.setAttribute('content', newContent)
        }
      }
    })
    .transform(response)
}
