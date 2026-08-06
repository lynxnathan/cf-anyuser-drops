#!/bin/sh
set -eu

repo=${ANYUSER_DROPS_REPO:-lynxnathan/cf-anyuser-drops}
ref=${ANYUSER_DROPS_REF:-main}
raw_base=${ANYUSER_DROPS_RAW_BASE:-"https://raw.githubusercontent.com/$repo/$ref"}
data_home=${XDG_DATA_HOME:-"$HOME/.local/share"}
if [ -n "${APPDATA:-}" ] && command -v cygpath >/dev/null 2>&1; then
  config_home=$(cygpath -u "$APPDATA")
else
  config_home=${XDG_CONFIG_HOME:-"$HOME/.config"}
fi
project_dir=$data_home/anyuser-drops
config_path=$config_home/anyuser-drops/config.json

say() { printf '%s\n' "$*" >&2; }
die() { say "anyuser-drops setup: $*"; exit 1; }

prompt() {
  prompt_text=$1
  default_value=$2
  if [ -r /dev/tty ]; then
    printf '%s [%s]: ' "$prompt_text" "$default_value" >/dev/tty
    IFS= read -r answer </dev/tty || answer=
  else
    answer=
  fi
  if [ -n "$answer" ]; then printf '%s' "$answer"; else printf '%s' "$default_value"; fi
}

for command_name in node npm curl; do
  command -v "$command_name" >/dev/null 2>&1 || die "missing required command: $command_name"
done

node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
[ "$node_major" -ge 22 ] || die "Node.js 22 or newer is required for Cloudflare deployment"

default_user=$(printf '%s' "${USER:-anyuser}" | tr '[:upper:]_' '[:lower:]-' | tr -cd 'a-z0-9-')
[ -n "$default_user" ] || default_user=anyuser
worker_name=${ANYUSER_DROPS_NAME:-$(prompt 'Worker name' "$default_user-drops")}
domain=${ANYUSER_DROPS_DOMAIN:-$(prompt 'Custom domain (blank uses workers.dev)' '')}
bucket_name=${ANYUSER_DROPS_BUCKET:-"$worker_name-files"}
site_title=${ANYUSER_DROPS_TITLE:-"$worker_name"}

case "$worker_name" in
  ''|*[!a-z0-9-]*|-*|*-) die 'worker name must use lowercase letters, numbers, and internal hyphens' ;;
esac
case "$bucket_name" in
  ''|*[!a-z0-9-]*|-*|*-) die 'bucket name must use lowercase letters, numbers, and internal hyphens' ;;
esac
case "$domain" in
  *[!A-Za-z0-9.-]*) die 'custom domain contains unsupported characters' ;;
esac

mkdir -p "$project_dir/src"
say "Downloading anyuser-drops from $repo@$ref…"
curl -fsSL "$raw_base/src/index.js" -o "$project_dir/src/index.js"
curl -fsSL "$raw_base/install.sh" -o "$project_dir/install.sh"
chmod 755 "$project_dir/install.sh"

node - "$worker_name" "$bucket_name" "$domain" "$site_title" "$project_dir/wrangler.jsonc" <<'NODE'
const fs = require("node:fs");
const [name, bucket, domain, title, output] = process.argv.slice(2);
const config = {
  name,
  main: "src/index.js",
  compatibility_date: "2026-08-06",
  workers_dev: true,
  vars: { SITE_TITLE: title },
  r2_buckets: [{ binding: "DROPS", bucket_name: bucket }],
};
if (domain) config.routes = [{ pattern: domain, custom_domain: true }];
fs.writeFileSync(output, `${JSON.stringify(config, null, 2)}\n`);
NODE

wrangler() { npx --yes wrangler@latest "$@"; }
if ! wrangler --version >/dev/null 2>&1; then
  die 'Cloudflare Wrangler cannot run on this system. You can still install the client here and deploy from a Wrangler-supported system.'
fi
if ! wrangler whoami >/dev/null 2>&1; then
  say 'Opening Cloudflare login…'
  wrangler login
fi

if ! wrangler r2 bucket info "$bucket_name" >/dev/null 2>&1; then
  say "Creating R2 bucket $bucket_name…"
  wrangler r2 bucket create "$bucket_name"
else
  say "Using existing R2 bucket $bucket_name."
fi

say "Deploying Worker $worker_name…"
if ! deploy_output=$(wrangler deploy --config "$project_dir/wrangler.jsonc" 2>&1); then
  printf '%s\n' "$deploy_output" >&2
  die 'Worker deployment failed'
fi
printf '%s\n' "$deploy_output" >&2

if [ -n "$domain" ]; then
  public_base="https://$domain"
else
  public_base=$(printf '%s\n' "$deploy_output" | tr -d '\r' | sed -n 's#.*\(https://[^[:space:]]*\.workers\.dev\).*#\1#p' | tail -n 1)
  [ -n "$public_base" ] || die 'could not determine the workers.dev URL from Wrangler output'
fi

token=$(node -e 'process.stdout.write(require("node:crypto").randomBytes(32).toString("base64url"))')
say 'Installing a fresh upload/delete credential…'
printf '%s\n' "$token" | wrangler secret put UPLOAD_TOKEN --config "$project_dir/wrangler.jsonc" >/dev/null

sh "$project_dir/install.sh"
mkdir -p "$(dirname "$config_path")"
umask 077
node - "$token" "$public_base/api/drop" "$config_path" <<'NODE'
const fs = require("node:fs");
const [token, endpoint, output] = process.argv.slice(2);
fs.writeFileSync(output, `${JSON.stringify({ token, endpoint }, null, 2)}\n`, { mode: 0o600 });
NODE
chmod 600 "$config_path"

say ''
say 'anyuser-drops is ready.'
say "Endpoint: $public_base"
say "Config:   $config_path"
say ''
say 'Try: anyuser-drops share ./some-file.png'
