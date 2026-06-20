# web proxy

Cloudflare Worker web proxy. Fetches and rewrites web pages so all links route back through the proxy, and decorates every response with permissive CORS headers so cross-origin browser JavaScript can read the result.

## Usage

Pass the target URL either directly in the path, or as a URL-encoded `?url=` query parameter:

```
https://proxy.pazer.ai/https://example.com
https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com
```

Both forms work for any HTTP method (GET, POST, etc.). The proxy fetches the target and, for HTML/CSS responses, rewrites all HTML links, CSS `url()` references, and form actions to route through the proxy. The `?url=` form is what the rewriter emits, so rewritten pages keep working; the path form is convenient for direct API calls (e.g. a CORS-less token endpoint).

Every proxied response carries `Access-Control-Allow-Origin: *`, so it can be read from cross-origin browser code.

JavaScript files are **not** proxied -- they're linked directly to the origin to avoid breaking scripts.

## What this is / isn't

This is an HTTP **web proxy** (a URL-rewriting proxy): you give it a target URL and it returns that page with links rewritten to keep routing through the proxy. It is **not**:

- a **forward / HTTP proxy** -- it can't be set as a browser/OS proxy, an `HTTP_PROXY` value, or a `curl -x` target. It does not implement HTTP `CONNECT` tunneling (which Cloudflare Workers don't support for inbound requests anyway).
- a **SOCKS5 / Shadowsocks proxy** -- it implements no tunneling protocol.

For a forward or SOCKS/Shadowsocks proxy you'd need a different setup (e.g. Squid or tinyproxy, or shadowsocks-libev, running on a VPS).

A machine-readable summary is served at [`/llms.txt`](https://proxy.pazer.ai/llms.txt).

## Development

```sh
npm install
npm run dev
```

## Deploy

```sh
npm run deploy
```

## Project structure

```
src/
  index.ts          - Entry point, request routing
  headers.ts        - Response header filtering and CORS
  rewrite-url.ts    - Resolves and rewrites URLs to proxy format
  rewrite-html.ts   - HTML rewriting via Cloudflare HTMLRewriter
  rewrite-css.ts    - CSS url() and @import rewriting
wrangler.toml       - Cloudflare Worker config
tsconfig.json       - TypeScript configuration
```
