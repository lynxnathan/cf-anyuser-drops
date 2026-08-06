import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../bin/anyuser-drops.mjs";
import worker from "../src/index.js";

const FUZZ_SEED = 0x41_6e_79_21;
const FUZZ_CASES = 1_000;
const FORBIDDEN_FILENAME_CHARACTERS = /[\p{Cc}\p{Cf}\p{Cs}<>:"|?*]/u;

const EDGE_CODE_POINTS = [
  0, 9, 10, 13, 32, 37, 46, 47, 58, 60, 62, 92, 127,
  0x0301, 0x200d, 0x202e, 0xfeff, 0x1f680,
];

function seededRandom(seed) {
  let state = seed >>> 0;
  return () => {
    state += 0x6d2b79f5;
    let value = state;
    value = Math.imul(value ^ (value >>> 15), value | 1);
    value ^= value + Math.imul(value ^ (value >>> 7), value | 61);
    return ((value ^ (value >>> 14)) >>> 0) / 0x1_0000_0000;
  };
}

function fuzzStrings(count) {
  const random = seededRandom(FUZZ_SEED);
  const values = [
    "",
    "rm",
    "share",
    "--help",
    "-q",
    ".",
    "..",
    `${"a".repeat(159)}🚀`,
    `${"é".repeat(159)}✨`,
    `${"👩🏽‍💻".repeat(80)}.pdf`,
    "A long descriptive filename, with punctuation (2026).pdf",
  ];

  while (values.length < count) {
    const characterCount = Math.floor(random() * 180);
    let value = "";
    for (let index = 0; index < characterCount; index += 1) {
      let codePoint;
      if (random() < 0.2) {
        codePoint = EDGE_CODE_POINTS[Math.floor(random() * EDGE_CODE_POINTS.length)];
      } else {
        do codePoint = Math.floor(random() * 0x11_0000);
        while (codePoint >= 0xd800 && codePoint <= 0xdfff);
      }
      value += String.fromCodePoint(codePoint);
    }
    values.push(value);
  }
  return values;
}

function testEnvironment() {
  const objects = new Map();
  return {
    UPLOAD_TOKEN: "fuzz-token",
    SITE_TITLE: "fuzz drops",
    DROPS: {
      async put(key, body, options) {
        const value = await new Response(body).arrayBuffer();
        objects.set(key, {
          value,
          size: value.byteLength,
          httpMetadata: options.httpMetadata,
          customMetadata: options.customMetadata,
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

test(`argument parser preserves ${FUZZ_CASES} fuzzed literal strings`, () => {
  for (const value of fuzzStrings(FUZZ_CASES)) {
    assert.deepEqual(parseArguments(["--", value]), {
      command: "put",
      target: value,
      quiet: false,
      help: false,
    });
    assert.deepEqual(parseArguments(["share", "--", value]), {
      command: "put",
      target: value,
      quiet: false,
      help: false,
    });
  }
});

test(`Worker safely round-trips ${FUZZ_CASES} fuzzed filenames`, async () => {
  const env = testEnvironment();

  for (const [index, value] of fuzzStrings(FUZZ_CASES).entries()) {
    const upload = await worker.fetch(new Request("https://drops.example/api/drop", {
      method: "PUT",
      headers: {
        authorization: "Bearer fuzz-token",
        "content-length": "1",
        "content-type": "application/octet-stream",
        "x-file-name": encodeURIComponent(value),
      },
      body: "x",
    }), env);

    assert.equal(upload.status, 201, `seed=${FUZZ_SEED} case=${index}`);
    const result = await upload.json();
    assert.ok(result.filename.length > 0, `seed=${FUZZ_SEED} case=${index}`);
    assert.ok([...result.filename].length <= 160, `seed=${FUZZ_SEED} case=${index}`);
    assert.equal(FORBIDDEN_FILENAME_CHARACTERS.test(result.filename), false, `seed=${FUZZ_SEED} case=${index}`);
    assert.notEqual(result.filename, ".", `seed=${FUZZ_SEED} case=${index}`);
    assert.notEqual(result.filename, "..", `seed=${FUZZ_SEED} case=${index}`);

    const publicUrl = new URL(result.url);
    assert.doesNotThrow(() => decodeURIComponent(publicUrl.pathname), `seed=${FUZZ_SEED} case=${index}`);

    const download = await worker.fetch(new Request(publicUrl), env);
    assert.equal(download.status, 200, `seed=${FUZZ_SEED} case=${index}`);
    assert.equal(await download.text(), "x", `seed=${FUZZ_SEED} case=${index}`);
    assert.equal(/[\r\n]/u.test(download.headers.get("content-disposition") ?? ""), false);
  }
});
