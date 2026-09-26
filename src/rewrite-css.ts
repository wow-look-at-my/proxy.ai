import { rewriteUrl } from './rewrite-url.ts'

export function rewriteCss(css: string, targetUrl: URL, proxyOrigin: string, baseHref: string | null = null): string {
  let rewritten = css

  rewritten = rewritten.replace(
    /url\s*\(\s*["']?([^"')\s]+)["']?\s*\)/gi,
    (_match, url: string) => `url("${rewriteUrl(url, targetUrl, proxyOrigin, baseHref)}")`
  )

  rewritten = rewritten.replace(
    /@import\s+["']([^"']+)["']/gi,
    (_match, url: string) => `@import "${rewriteUrl(url, targetUrl, proxyOrigin, baseHref)}"`
  )

  rewritten = rewritten.replace(
    /@import\s+url\s*\(\s*["']?([^"')\s]+)["']?\s*\)/gi,
    (_match, url: string) => `@import url("${rewriteUrl(url, targetUrl, proxyOrigin, baseHref)}")`
  )

  return rewritten
}
