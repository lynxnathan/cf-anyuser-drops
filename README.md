# anyuser-drops

Turn a file on your computer into a link you can send to someone.

```console
$ anyuser-drops share photo.png
✨ Sharing photo.png (1.4 MiB)…
🚀 Ready to share.
https://drops.example/d/…/photo.png
```

The link opens in any web browser. Remove it when it is no longer needed:

```console
$ anyuser-drops rm https://drops.example/d/…/photo.png
🧹 Removing https://drops.example/d/…/photo.png…
✨ Removed.
```

## Choose what you want to do

If you want your own file-sharing service, you need a
[Cloudflare account](https://dash.cloudflare.com/sign-up) with R2 enabled. You
control it and are responsible for its usage.

If someone has invited you to use theirs, you do not need a Cloudflare account.
Skip to [Use a service someone shared with you](#use-a-service-someone-shared-with-you).

## Set up your own

You need:

- a Cloudflare account with R2 enabled;
- [Node.js](https://nodejs.org/) 22 or newer;
- `curl` and a Unix-like shell.

Paste this command into the shell:

```sh
curl -fsSL https://raw.githubusercontent.com/lynxnathan/cf-anyuser-drops/main/setup.sh | sh
```

Follow the questions on screen. Press Enter when asked for a custom domain to
use the address supplied by Cloudflare.

The setup creates private storage for the files, puts a small web service in
front of it, makes a random access key, and installs the `anyuser-drops`
command. No domain purchase is required.

The client has no OS-specific binary of its own and should work anywhere
Node.js and `curl` work, including FreeBSD. Creating the Cloudflare service
also needs [Wrangler](https://developers.cloudflare.com/workers/wrangler/install-and-update/).
Cloudflare currently supports Wrangler on macOS 13.5+, Windows 11, and Linux
with glibc 2.35; the setup checks that Wrangler can actually start before
asking you to sign in. On FreeBSD, use the client there and run the one-time
deployment from a supported system.

> Piping a script into a shell means trusting that script. Download and read
> [`setup.sh`](./setup.sh) first when that is the better choice.

## Share a file

```sh
anyuser-drops share path/to/file
```

The shorter `anyuser-drops path/to/file` form works too.

The last line is the link. Quiet mode makes it easy to capture:

```sh
link=$(anyuser-drops -q share path/to/file)
printf '%s\n' "$link"
```

Quiet mode prints only the link. Progress and errors never mix with it.

## Remove a file

Remove the most recently shared file without finding or pasting its link:

```console
$ anyuser-drops rm
Remove your last shared file?
  photo.png
Are you sure? [y/N] y
✨ Removed.
```

The command remembers the last successful share on this computer. It shows the
filename and asks before using that remembered link.

You can still remove any known link directly:

```sh
anyuser-drops rm "$link"
```

Passing the link skips the question, which is useful in scripts. After removal,
the old link returns “not found.” Successful removal always prints nothing to
stdout; `-q` also hides progress messages.

## Three things to remember

1. **A file link is public.** Anyone who receives it can open it. Hard to guess
   does not mean private.
2. **The access key is private.** It allows uploads and removals. Treat it like
   a password.
3. **Files are limited to 25 MiB.** Larger files are rejected before upload.

## Can it cost $0?

Light use can stay inside Cloudflare's included free usage. Free does not mean
unlimited, and plans can change. The person responsible for the Cloudflare
account should check the official [Workers pricing](https://developers.cloudflare.com/workers/platform/pricing/)
and [R2 pricing](https://developers.cloudflare.com/r2/pricing/).

Someone using a service owned by another person does not need a Cloudflare
subscription. The account holder is responsible for its usage.

## Use a service someone shared with you

Ask the person who set it up for two things:

- the service address;
- the access key.

Install the command:

```sh
curl -fsSL https://raw.githubusercontent.com/lynxnathan/cf-anyuser-drops/main/install.sh | sh
```

Create `~/.config/anyuser-drops/config.json` with the supplied values:

```json
{
  "endpoint": "https://drops.example/api/drop",
  "token": "the-private-access-key"
}
```

On Windows, use `%APPDATA%\anyuser-drops\config.json`. Keep the file private.
Everyone with the key has the same upload and removal permission.

If the command is not found after installation, add `~/.local/bin` to `PATH`
and open a new shell:

```sh
export PATH="$HOME/.local/bin:$PATH"
```

## Check the complete journey

After setup, run:

```sh
npm run test:e2e
```

The check creates a temporary file, shares it, downloads and compares it,
removes it, and confirms that the old link returns HTTP 404. It attempts to
clean up the temporary file if anything fails along the way.

The faster tests do not need Cloudflare:

```sh
npm test
```

## Need more detail?

See [the technical reference](./docs/reference.md) for configuration options,
command behavior, how the Cloudflare pieces fit together, manual deployment,
troubleshooting, and development commands.

Security reports belong in [SECURITY.md](./SECURITY.md). Contributions are
covered in [CONTRIBUTING.md](./CONTRIBUTING.md).

MIT — see [LICENSE](./LICENSE).
