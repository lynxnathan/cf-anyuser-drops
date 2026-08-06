import assert from "node:assert/strict";
import test from "node:test";
import { parseArguments } from "../bin/anyuser-drops.mjs";

test("a bare path is an upload", () => {
  assert.deepEqual(parseArguments(["photo.png"]), {
    command: "put",
    target: "photo.png",
    quiet: false,
    help: false,
  });
});

test("share is the explicit upload command", () => {
  assert.deepEqual(parseArguments(["share", "photo.png"]), {
    command: "put",
    target: "photo.png",
    quiet: false,
    help: false,
  });
});

test("quiet can appear before or after rm", () => {
  assert.equal(parseArguments(["-q", "rm", "https://drops.example/d/0123456789abcdef0123456789abcdef/a"]).command, "rm");
  assert.equal(parseArguments(["rm", "https://drops.example/d/0123456789abcdef0123456789abcdef/a", "-q"]).quiet, true);
});

test("rm without a URL selects the remembered drop", () => {
  assert.deepEqual(parseArguments(["rm"]), {
    command: "rm",
    target: undefined,
    quiet: false,
    help: false,
  });
});

test("usage errors use exit status 2", () => {
  assert.throws(
    () => parseArguments([]),
    (error) => error.exitCode === 2 && error.message === "Pass exactly one file. Try anyuser-drops --help",
  );
  assert.throws(() => parseArguments(["rm", "one", "two"]), (error) => (
    error.exitCode === 2 && error.message === "Pass exactly one drop URL. Usage: anyuser-drops rm <url>"
  ));
  assert.throws(() => parseArguments(["one", "two"]), (error) => error.exitCode === 2);
});

test("double dash makes command-like filenames literal", () => {
  assert.deepEqual(parseArguments(["--", "rm"]), {
    command: "put",
    target: "rm",
    quiet: false,
    help: false,
  });
});
