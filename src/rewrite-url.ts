export function rewriteUrl(url: string, targetUrl: URL, proxyOrigin: string, baseHref: string | null = null): string {
  if (!url || url.startsWith('data:') || url.startsWith('javascript:') || url.startsWith('mailto:') || url.startsWith('#')) {
    return url
  }

  let absoluteUrl
  try {
    if (url.startsWith('//')) {
      absoluteUrl = `${targetUrl.protocol}${url}`
    } else if (url.startsWith('/')) {
      absoluteUrl = `${targetUrl.protocol}//${targetUrl.host}${url}`
    } else if (url.startsWith('http')) {
      absoluteUrl = url
    } else {
      let basePath
      if (baseHref) {
        if (baseHref.startsWith('/')) {
          basePath = baseHref
        } else {
          const currentDir = targetUrl.pathname.endsWith('/')
            ? targetUrl.pathname
            : targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1)
          basePath = currentDir + baseHref
        }
      } else {
        basePath = targetUrl.pathname.endsWith('/')
          ? targetUrl.pathname
          : targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1)
      }

      if (!basePath.endsWith('/')) {
        basePath += '/'
      }

      absoluteUrl = `${targetUrl.protocol}//${targetUrl.host}${basePath}${url}`
    }

    if (absoluteUrl.match(/\.js(\?.*)?$/i)) {
      return absoluteUrl
    }

    return `${proxyOrigin}/?url=${encodeURIComponent(absoluteUrl)}`
  } catch {
    return url
  }
}
