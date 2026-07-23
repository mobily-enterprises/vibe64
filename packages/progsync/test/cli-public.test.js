import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { runCli } from "../src/cli.js";
import {
  GREETING_PROGRAM,
  createGitProject
} from "./oracle-helpers.js";

const executeFile = promisify(execFile);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const executable = path.join(packageRoot, "bin/progsync.js");

test("exports only the public CLI entrypoint", async () => {
  const module = await import("../src/cli.js");
  assert.deepEqual(Object.keys(module), ["runCli"]);
  assert.equal(typeof runCli, "function");
});

test("the executable prints help without requiring a project", async () => {
  const result = await executeFile(process.execPath, [executable, "--help"], {
    encoding: "utf8"
  });
  assert.match(result.stdout, /progsync <program-or-implementation>/u);
  assert.match(result.stdout, /progsync sync --changed/u);
  assert.equal(result.stderr, "");
});

test("the executable returns the strict author prompt", async () => {
  const result = await executeFile(process.execPath, [executable, "author-prompt"], {
    encoding: "utf8",
    maxBuffer: 2 * 1024 * 1024
  });
  assert.match(result.stdout, /THE GOLDEN MODULE RULE/u);
  assert.match(result.stdout, /#### Parameters/u);
  assert.match(result.stdout, /Tests never count as consumers/u);
});

test("invalid CLI options fail with a stable readable diagnostic", async () => {
  await assert.rejects(
    executeFile(process.execPath, [executable, "sync", "--unknown"], {
      encoding: "utf8"
    }),
    (error) => error.code === 1 &&
      /^[^\n]+: Unknown option: --unknown\n$/u.test(error.stderr)
  );
});

test("status on a wide module emits no process-listener warning", async (t) => {
  const files = {
    "program/src/greet.js.md": GREETING_PROGRAM,
    "src/greet.js": "export function greet(name) { return `Hello, ${name}!`; }\n"
  };
  for (let index = 0; index < 12; index += 1) {
    files[`src/greet/private-${index}.js`] = `export const privateValue${index} = ${index};\n`;
  }
  const root = await createGitProject(t, files, { exports: "./src/greet.js" });
  const result = await executeFile(process.execPath, [
    executable,
    "status",
    "program/src/greet.js.md",
    "--project-root",
    root,
    "--json"
  ], { encoding: "utf8" });
  assert.equal(result.stderr, "");
  assert.equal(JSON.parse(result.stdout).mode, "NO_CHANGE");
});
