import { rewriteUrl } from './rewrite-url.js'

export function rewriteCss(css, targetUrl, proxyOrigin, baseHref = null) {
  let rewritten = css

  // CSS url() functions
  rewritten = rewritten.replace(
    /url\s*\(\s*["']?([^"')\s]+)["']?\s*\)/gi,
    (match, url) => `url("${rewriteUrl(url, targetUrl, proxyOrigin, baseHref)}")`
  )

  // CSS @import statements
  rewritten = rewritten.replace(
    /@import\s+["']([^"']+)["']/gi,
    (match, url) => `@import "${rewriteUrl(url, targetUrl, proxyOrigin, baseHref)}"`
  )

  // CSS @import url() statements
  rewritten = rewritten.replace(
    /@import\s+url\s*\(\s*["']?([^"')\s]+)["']?\s*\)/gi,
    (match, url) => `@import url("${rewriteUrl(url, targetUrl, proxyOrigin, baseHref)}")`
  )

  return rewritten
}
