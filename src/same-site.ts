// A credential may follow a redirect inside one site and must not leave it.
export function credentialsMayFollow(from: URL, to: URL): boolean {
  if (from.protocol === 'https:' && to.protocol !== 'https:') return false
  return site(from.hostname) === site(to.hostname)
}

// The domain directly under the top-level domain: github.com for codeload.github.com.
function site(hostname: string): string {
  return hostname.split('.').slice(-2).join('.')
}
