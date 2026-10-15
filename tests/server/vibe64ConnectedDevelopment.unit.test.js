import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { vibe64ConnectedDevelopmentInspection } from "../../packages/vibe64-genesis/src/server/connectedDevelopment.js";
import { initializeGenesisProject, inspectVibe64ConnectedDevelopment } from "../../packages/vibe64-genesis/src/server/index.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const lines = [
  "- Sources file: `.development/connected-sources.json`",
  "- Prepare `Compose source` with `shell` in `tooling`: `sh` `compose.sh` `../.development/connected-sources.json`",
  "- Verify `Consumer uses selected source` with `shell`: `sh` `tooling/check-connected.sh` `.development/connected-sources.json`"
];

test("connected development retains Stack-owned placement and commands without a language adapter", () => {
  const inspected = vibe64ConnectedDevelopmentInspection({ status: "ready", stackHash: "stack", lines });
  assert.equal(inspected.contract, "vibe64.connected-development.v1");
  assert.equal(inspected.status, "ready");
  assert.equal(inspected.sourcesFile, ".development/connected-sources.json");
  assert.deepEqual(inspected.steps, [
    { label: "Compose source", argv: ["sh", "compose.sh", "../.development/connected-sources.json"],
      runtimeRequirements: ["shell"], workdir: "tooling", phase: "prepare" },
    { label: "Consumer uses selected source", argv: ["sh", "tooling/check-connected.sh", ".development/connected-sources.json"],
      runtimeRequirements: ["shell"], workdir: ".", phase: "verify" }
  ]);
  assert.deepEqual(inspected.runtimeRequirements, ["shell"]);
  assert.match(inspected.recipeHash, /^sha256:[a-f0-9]{64}$/u);
  const whitespace = vibe64ConnectedDevelopmentInspection({ status: "ready", lines: ["", ...lines.map(line => `  ${line}  `)] });
  assert.equal(whitespace.recipeHash, inspected.recipeHash);
  for (const changed of [
    [lines[0].replace(".development", "other"), ...lines.slice(1)],
    [...lines.slice(0, 2), lines[2].replace("check-connected.sh", "different-check.sh")],
    [...lines.slice(0, 2), lines[2].replace("`shell`", "`custom-toolchain`")]
  ]) {
    assert.notEqual(vibe64ConnectedDevelopmentInspection({ status: "ready", lines: changed }).recipeHash, inspected.recipeHash);
  }
});

test("connected development rejects missing proof, conditional success, unsafe paths and ambiguous recipes", () => {
  const invalid = candidate => assert.throws(() => vibe64ConnectedDevelopmentInspection({ status: "ready", lines: candidate }),
    { code: "VIBE64_CONNECTED_DEVELOPMENT_INVALID" });
  for (const candidate of [
    [], lines.slice(1), lines.slice(0, 2), [...lines, lines[0]], [lines[0], lines[2], lines[1]],
    [...lines, "- Nothing."], [lines[0], "- arbitrary command"],
    [lines[0], lines[2].replace("`shell`:", "`shell` if `proof` exists:")],
    [lines[0], lines[2].replace("`shell`:", "`shell` when `proof` exists:")],
    [lines[0], lines[2].replace("`sh`", "`/bin/sh`")],
    [lines[0], lines[2].replace("`shell`:", "`shell` in `../other`:")],
    [lines[0], lines[2].replace("`shell`:", "`shell` in `.development`:") + " && ignored"]
  ]) invalid(candidate);
  for (const location of [".", "../sources.json", "/tmp/sources.json", "a/../sources.json", "a\\sources.json", ".git/config", "a/.GIT/config"]) {
    invalid([`- Sources file: \`${location}\``, ...lines.slice(1)]);
  }
  assert.throws(() => vibe64ConnectedDevelopmentInspection({ status: "ready", lines: [lines[0], "", "- Verify `Bad` with `Shell`: `sh` `check.sh`"] }),
    error => error.code === "VIBE64_CONNECTED_DEVELOPMENT_INVALID"
      && error.details.path === "genesis/stack.md#Connected development" && error.details.line === 3);
  assert.equal(vibe64ConnectedDevelopmentInspection({}).status, "unconfigured");
  assert.equal(vibe64ConnectedDevelopmentInspection({ status: "ready", lines: ["- Nothing."] }).status, "unconfigured");
  const blocked = vibe64ConnectedDevelopmentInspection({ status: "blocked", diagnostics: [{ code: "STACK_INVALID" }] });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.recipeHash, "");
  assert.deepEqual(blocked.diagnostics, [{ code: "STACK_INVALID" }]);
});

test("Genesis transports the connected recipe without executing it or creating local source configuration", async () => {
  await assert.rejects(inspectVibe64ConnectedDevelopment({}), /explicit absolute projectRoot/u);
  await withTemporaryRoot(async projectRoot => {
    await promisify(execFile)("git", ["init", "--initial-branch=main", projectRoot]);
    await initializeGenesisProject({ projectRoot });
    const stack = path.join(projectRoot, "genesis/stack.md");
    await appendFile(stack, `\n## Connected development\n\n${lines.join("\n")}\n`);
    const before = await readFile(stack, "utf8");
    const inspected = await inspectVibe64ConnectedDevelopment({ projectRoot });
    assert.equal(inspected.status, "ready");
    assert.deepEqual(inspected.steps.map(step => step.phase), ["prepare", "verify"]);
    assert.match(inspected.stackHash, /^sha256:[a-f0-9]{64}$/u);
    assert.equal(await readFile(stack, "utf8"), before);
    await assert.rejects(readFile(path.join(projectRoot, inspected.sourcesFile)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(projectRoot, "vibe64.connections.json")), { code: "ENOENT" });
  });
});
