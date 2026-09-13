import assert from "node:assert/strict";
import test from "node:test";
import { execFile } from "node:child_process";
import { mkdtemp, appendFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { initializeGenesisProject, inspectVibe64IntegrationSetup } from "@local/vibe64-genesis/server";
import { parseVibe64IntegrationSetupLines } from "@local/vibe64-genesis/server";
import { vibe64IntegrationSetupInspection } from "../../packages/vibe64-genesis/src/server/integrationSetup.js";

const nodeCommand = '- Command with `nodejs` in `.`: `node` `scripts/integrations.js`';

test("application setup preserves exact framework-owned argv and working directory", () => {
  assert.deepEqual(parseVibe64IntegrationSetupLines([nodeCommand]), {
    argv: ["node", "scripts/integrations.js"], workdir: ".", runtimeRequirements: ["nodejs"]
  });
  assert.deepEqual(parseVibe64IntegrationSetupLines([
    '- Command with `php` in `backend`: `php` `artisan` `integrations:setup`'
  ]), { argv: ["php", "artisan", "integrations:setup"], workdir: "backend", runtimeRequirements: ["php"] });
});

test("missing and explicitly empty setup remain unconfigured without command inference", () => {
  for (const section of [{ status: "missing" }, { status: "ready", lines: ["- Nothing."] }]) {
    const result = vibe64IntegrationSetupInspection({ section });
    assert.equal(result.status, "unconfigured");
    assert.equal(result.command, null);
    assert.equal(result.recipeHash, "");
  }
});

test("setup rejects ambiguous commands, unsafe paths and invalid runtime declarations", () => {
  for (const lines of [
    [], [nodeCommand, nodeCommand], ["- Nothing.", nodeCommand],
    ['- Command with `nodejs` in `../other`: `node` `setup.js`'],
    ['- Command with `nodejs` in `.`: `/bin/node` `setup.js`'],
    ['- Command with `nodejs` in `.`: `../node` `setup.js`'],
    ['- Command with `nodejs` `nodejs` in `.`: `node` `setup.js`'],
    ['- Command with `nodejs` in `.`: node setup.js'],
    ['- Command with `nodejs` in `.`: `node` `setup.js` && `other`']
  ]) {
    assert.throws(() => parseVibe64IntegrationSetupLines(lines), { code: "VIBE64_INTEGRATION_SETUP_INVALID" });
  }
});

test("inspection keeps diagnostics and hashes the actual operation without executing it", () => {
  const section = { status: "ready", lines: [nodeCommand], stackHash: "stack-one", source: { path: "genesis/stack.md" } };
  const first = vibe64IntegrationSetupInspection({ section });
  assert.equal(first.status, "ready");
  assert.equal(first.stackHash, "stack-one");
  assert.deepEqual(first.source, section.source);
  assert.equal(first.recipeHash, vibe64IntegrationSetupInspection({ section: { ...section, lines: ["", nodeCommand, ""] } }).recipeHash);
  assert.notEqual(first.recipeHash, vibe64IntegrationSetupInspection({ section: { ...section, lines: [nodeCommand.replace("scripts/integrations.js", "scripts/other.js")] } }).recipeHash);
  const diagnostics = [{ code: "CONFLICT", message: "Conflicting declarations" }];
  const blocked = vibe64IntegrationSetupInspection({ section: { ...section, diagnostics } });
  assert.equal(blocked.status, "blocked");
  assert.equal(blocked.command, null);
  assert.deepEqual(blocked.diagnostics, diagnostics);
});

test("the pinned Genesis inspector transports the application setup declaration without running it", async (t) => {
  const projectRoot = await mkdtemp(path.join(tmpdir(), "vibe64-integration-declaration-"));
  t.after(() => rm(projectRoot, { recursive: true, force: true }));
  await promisify(execFile)("git", ["init", "--quiet"], { cwd: projectRoot });
  await initializeGenesisProject({ projectRoot });
  assert.equal((await inspectVibe64IntegrationSetup({ projectRoot })).status, "unconfigured");
  await appendFile(path.join(projectRoot, "genesis/stack.md"),
    `\n## Integration setup\n\n${nodeCommand}\n`);
  const result = await inspectVibe64IntegrationSetup({ projectRoot });
  assert.equal(result.status, "ready");
  assert.equal(result.contract, "vibe64.integration-setup.v1");
  assert.deepEqual(result.command.argv, ["node", "scripts/integrations.js"]);
  assert.match(result.recipeHash, /^sha256:/u);
  assert.ok(result.stackHash);
});
