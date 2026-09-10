import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import {
  initializeGenesisProject,
  inspectVibe64Outputs,
  inspectVibe64ResourceEstimates,
  inspectVibe64WorkspaceSetup,
  parseVibe64ResourceEstimatesLines
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  vibe64ResourceEstimatesInspection
} from "../../packages/vibe64-genesis/src/server/resourceEstimates.js";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

const execFileAsync = promisify(execFile);
const MIB = 1024 * 1024;
const targets = [{ id: "app", mode: "interactive" }, { id: "archive", mode: "finite" }];
const appLines = [
  "### Output `app`",
  "- Startup typical MiB: `1024`",
  "- Startup high MiB: `1536`",
  "- Running typical MiB: `768`",
  "- Running high MiB: `1536`"
];
const setupLines = ["### Workspace setup", "- Typical MiB: `1024`", "- High MiB: `1536`"];
const outputDeclaration = [
  "### Target `app`: App",
  "- Default.",
  "- Mode: `interactive`",
  "- Runtimes: `nodejs`",
  "- Run `Start`: `node` `app.js`",
  "#### Presentation",
  "- Kind: `terminal`"
];
const setupDeclaration = ["- Prepare `Install` with `nodejs`: `npm` `install`"];

function inspect(lines, overrides = {}) {
  return vibe64ResourceEstimatesInspection({
    section: { status: "ready", stackHash: "same", sectionHash: "estimate-section", source: "project", lines },
    outputsSection: { status: "ready", stackHash: "same", lines: outputDeclaration },
    workspaceSetupSection: { status: "ready", stackHash: "same", lines: setupDeclaration },
    ...overrides
  });
}

test("resource estimates normalize declared interactive, finite and setup phases to bytes", () => {
  const parsed = parseVibe64ResourceEstimatesLines([
    "", ...appLines, "", "### Output `archive`", "- Typical MiB: `128`", "- High MiB: `256`", ...setupLines
  ], { targets, hasWorkspaceSetup: true });
  assert.deepEqual(parsed, {
    version: 1,
    outputs: [
      { targetId: "app", mode: "interactive", startup: { typicalBytes: 1024 * MIB, highBytes: 1536 * MIB }, running: { typicalBytes: 768 * MIB, highBytes: 1536 * MIB } },
      { targetId: "archive", mode: "finite", execution: { typicalBytes: 128 * MIB, highBytes: 256 * MIB } }
    ],
    workspaceSetup: { typicalBytes: 1024 * MIB, highBytes: 1536 * MIB }
  });
  assert.equal(Object.hasOwn(parsed.outputs[0], "maximumBytes"), false);
  assert.equal(Object.hasOwn(parsed.outputs[0], "lowBytes"), false);
});

test("resource estimates allow explicit none and omitted operation records", () => {
  assert.deepEqual(parseVibe64ResourceEstimatesLines(["- Nothing."]), { version: 1, outputs: [], workspaceSetup: null });
  const parsed = parseVibe64ResourceEstimatesLines(appLines, { targets, hasWorkspaceSetup: true });
  assert.equal(parsed.outputs.length, 1);
  assert.equal(parsed.workspaceSetup, null);
});

for (const value of ["0", "-1", "1.5", "1e3", "NaN", "Infinity", "01", "1048577", "9007199254740993", "$(touch /tmp/nope)"]) {
  test(`resource estimates reject invalid numeric value ${value}`, () => {
    const lines = appLines.map((line) => line.replace("`1024`", `\`${value}\``));
    assert.throws(() => parseVibe64ResourceEstimatesLines(lines, { targets }), { code: "VIBE64_RESOURCE_ESTIMATES_INVALID" });
  });
}

for (const [name, lines] of [
  ["missing field", appLines.slice(0, -1)],
  ["high below typical", appLines.map((line) => line.replace("Running high MiB: `1536`", "Running high MiB: `512`"))],
  ["unknown field", [...appLines, "- Maximum MiB: `2048`"]],
  ["duplicate field", [...appLines, appLines[1]]],
  ["duplicate target", [...appLines, ...appLines]],
  ["unknown target", appLines.map((line) => line.replace("`app`", "`other`"))],
  ["unsafe target", appLines.map((line) => line.replace("`app`", "`../app`"))],
  ["finite fields on interactive", [appLines[0], "- Typical MiB: `512`", "- High MiB: `1024`"]],
  ["interactive fields on finite", appLines.map((line) => line.replace("`app`", "`archive`"))],
  ["undeclared setup", setupLines],
  ["command", [...appLines, "- Run `Something`: `node` `app.js`"]],
  ["empty section", []],
  ["non-string lines", [null]],
  ["oversized section", ["x".repeat(65537)]],
  ["too many lines", Array(2049).fill("")]
]) {
  test(`resource estimates reject ${name}`, () => {
    assert.throws(() => parseVibe64ResourceEstimatesLines(lines, { targets }), { code: "VIBE64_RESOURCE_ESTIMATES_INVALID" });
  });
}

test("resource estimates reject duplicate setup and startup fields in setup", () => {
  for (const lines of [[...setupLines, ...setupLines], [...setupLines, "- Startup typical MiB: `1024`"]]) {
    assert.throws(() => parseVibe64ResourceEstimatesLines(lines, { hasWorkspaceSetup: true }), { code: "VIBE64_RESOURCE_ESTIMATES_INVALID" });
  }
});

test("resource inspection has explicit provenance, stable normalized identity and no invented measurements", () => {
  const result = inspect(appLines);
  assert.equal(result.contract, "vibe64.resource-estimates.v1");
  assert.equal(result.status, "ready");
  assert.equal(result.source, "project");
  assert.equal(result.sectionHash, "estimate-section");
  assert.match(result.estimatesHash, /^sha256:[a-f0-9]{64}$/u);
  assert.equal(result.estimatesHash, inspect(["", ...appLines, ""]).estimatesHash);
  assert.notEqual(result.estimatesHash, inspect(appLines.map((line) => line.replace("`768`", "`800`"))).estimatesHash);
  assert.equal(result.fallbackReason, null);
  assert.deepEqual(result.diagnostics, []);
});

test("invalid optional hints return no partial estimates and actionable diagnostics", () => {
  const result = inspect([...appLines, ...setupLines, "- High MiB: `10`"]);
  assert.equal(result.status, "invalid");
  assert.equal(result.fallbackReason, "invalid-estimates");
  assert.equal(result.estimatesHash, "");
  assert.deepEqual(result.outputs, []);
  assert.equal(result.workspaceSetup, null);
  assert.equal(result.diagnostics[0].code, "VIBE64_RESOURCE_ESTIMATES_INVALID");
  assert.equal(result.diagnostics[0].details.path, "genesis/stack.md#Resource estimates");
  assert.equal(typeof result.diagnostics[0].details.line, "number");
});

test("missing and explicitly empty estimates use the generic fallback", () => {
  for (const section of [
    { status: "unconfigured", stackHash: "same", lines: [] },
    { status: "ready", stackHash: "same", lines: ["- Nothing."] }
  ]) {
    const result = inspect([], { section });
    assert.equal(result.status, "unconfigured");
    assert.equal(result.fallbackReason, "not-declared");
    assert.equal(result.estimatesHash, "");
    assert.deepEqual(result.diagnostics, []);
  }
});

test("competing catalog proposals remain invalid rather than being combined", () => {
  const result = inspect([], {
    section: { status: "blocked", stackHash: "same", diagnostics: [{ code: "STACK_SECTION_AMBIGUOUS", message: "Choose one project section." }] }
  });
  assert.equal(result.status, "invalid");
  assert.equal(result.diagnostics[0].code, "STACK_SECTION_AMBIGUOUS");
  assert.deepEqual(result.outputs, []);
});

test("mixed Stack identities require reinspection, never silent fallback", () => {
  assert.throws(() => inspect(appLines, { outputsSection: { stackHash: "changed" } }), { code: "VIBE64_STACK_CHANGED" });
  assert.throws(() => inspect(appLines, { workspaceSetupSection: { stackHash: "changed" } }), { code: "VIBE64_STACK_CHANGED" });
});

test("public inspections transport hints without changing setup identity, blocking outputs or rewriting source", async () => {
  await withTemporaryRoot(async (projectRoot) => {
    await execFileAsync("git", ["init", "--initial-branch=main"], { cwd: projectRoot });
    await initializeGenesisProject({ projectRoot });
    const stackPath = path.join(projectRoot, "genesis/stack.md");
    const stack = `# Stack\n\n## Components\n\n## Outputs\n\n${outputDeclaration.join("\n")}\n\n## Workspace setup\n\n${setupDeclaration.join("\n")}\n`;
    await writeFile(stackPath, stack);
    const originalSetup = await inspectVibe64WorkspaceSetup({ projectRoot });
    assert.equal(originalSetup.status, "ready");
    assert.equal(originalSetup.resourceEstimates.status, "unconfigured");
    const source = `${stack}\n## Resource estimates\n\n${[...appLines, ...setupLines].join("\n")}\n`;
    await writeFile(stackPath, source);
    const outputs = await inspectVibe64Outputs({ projectRoot });
    const setup = await inspectVibe64WorkspaceSetup({ projectRoot });
    const estimates = await inspectVibe64ResourceEstimates({ projectRoot });
    assert.equal(outputs.status, "ready");
    assert.equal(setup.status, "ready");
    assert.equal(setup.recipeHash, originalSetup.recipeHash);
    assert.deepEqual(outputs.resourceEstimates, estimates);
    assert.deepEqual(setup.resourceEstimates, estimates);
    assert.equal(estimates.outputs[0].running.typicalBytes, 768 * MIB);
    assert.equal(await readFile(stackPath, "utf8"), source);
    await writeFile(stackPath, `${source}- Unexpected: \`bad\`\n`);
    const invalidOutputs = await inspectVibe64Outputs({ projectRoot });
    const invalidSetup = await inspectVibe64WorkspaceSetup({ projectRoot });
    assert.equal(invalidOutputs.status, "ready");
    assert.equal(invalidOutputs.targets[0].available, true);
    assert.equal(invalidSetup.status, "ready");
    assert.equal(invalidSetup.recipeHash, originalSetup.recipeHash);
    assert.equal(invalidOutputs.resourceEstimates.status, "invalid");
    assert.equal(invalidSetup.resourceEstimates.status, "invalid");
  });
});
