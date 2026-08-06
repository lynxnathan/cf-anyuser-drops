import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:http";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { once } from "node:events";
import test from "node:test";
import { fileURLToPath } from "node:url";

const cliPath = fileURLToPath(new URL("../bin/anyuser-drops.mjs", import.meta.url));
const dropId = "0123456789abcdef0123456789abcdef";

async function runCli(appData, answer) {
  const child = spawn(process.execPath, [cliPath, "rm"], {
    env: { ...process.env, APPDATA: appData, NO_COLOR: "1" },
    stdio: ["pipe", "pipe", "pipe"],
  });
  let stdout = "";
  let stderr = "";
  child.stdout.setEncoding("utf8").on("data", (chunk) => { stdout += chunk; });
  child.stderr.setEncoding("utf8").on("data", (chunk) => { stderr += chunk; });
  child.stdin.end(`${answer}\n`);
  const [exitCode] = await once(child, "close");
  return { exitCode, stdout, stderr };
}

test("bare rm keeps the remembered drop unless its filename is confirmed", async (context) => {
  const root = await mkdtemp(join(tmpdir(), "anyuser-drops-rm-"));
  const appData = join(root, "profile");
  const configDirectory = join(appData, "anyuser-drops");
  const statePath = join(configDirectory, "last-drop.json");
  let requestedPath = null;

  const server = createServer((request, response) => {
    requestedPath = request.url;
    response.writeHead(204).end();
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const { port } = server.address();
  const publicUrl = `http://127.0.0.1:${port}/d/${dropId}/a%20very%20visible%20name.pdf`;

  context.after(async () => {
    server.close();
    await rm(root, { recursive: true, force: true });
  });

  await mkdir(configDirectory, { recursive: true });
  await writeFile(join(configDirectory, "config.json"), JSON.stringify({
    endpoint: `http://127.0.0.1:${port}/api/drop`,
    token: "test-token",
  }));
  await writeFile(statePath, JSON.stringify({
    url: publicUrl,
    filename: "a very visible name.pdf",
  }));

  const declined = await runCli(appData, "n");
  assert.equal(declined.exitCode, 0, declined.stderr);
  assert.equal(declined.stdout, "");
  assert.match(declined.stderr, /Not removed\./u);
  assert.equal(requestedPath, null);
  assert.equal(JSON.parse(await readFile(statePath, "utf8")).url, publicUrl);

  const confirmed = await runCli(appData, "y");
  assert.equal(confirmed.exitCode, 0, confirmed.stderr);
  assert.equal(confirmed.stdout, "");
  assert.match(confirmed.stderr, /Remove your last shared file\?/u);
  assert.match(confirmed.stderr, /a very visible name\.pdf/u);
  assert.match(confirmed.stderr, /Are you sure\? \[y\/N\]/u);
  assert.equal(requestedPath, `/api/drop/${dropId}`);
  await assert.rejects(readFile(statePath), { code: "ENOENT" });
});
