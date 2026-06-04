# web proxy

Cloudflare Worker web proxy. Fetches and rewrites web pages so all links route back through the proxy.

## Usage

Pass a URL-encoded target URL as the `?url=` query parameter:

```
https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com
```

The proxy will fetch the page and rewrite all HTML links, CSS `url()` references, and form actions to route through the proxy.

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
