# proxy

Cloudflare Worker web proxy. Fetches and rewrites web pages so all links route back through the proxy.

## Usage

Pass a URL-encoded target URL as the `?url=` query parameter:

```
https://proxy.pazer.ai/?url=https%3A%2F%2Fexample.com
```

The proxy will fetch the page and rewrite all HTML links, CSS `url()` references, and form actions to route through the proxy.

JavaScript files are **not** proxied -- they're linked directly to the origin to avoid breaking scripts.

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
  index.js          - Entry point, request routing
  headers.js        - Response header filtering and CORS
  rewrite-url.js    - Resolves and rewrites URLs to proxy format
  rewrite-html.js   - HTML rewriting via Cloudflare HTMLRewriter
  rewrite-css.js    - CSS url() and @import rewriting
wrangler.toml       - Cloudflare Worker config
```
