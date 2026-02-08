// Cloudflare Worker Web Proxy with HTMLRewriter
// Usage: https://proxy.pazer.ai/https://example.com

addEventListener('fetch', event => {
  event.respondWith(handleRequest(event.request))
})

async function handleRequest(request) {
  const url = new URL(request.url)
  
  // Handle robots.txt requests - disallow crawling but don't block access
  if (url.pathname === '/robots.txt') {
    return new Response('User-agent: *\nAllow: /', {
      headers: { 'content-type': 'text/plain' }
    })
  }
  
  let targetUrl = null
  
  // First, check query parameters for URLs
  for (const [key, value] of url.searchParams) {
    if (value && (value.startsWith('http://') || value.startsWith('https://'))) {
      targetUrl = decodeURIComponent(value)
      break
    }
  }
  
  // If no URL found in query params, check the path
  if (!targetUrl) {
    const targetPath = url.pathname.substring(1)
    if (!targetPath) {
      return new Response('Usage:\n\nhttps://proxy.pazer.ai/https://example.com\nor\nhttps://proxy.pazer.ai/example.com\nor\nhttps://proxy.pazer.ai/?url=example.com', { status: 400 })
    }
    
    targetUrl = decodeURIComponent(targetPath)
    
    // If the URL doesn't start with http:// or https://, assume https://
    if (!targetUrl.startsWith('http://') && !targetUrl.startsWith('https://')) {
      targetUrl = 'https://' + targetUrl
    }
  }
  
  // Validate target URL
  let target
  try {
    target = new URL(targetUrl)
  } catch {
    return new Response('Invalid URL', { status: 400 })
  }
  
  // Prevent proxying ourselves
  if (target.hostname === url.hostname) {
    return new Response('Cannot proxy self', { status: 400 })
  }
  
  try {
    // Forward the request with original headers (excluding host)
    const proxyHeaders = new Headers(request.headers)
    proxyHeaders.delete('host')
    proxyHeaders.set('user-agent', 'Mozilla/5.0 (X11; Ubuntu; Linux x86_64; rv:139.0) Gecko/20100101 Firefox/139.0')
    
    const response = await fetch(targetUrl, {
      method: request.method,
      headers: proxyHeaders,
      body: request.method !== 'GET' && request.method !== 'HEAD' ? request.body : undefined
    })
    
    const contentType = response.headers.get('content-type') || ''
    
    // Rewrite HTML content
    if (contentType.includes('text/html')) {
      const rewrittenResponse = rewriteHtml(response, target, url.origin)
      
      return new Response(rewrittenResponse.body, {
        status: response.status,
        statusText: response.statusText,
        headers: createResponseHeaders(response.headers)
      })
    }
    // Rewrite CSS content
    else if (contentType.includes('text/css')) {
      const css = await response.text()
      const rewrittenCss = rewriteCss(css, target, url.origin, null)
      
      return new Response(rewrittenCss, {
        status: response.status,
        statusText: response.statusText,
        headers: createResponseHeaders(response.headers)
      })
    }
    // For other content, just proxy as-is
    else {
      return new Response(response.body, {
        status: response.status,
        statusText: response.statusText,
        headers: createResponseHeaders(response.headers)
      })
    }
  } catch (error) {
    return new Response(`Proxy error: ${error.message}`, { status: 500 })
  }
}

function createResponseHeaders(originalHeaders) {
  const headers = new Headers()
  
  // Copy most headers but filter out some problematic ones
  const skipHeaders = new Set([
    'content-encoding',
    'content-security-policy',
    'x-frame-options',
    'strict-transport-security'
  ])
  
  for (const [key, value] of originalHeaders) {
    if (!skipHeaders.has(key.toLowerCase())) {
      headers.set(key, value)
    }
  }
  
  // Add CORS headers
  headers.set('access-control-allow-origin', '*')
  headers.set('access-control-allow-methods', 'GET, HEAD, OPTIONS')
  headers.set('access-control-allow-headers', '*')
  
  return headers
}

function rewriteUrl(url, targetUrl, proxyOrigin, baseHref = null) {
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
        // Use the base href path
        if (baseHref.startsWith('/')) {
          basePath = baseHref
        } else {
          // Base href is relative to current page
          const currentDir = targetUrl.pathname.endsWith('/') 
            ? targetUrl.pathname 
            : targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1)
          basePath = currentDir + baseHref
        }
      } else {
        // Fallback to current page directory
        basePath = targetUrl.pathname.endsWith('/') 
          ? targetUrl.pathname 
          : targetUrl.pathname.substring(0, targetUrl.pathname.lastIndexOf('/') + 1)
      }
      
      // Ensure basePath ends with /
      if (!basePath.endsWith('/')) {
        basePath += '/'
      }
      
      absoluteUrl = `${targetUrl.protocol}//${targetUrl.host}${basePath}${url}`
    }
    
    // For JavaScript files, return the absolute URL to original host instead of proxying
    if (absoluteUrl.match(/\.js(\?.*)?$/i)) {
      return absoluteUrl
    }
    
    return `${proxyOrigin}/${encodeURIComponent(absoluteUrl)}`
  } catch {
    return url
  }
}

function rewriteHtml(response, targetUrl, proxyOrigin) {
  let baseHref = null
  
  return new HTMLRewriter()
    // Capture base href before removing base tags
    .on('base[href]', {
      element(element) {
        if (!baseHref) {
          baseHref = element.getAttribute('href')
        }
        element.remove()
      }
    })
    // Remove any remaining base tags
    .on('base', {
      element(element) {
        element.remove()
      }
    })
    // Rewrite src attributes
    .on('[src]', {
      element(element) {
        const src = element.getAttribute('src')
        if (src) {
          element.setAttribute('src', rewriteUrl(src, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    // Rewrite href attributes
    .on('[href]', {
      element(element) {
        const href = element.getAttribute('href')
        if (href) {
          element.setAttribute('href', rewriteUrl(href, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    // Rewrite action attributes
    .on('[action]', {
      element(element) {
        const action = element.getAttribute('action')
        if (action) {
          element.setAttribute('action', rewriteUrl(action, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    // Rewrite style elements
    .on('style', {
      text(text) {
        const rewrittenCss = rewriteCss(text.text, targetUrl, proxyOrigin, baseHref)
        text.replace(rewrittenCss)
      }
    })
    // Rewrite inline style attributes
    .on('[style]', {
      element(element) {
        const style = element.getAttribute('style')
        if (style) {
          element.setAttribute('style', rewriteCss(style, targetUrl, proxyOrigin, baseHref))
        }
      }
    })
    // Handle meta refresh redirects
    .on('meta[http-equiv="refresh"]', {
      element(element) {
        const content = element.getAttribute('content')
        if (content && content.includes('url=')) {
          const newContent = content.replace(
            /url=([^;]+)/i,
            (match, url) => `url=${rewriteUrl(url.trim(), targetUrl, proxyOrigin, baseHref)}`
          )
          element.setAttribute('content', newContent)
        }
      }
    })
    .transform(response)
}

function rewriteCss(css, targetUrl, proxyOrigin, baseHref = null) {
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

// Handle CORS preflight requests
addEventListener('fetch', event => {
  if (event.request.method === 'OPTIONS') {
    event.respondWith(new Response(null, {
      status: 200,
      headers: {
        'access-control-allow-origin': '*',
        'access-control-allow-methods': 'GET, HEAD, OPTIONS',
        'access-control-allow-headers': '*'
      }
    }))
  }
})
