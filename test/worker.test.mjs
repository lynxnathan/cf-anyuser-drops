import assert from "node:assert/strict";
import test from "node:test";
import worker from "../src/index.js";

function testEnvironment() {
  const objects = new Map();
  return {
    UPLOAD_TOKEN: "test-token",
    SITE_TITLE: "test drops",
    DROPS: {
      async put(key, body, options) {
        const value = await new Response(body).arrayBuffer();
        objects.set(key, {
          value,
          size: value.byteLength,
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
          httpEtag: '"test-etag"',
        });
      },
      async get(key) {
        const object = objects.get(key);
        return object ? { ...object, body: object.value } : null;
      },
      async head(key) {
        return objects.get(key) ?? null;
      },
      async delete(key) {
        objects.delete(key);
      },
    },
  };
}

test("authenticated upload, read, and removal round-trip", async () => {
  const env = testEnvironment();
  const upload = await worker.fetch(new Request("https://drops.example/api/drop", {
    method: "PUT",
    headers: {
      authorization: "Bearer test-token",
      "content-length": "5",
      "content-type": "text/plain",
      "x-file-name": "hello.txt",
    },
    body: "hello",
  }), env);

  assert.equal(upload.status, 201);
  const { url } = await upload.json();
  assert.match(url, /^https:\/\/drops\.example\/d\/[a-f0-9]{32}\/hello\.txt$/);

  const download = await worker.fetch(new Request(url), env);
  assert.equal(download.status, 200);
  assert.equal(download.headers.get("content-type"), "text/plain");
  assert.equal(await download.text(), "hello");

  const id = new URL(url).pathname.split("/")[2];
  const unauthorized = await worker.fetch(new Request(`https://drops.example/api/drop/${id}`, {
    method: "DELETE",
  }), env);
  assert.equal(unauthorized.status, 401);

  const removed = await worker.fetch(new Request(`https://drops.example/api/drop/${id}`, {
    method: "DELETE",
    headers: { authorization: "Bearer test-token" },
  }), env);
  assert.equal(removed.status, 204);

  assert.equal((await worker.fetch(new Request(url), env)).status, 404);
});
