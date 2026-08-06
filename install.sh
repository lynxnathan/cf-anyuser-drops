#!/bin/sh
set -eu

repo=${ANYUSER_DROPS_REPO:-lynxnathan/cf-anyuser-drops}
ref=${ANYUSER_DROPS_REF:-main}
prefix=${ANYUSER_DROPS_PREFIX:-"$HOME/.local"}
bin_dir=$prefix/bin
raw_base=${ANYUSER_DROPS_RAW_BASE:-"https://raw.githubusercontent.com/$repo/$ref"}
source_url="$raw_base/bin/anyuser-drops.mjs"

if ! command -v node >/dev/null 2>&1; then
  printf '%s\n' 'anyuser-drops requires Node.js 18 or newer.' >&2
  exit 1
fi
if ! command -v curl >/dev/null 2>&1; then
  printf '%s\n' 'anyuser-drops installation requires curl.' >&2
  exit 1
fi

node_major=$(node -p 'Number(process.versions.node.split(".")[0])')
if [ "$node_major" -lt 18 ]; then
  printf 'Node.js 18 or newer is required; found %s.\n' "$(node --version)" >&2
  exit 1
fi

mkdir -p "$bin_dir"
tmp_file=$(mktemp "${TMPDIR:-/tmp}/anyuser-drops.XXXXXX")
trap 'rm -f "$tmp_file"' EXIT HUP INT TERM
curl -fsSL "$source_url" -o "$tmp_file"
chmod 755 "$tmp_file"
mv "$tmp_file" "$bin_dir/anyuser-drops"
ln -sf anyuser-drops "$bin_dir/lynx-drop"
ln -sf anyuser-drops "$bin_dir/lynx-drops"
trap - EXIT HUP INT TERM

printf 'Installed anyuser-drops, lynx-drop, and lynx-drops in %s\n' "$bin_dir" >&2
case ":$PATH:" in
  *":$bin_dir:"*) ;;
  *) printf 'Add %s to PATH, then open a new shell.\n' "$bin_dir" >&2 ;;
esac
