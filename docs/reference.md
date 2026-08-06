# anyuser-drops technical reference

The main [README](../README.md) is the user guide. This document contains the
details needed to operate, adapt, or contribute to the project.

## What gets created

- **Cloudflare Worker:** accepts uploads, returns links, serves files, and
  handles removal.
- **R2 bucket:** stores the file bytes privately.
- **Access key:** the Worker secret named `UPLOAD_TOKEN` and the matching value
  saved by permitted clients.
- **Public address:** either a generated `workers.dev` address or an optional
  custom domain managed by the same Cloudflare account.

```text
file on a computer
       │ share + access key
       ▼
Cloudflare Worker ──────► private R2 storage
       ▲                         │
       └──── public link ────────┘
                    │
                 browser
```

This repository is named `cf-anyuser-drops` because the service implementation
is Cloudflare-specific. The client is configurable because the service address
and key are not hard-coded.

## Access model

The service has two bearer capabilities:

- the instance key authorizes upload and removal of known drop IDs;
- each generated link authorizes public download of one object.

There are no separate accounts, per-user keys, public index, or private
download mode. Everyone holding the instance key shares the same upload and
removal authority. Anyone holding a file link can download that file.

## Command reference

```text
anyuser-drops share <file>    upload a file and print its link
anyuser-drops <file>          shorter form of share
anyuser-drops rm              confirm removal of the last shared file
anyuser-drops rm <link>       remove the file at a generated link
anyuser-drops -q …            suppress friendly progress messages
anyuser-drops --help          show built-in help
```

`lynx-drop` and `lynx-drops` are compatibility aliases. They run the same
client and use the same configuration and recent-drop record.

Upload links are written to stdout. Progress and diagnostics are written to
stderr. Successful `rm` is silent on stdout, and failures return nonzero.
`rm <link>` is non-interactive. Bare `rm` reads the most recent successful
share from the local record, displays its filename, and requires `y` or `yes`
before removal.

## Configuration

The client checks these paths:

- Windows: `%APPDATA%\anyuser-drops\config.json`
- when `XDG_CONFIG_HOME` is set: `$XDG_CONFIG_HOME/anyuser-drops/config.json`
- otherwise: `~/.config/anyuser-drops/config.json`

```json
{
  "endpoint": "https://drops.example/api/drop",
  "token": "private-instance-key"
}
```

Environment variables override the file:

```text
ANYUSER_DROPS_TOKEN
ANYUSER_DROPS_ENDPOINT
ANYUSER_DROPS_CONFIG
```

The previous `LYNX_DROPS_TOKEN`, `LYNX_DROPS_ENDPOINT`, and `lynx-drops`
configuration directory are supported for compatibility.

After each successful upload, the client writes `last-drop.json` beside the
active configuration file. It contains the last public URL and filename so
bare `rm` can offer to remove it. The record is deleted after that URL is
successfully removed. It is not an upload history.

## Custom domain

During setup, a domain or subdomain already managed by the authenticated
Cloudflare account can be supplied. Wrangler creates the Worker route and
Cloudflare manages its certificate. Leaving the answer blank uses the
`workers.dev` address. The domain changes the public address, not permissions.

## Manual deployment

The client is portable JavaScript and should run on FreeBSD when Node.js 18+
and `curl` are available. Deployment uses [Cloudflare Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/),
whose officially supported systems are macOS 13.5+, Windows 11, and Linux
distributions with glibc 2.35. `setup.sh` checks whether Wrangler can start and
fails before login when it cannot. A service deployed from a supported system
can still be used from FreeBSD.

```sh
git clone https://github.com/lynxnathan/cf-anyuser-drops.git
cd cf-anyuser-drops
npm ci
cp wrangler.example.jsonc wrangler.jsonc
```

Manual deployment requires Node.js 22+ because that is the minimum for the
Wrangler version used by this repository. The standalone client remains
compatible with Node.js 18+.

Edit `wrangler.jsonc`, then run:

```sh
npx wrangler login
npx wrangler r2 bucket create anyuser-drops-files
npx wrangler deploy
npx wrangler secret put UPLOAD_TOKEN
npm link
```

Create the client configuration with the deployed `/api/drop` address and the
same secret. The real `wrangler.jsonc` is ignored so local deployment details
are not accidentally committed.

## End-to-end contract

`npm run test:e2e` uses the configured live service to:

1. create a unique temporary file;
2. share it through the real client and Worker;
3. immediately download it and compare every byte;
4. remove it through `rm`;
5. confirm that the same URL returns HTTP 404;
6. attempt cleanup if an intermediate assertion fails.

This verifies the file lifecycle and CLI output contracts. It does not prove
that a public link is private or that usage stays within free allocations.

## Troubleshooting

### Cloudflare cannot create the bucket

Open the R2 section of the Cloudflare dashboard and finish its signup steps,
then run setup again. Confirm that Wrangler selected the intended account.

### `No upload token found`

The configuration file is missing or unreadable. Check its location and
contents, or set `ANYUSER_DROPS_TOKEN`.

### `Unauthorized`

The client key does not match the Worker's `UPLOAD_TOKEN` secret. Rotate the
Worker secret and distribute the replacement key to permitted users.

### `Drop not found`

The object may already have been removed, or the link may belong to another
deployment.

## Development

```sh
npm ci
npm run check
npm test
npm run test:fuzz # deterministic parser and filename string fuzzing
npm run test:e2e  # requires a configured live service
```
