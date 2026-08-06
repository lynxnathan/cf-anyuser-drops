#!/usr/bin/env node

import { mkdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { realpathSync } from "node:fs";
import { basename, dirname, extname, join } from "node:path";
import { homedir } from "node:os";
import process from "node:process";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";

const MAX_BYTES = 25 * 1024 * 1024;

const MIME_TYPES = {
  ".gif": "image/gif",
  ".jpeg": "image/jpeg",
  ".jpg": "image/jpeg",
  ".json": "application/json",
  ".md": "text/markdown; charset=utf-8",
  ".mp3": "audio/mpeg",
  ".mp4": "video/mp4",
  ".pdf": "application/pdf",
  ".png": "image/png",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
  ".webm": "video/webm",
  ".webp": "image/webp",
  ".zip": "application/zip",
};

export async function main(args = process.argv.slice(2)) {
  const options = parseArguments(args);
  if (options.help) {
    printHelp();
    return;
  }

  const config = await loadConfig();
  const token = process.env.ANYUSER_DROPS_TOKEN || process.env.LYNX_DROPS_TOKEN || config.token;
  const endpoint = process.env.ANYUSER_DROPS_ENDPOINT || process.env.LYNX_DROPS_ENDPOINT || config.endpoint;
  if (!token) throw new CliError(`No upload token found. Set ANYUSER_DROPS_TOKEN or add it to ${config.primaryPath}`);
  if (!endpoint) throw new CliError(`No endpoint found. Set ANYUSER_DROPS_ENDPOINT or add it to ${config.primaryPath}`);

  if (options.command === "rm") {
    const remembered = options.target ? null : await loadRememberedDrop(config.statePath);
    if (!options.target && !remembered) {
      throw new CliError("No recent shared file found. Pass a drop URL: anyuser-drops rm <url>", 2);
    }
    if (remembered && !(await confirmRememberedRemoval(remembered, options.quiet))) return;

    const target = options.target || remembered.url;
    await removeDrop(target, { endpoint, token, quiet: options.quiet });
    try {
      await forgetDropIfMatching(config.statePath, target);
    } catch (error) {
      if (!options.quiet) console.error(`anyuser-drops: Removed, but could not update the recent-drop record: ${error.message}`);
    }
    return;
  }

  const uploaded = await uploadFile(options.target, { endpoint, token, quiet: options.quiet });
  try {
    await rememberDrop(config.statePath, uploaded);
  } catch (error) {
    if (!options.quiet) console.error(`anyuser-drops: Shared, but could not remember this drop: ${error.message}`);
  }
}

async function uploadFile(file, { endpoint, token, quiet }) {
  const fileInfo = await stat(file).catch((error) => {
    if (error.code === "ENOENT") throw new CliError(`File not found: ${file}`);
    throw error;
  });
  if (!fileInfo.isFile()) throw new CliError(`Not a file: ${file}`);
  if (fileInfo.size < 1) throw new CliError("The file is empty");
  if (fileInfo.size > MAX_BYTES) throw new CliError("Files are limited to 25 MiB");

  const filename = basename(file);
  if (!quiet) {
    console.error(`${paint("36;1", "✨ Sharing")} ${paint("1", filename)} (${formatBytes(fileInfo.size)})…`);
  }

  const response = await fetch(endpoint, {
    method: "PUT",
    headers: {
      authorization: `Bearer ${token}`,
      "content-length": String(fileInfo.size),
      "content-type": MIME_TYPES[extname(filename).toLowerCase()] || "application/octet-stream",
      "x-file-name": encodeURIComponent(filename),
    },
    body: await readFile(file),
  });

  const result = await response.json().catch(() => ({}));
  if (!response.ok) throw new CliError(result.error || `Upload failed with HTTP ${response.status}`);

  if (!quiet) console.error(paint("32;1", "🚀 Ready to share."));
  process.stdout.write(`${result.url}\n`);
  return { url: result.url, filename: result.filename || filename };
}

async function removeDrop(target, { endpoint, token, quiet }) {
  const endpointUrl = validUrl(endpoint, "configured endpoint");
  const publicUrl = validUrl(target, "drop URL");
  if (publicUrl.origin !== endpointUrl.origin) {
    throw new CliError(`Refusing to remove a drop from another host: ${publicUrl.host}`);
  }

  const match = publicUrl.pathname.match(/^\/d\/([a-f0-9]{32})(?:\/.*)?$/);
  if (!match) throw new CliError("Expected a complete anyuser-drops URL");

  if (!quiet) {
    console.error(`${paint("33;1", "🧹 Removing")} ${paint("1", dropDisplayName(publicUrl, match[1]))}…`);
  }
  const deleteUrl = new URL(`/api/drop/${match[1]}`, endpointUrl);
  const response = await fetch(deleteUrl, {
    method: "DELETE",
    headers: { authorization: `Bearer ${token}` },
  });

  if (!response.ok) {
    const result = await response.json().catch(() => ({}));
    throw new CliError(result.error || `Removal failed with HTTP ${response.status}`);
  }
  if (!quiet) console.error(paint("32;1", "✨ Removed."));
}

export function parseArguments(args) {
  let quiet = false;
  let help = false;
  let positionalOnly = false;
  const positional = [];

  for (const argument of args) {
    if (!positionalOnly && argument === "--") positionalOnly = true;
    else if (!positionalOnly && (argument === "-q" || argument === "--quiet")) quiet = true;
    else if (!positionalOnly && (argument === "-h" || argument === "--help")) help = true;
    else if (!positionalOnly && argument.startsWith("-")) throw new CliError(`Unknown option: ${argument}`, 2);
    else positional.push({ value: argument, literal: positionalOnly });
  }

  let command = "put";
  if (!positional[0]?.literal && ["rm", "share", "put", "upload"].includes(positional[0]?.value)) {
    command = positional.shift().value === "rm" ? "rm" : "put";
  }

  if (!help && positional.length !== 1 && !(command === "rm" && positional.length === 0)) {
    const message = command === "rm"
      ? "Pass exactly one drop URL. Usage: anyuser-drops rm <url>"
      : "Pass exactly one file. Try anyuser-drops --help";
    throw new CliError(message, 2);
  }
  return { command, target: positional[0]?.value, quiet, help };
}

async function loadConfig() {
  const configHome = process.env.APPDATA || process.env.XDG_CONFIG_HOME || join(homedir(), ".config");
  const primaryPath = process.env.ANYUSER_DROPS_CONFIG || join(configHome, "anyuser-drops", "config.json");
  const legacyPath = join(configHome, "lynx-drops", "config.json");
  const statePath = join(dirname(primaryPath), "last-drop.json");

  for (const path of [primaryPath, legacyPath]) {
    try {
      return { ...JSON.parse(await readFile(path, "utf8")), primaryPath, statePath, path };
    } catch (error) {
      if (error.code !== "ENOENT") throw new CliError(`Could not read config at ${path}: ${error.message}`);
    }
  }
  return { primaryPath, statePath };
}

async function rememberDrop(statePath, drop) {
  await mkdir(dirname(statePath), { recursive: true });
  await writeFile(statePath, `${JSON.stringify(drop, null, 2)}\n`, { mode: 0o600 });
}

async function loadRememberedDrop(statePath) {
  try {
    const drop = JSON.parse(await readFile(statePath, "utf8"));
    if (typeof drop.url !== "string" || typeof drop.filename !== "string") throw new Error("invalid contents");
    return drop;
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw new CliError(`Could not read the recent-drop record at ${statePath}: ${error.message}`);
  }
}

async function forgetDropIfMatching(statePath, removedUrl) {
  let remembered;
  try {
    remembered = await loadRememberedDrop(statePath);
  } catch {
    return;
  }
  if (remembered && remembered.url === removedUrl) {
    await rm(statePath, { force: true });
  }
}

async function confirmRememberedRemoval(drop, quiet) {
  const filename = terminalText(drop.filename, 100) || "unnamed file";
  const prompt = `${paint("33;1", "Remove your last shared file?")}\n  ${paint("1", filename)}\n${paint("33;1", "Are you sure? [y/N]")} `;
  const readline = createInterface({ input: process.stdin, output: process.stderr });
  let answer = "";
  try {
    answer = await readline.question(prompt);
  } catch {
    answer = "";
  } finally {
    readline.close();
  }
  const confirmed = /^(?:y|yes)$/iu.test(answer.trim());
  if (!confirmed && !quiet) console.error("Not removed.");
  return confirmed;
}

function validUrl(value, label) {
  try {
    return new URL(value);
  } catch {
    throw new CliError(`Invalid ${label}: ${value}`);
  }
}

function formatBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KiB`;
  return `${(bytes / 1024 / 1024).toFixed(1)} MiB`;
}

function dropDisplayName(url, id) {
  const encodedName = url.pathname.split("/").at(-1);
  if (!encodedName) return `drop ${id.slice(0, 8)}`;

  let name;
  try {
    name = decodeURIComponent(encodedName);
  } catch {
    return `drop ${id.slice(0, 8)}`;
  }

  const cleaned = terminalText(name, 80);
  if (!cleaned) return `drop ${id.slice(0, 8)}`;
  return cleaned;
}

function terminalText(value, limit) {
  const cleaned = String(value)
    .replace(/[\p{Cc}\p{Cf}\p{Cs}]/gu, "-")
    .replace(/\s+/g, " ")
    .trim();
  if (!cleaned) return "";

  const characters = [...cleaned];
  return characters.length <= limit
    ? cleaned
    : `${characters.slice(0, limit - 1).join("")}…`;
}

function paint(code, value) {
  if (!process.stderr.isTTY || process.env.NO_COLOR !== undefined || process.env.TERM === "dumb") {
    return value;
  }
  return `\u001b[${code}m${value}\u001b[0m`;
}

function printHelp() {
  process.stdout.write(`anyuser-drops — upload a file or remove a drop

Usage:
  anyuser-drops [options] share <file>
  anyuser-drops [options] <file>
  anyuser-drops [options] rm
  anyuser-drops [options] rm <url>

Options:
  -q, --quiet   Suppress progress; uploads still print the URL
  -h, --help    Show this help

Unix behavior:
  Upload URLs are written to stdout. Progress and errors use stderr.
  rm is silent on stdout and returns nonzero on failure. Without a URL,
  rm offers to remove the most recently shared file and asks first.

Environment:
  ANYUSER_DROPS_TOKEN      Override the configured upload token
  ANYUSER_DROPS_ENDPOINT   Override the configured upload endpoint
  ANYUSER_DROPS_CONFIG     Override the config file path

Compatibility aliases: lynx-drop, lynx-drops
`);
}

class CliError extends Error {
  constructor(message, exitCode = 1) {
    super(message);
    this.exitCode = exitCode;
  }
}

const isDirectInvocation = process.argv[1]
  && realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url));

if (isDirectInvocation) {
  process.stdout.on("error", (error) => {
    if (error.code === "EPIPE") process.exit(0);
    throw error;
  });

  try {
    await main();
  } catch (error) {
    console.error(`anyuser-drops: ${error.message}`);
    process.exitCode = error.exitCode || 1;
  }
}
