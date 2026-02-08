export function rewriteUrl(url, targetUrl, proxyOrigin, baseHref = null) {
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
      // Relative URL - resolve against base href if available, otherwise current page
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

    // For JavaScript files, return the absolute URL to original host instead of proxying
    if (absoluteUrl.match(/\.js(\?.*)?$/i)) {
      return absoluteUrl
    }

    return `${proxyOrigin}/?url=${encodeURIComponent(absoluteUrl)}`
  } catch {
    return url
  }
}
