# web proxy

Cloudflare Worker web proxy. Fetches and rewrites web pages so all links route back through the proxy, and decorates every response with permissive CORS headers so cross-origin browser JavaScript can read the result.

## Usage

Pass a URL-encoded target URL as the `?url=` query parameter:

```
https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com
```

The proxy fetches the page and rewrites all HTML links, CSS `url()` references, and form actions to route through the proxy. Every proxied response carries `Access-Control-Allow-Origin: *`, so it can be read from cross-origin browser code.

The proxy follows up to 20 redirects itself and returns the final page, never a 3xx. Relative links resolve against the URL where the redirects end. An `Authorization` header follows a redirect to the same host only. To let it follow a redirect to another host, list the hosts in an `x-proxy-redirect-hosts` request header (comma-separated, or `*`). Otherwise the proxy answers 400 and names the host.

```sh
curl -H "Authorization: token $TOKEN" -H "x-proxy-redirect-hosts: codeload.github.com" \
  "https://proxy.pazer.ai/?url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO%2Farchive%2Frefs%2Fheads%2Fmaster.zip"
```

From a browser address bar, use query parameters instead: `method=POST`, `body=...`, and `header=Name: Value` (repeatable, URL-encoded). A query header replaces a request header of the same name. A secret in a URL lands in browser history and server logs.

```
https://proxy.pazer.ai/?url=https%3A%2F%2Fgithub.com%2FOWNER%2FREPO%2Farchive%2Frefs%2Fheads%2Fmaster.zip&header=Authorization%3A%20token%20TOKEN&header=x-proxy-redirect-hosts%3A%20codeload.github.com
```

JavaScript files are **not** proxied -- they're linked directly to the origin to avoid breaking scripts.

## What this is / isn't

This is an HTTP **web proxy** (a URL-rewriting proxy): you give it a target URL and it returns that page with links rewritten to keep routing through the proxy. It is **not**:

- a **forward / HTTP proxy** -- it can't be set as a browser/OS proxy, an `HTTP_PROXY` value, or a `curl -x` target. It does not implement HTTP `CONNECT` tunneling (which Cloudflare Workers don't support for inbound requests anyway).
- a **SOCKS5 / Shadowsocks proxy** -- it implements no tunneling protocol.

For a forward or SOCKS/Shadowsocks proxy you'd need a different setup (e.g. Squid or tinyproxy, or shadowsocks-libev, running on a VPS).

A machine-readable summary is served at [`/llms.txt`](https://proxy.pazer.ai/llms.txt).

## Streaming

Server-sent events pass through as they arrive, so a proxied LLM chat shows
tokens as the model writes them. Two things make that work, and both are easy to
undo by accident:

- The proxy asks the origin for `accept-encoding: identity`. A compressor holds
  small writes back until it has a block to emit.
- A `text/event-stream` response goes out with `no-transform`, which is
  Cloudflare's documented switch for not compressing it on the way to the
  visitor.

`src/headers.test.ts` covers the second one. `src/redirect.test.ts` runs the worker against a local origin that redirects.

## Development

```sh
npm install
npm run dev
npm test         # node --test over src/*.test.ts
npm run typecheck
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
