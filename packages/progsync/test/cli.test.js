import assert from "node:assert/strict";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

import { parseArguments } from "../src/cli.js";
import { runProgSyncCommand } from "../src/command.js";
import { PROGSYNC_STATE_REF } from "../src/constants.js";
import { createGitProject } from "./helpers.js";

const PACKAGE_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const CLI_PATH = path.join(PACKAGE_ROOT, "bin", "progsync.js");
const PROGRAM = `# Greeting

Returns a greeting.

## Uses

- Nothing outside this file.

## Provides

### \`greet()\`

The function returns \`hello\`.
`;

test("treats a bare implementation or Program path as automatic sync", () => {
  const implementation = parseArguments(["src/greet.js", "--dry-run"]);
  assert.equal(implementation.command, "sync");
  assert.equal(implementation.options.path, "src/greet.js");
  assert.equal(implementation.options.dryRun, true);

  const program = parseArguments(["program/src/greet.js.md"]);
  assert.equal(program.command, "sync");
  assert.equal(program.options.path, "program/src/greet.js.md");
});

test("retains explicit compatibility commands and parses read-only status", () => {
  assert.equal(parseArguments(["import", "src/greet.js"]).command, "import");
  assert.equal(parseArguments(["compile", "program/src/greet.js.md"]).command, "compile");
  const status = parseArguments(["status", "src/greet.js"]);
  assert.equal(status.command, "status");
  assert.equal(status.options.path, "src/greet.js");
});

test("rejects missing option values and incompatible targets", () => {
  assert.throws(
    () => parseArguments(["src/greet.js", "--project-root"]),
    (error) => error.code === "OPTION_VALUE_REQUIRED"
  );
  assert.throws(
    () => parseArguments(["sync", "src/greet.js", "--changed"]),
    (error) => error.code === "CONFLICTING_TARGETS"
  );
  assert.throws(
    () => parseArguments(["status", "src/greet.js", "--dry-run"]),
    (error) => error.code === "OPTION_NOT_APPLICABLE"
  );
});

test("runs status without state writes and bootstraps a bare-path no-op sync", async (t) => {
  const root = await createGitProject(t, {
    "program/src/greet.js.md": PROGRAM,
    "src/greet.js": "function greet() { return \"hello\"; }\n\nexport { greet };\n"
  });
  const commandOptions = {
    allowedRoots: [PACKAGE_ROOT, root],
    cwd: PACKAGE_ROOT,
    outputEncoding: "base64"
  };
  const statusResult = await runProgSyncCommand("node", [
    CLI_PATH,
    "status",
    "src/greet.js",
    "--project-root",
    root,
    "--json"
  ], commandOptions);
  const status = JSON.parse(statusResult.stdout);
  assert.equal(status.status, "synchronized");
  assert.equal(status.mode, "NO_CHANGE");
  let stateResult = await runProgSyncCommand("git", [
    "rev-parse",
    "--verify",
    "--quiet",
    PROGSYNC_STATE_REF
  ], { cwd: root, reject: false });
  assert.equal(stateResult.ok, false);

  const syncResult = await runProgSyncCommand("node", [
    CLI_PATH,
    "src/greet.js",
    "--project-root",
    root,
    "--json"
  ], commandOptions);
  const synchronized = JSON.parse(syncResult.stdout);
  assert.equal(synchronized.mode, "NO_CHANGE");
  assert.equal(synchronized.checkpointed, true);
  stateResult = await runProgSyncCommand("git", [
    "rev-parse",
    "--verify",
    "--quiet",
    PROGSYNC_STATE_REF
  ], { cwd: root, reject: false });
  assert.equal(stateResult.ok, true);

  const repeatedResult = await runProgSyncCommand("node", [
    CLI_PATH,
    "program/src/greet.js.md",
    "--project-root",
    root,
    "--json"
  ], commandOptions);
  const repeated = JSON.parse(repeatedResult.stdout);
  assert.equal(repeated.mode, "NO_CHANGE");
  assert.equal(repeated.checkpointed, false);
  assert.equal(repeated.baselineKind, "checkpoint");
  assert.equal(
    repeated.discovery.some((record) => record.code === "CHECKPOINT_SELECTED"),
    true
  );
});
