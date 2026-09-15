import { access, rm } from 'node:fs/promises'

const output = new URL('../dist/', import.meta.url)
await access(new URL('index.html', output))

// Wrangler configures the SPA fallback for Workers Static Assets.
// The Netlify catch-all must not rewrite JavaScript, icons or crawler files.
await rm(new URL('_redirects', output), { force: true })

console.log('Cloudflare Workers output ready in dist/ (SPA fallback configured in wrangler.toml).')
