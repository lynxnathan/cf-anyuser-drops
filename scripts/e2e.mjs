import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const projectRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const cli = join(projectRoot, "bin", "anyuser-drops.mjs");
const fixtureText = `anyuser-drops-e2e:${randomUUID()}`;
const temporaryDirectory = await mkdtemp(join(tmpdir(), "anyuser-drops-e2e-"));
const fixturePath = join(temporaryDirectory, "e2e.txt");
let publicUrl;

try {
  await writeFile(fixturePath, fixtureText, "utf8");

  const shared = runCli(["-q", "share", fixturePath]);
  publicUrl = shared.stdout.trim();
  if (!/^https:\/\//.test(publicUrl) || shared.stdout.trimEnd().includes("\n")) {
    throw new Error(`share did not emit exactly one URL: ${JSON.stringify(shared.stdout)}`);
  }

  const download = await fetch(publicUrl);
  if (download.status !== 200) throw new Error(`expected download status 200, received ${download.status}`);
  if (await download.text() !== fixtureText) throw new Error("downloaded bytes did not match the fixture");

  const removed = runCli(["-q", "rm", publicUrl]);
  publicUrl = undefined;
  if (removed.stdout !== "") throw new Error(`rm wrote unexpected stdout: ${JSON.stringify(removed.stdout)}`);

  const afterRemoval = await fetch(shared.stdout.trim());
  if (afterRemoval.status !== 404) {
    throw new Error(`expected status 404 after rm, received ${afterRemoval.status}`);
  }

  process.stdout.write([
    "E2E passed:",
    "  share stdout: one URL",
    "  immediate download: 200 with matching bytes",
    "  rm stdout: empty",
    "  download after rm: 404",
    "",
  ].join("\n"));
} finally {
  if (publicUrl) runCli(["-q", "rm", publicUrl], false);
  await rm(temporaryDirectory, { recursive: true, force: true });
}

function runCli(arguments_, fail = true) {
  const result = spawnSync(process.execPath, [cli, ...arguments_], {
    cwd: projectRoot,
    encoding: "utf8",
    env: process.env,
  });
  if (fail && result.status !== 0) {
    throw new Error(`CLI failed (${result.status}): ${result.stderr.trim() || "no diagnostic"}`);
  }
  return result;
}
