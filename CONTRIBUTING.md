# Contributing

Issues and focused pull requests are welcome. Before submitting a change:

```sh
npm install
npm run check
npm test
```

When a change affects the Worker, storage lifecycle, authentication, or CLI
I/O contract, also run `npm run test:e2e` against a disposable or personal
deployment. Never place its token or generated URLs in an issue or commit.

Never commit a real `wrangler.jsonc`, upload token, Cloudflare credential, or
private drop URL. Use `wrangler.example.jsonc` and synthetic values in tests and
documentation.

Keep the CLI's Unix contract stable: result data belongs on stdout, progress
and diagnostics belong on stderr, successful `rm` is silent on stdout, and
failures return nonzero.
