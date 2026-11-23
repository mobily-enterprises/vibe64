import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { appendFile, cp, lstat, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { Vibe64SessionRuntime } from "@local/vibe64-runtime/server/runtime";
import { runVibe64Command } from "@local/vibe64-execution/server";
import {
  initializeGenesisProject,
  inspectVibe64ConnectedDevelopment,
  inspectVibe64WorkspaceSetup
} from "../../packages/vibe64-genesis/src/server/index.js";
import {
  inspectConnectedDevelopmentInputs,
  inspectConnectedWorkspaceSetup,
  materializeConnectedDevelopmentInputs
} from "../../packages/vibe64-project/src/server/connectedDevelopment.js";
import {
  inspectConnectedAdapters,
  runConnectedAdapterStep,
  stopConnectedSync,
  syncConnectedRepositories
} from "../../packages/vibe64-project/src/server/connectedAdapters/index.js";
import { createWorkspaceSetupRunner } from "../../packages/vibe64-terminals/src/server/workspaceSetup.js";
import { vibe64RuntimePacks } from "../../packages/vibe64-terminals/src/server/vibe64OutputTargets.js";
import { projectRuntimeRoot, sourceMetadata, sourcePath } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);
const packageName = "@connected-proof/library";
const repository = "https://github.com/example/library";
const npmOptions = ["--offline", "--ignore-scripts", "--no-audit", "--no-fund"];

const consumeScript = `import { message } from '${packageName}'; console.log(message());\n`;

async function writeLibrary(root, message) {
  await mkdir(root, { recursive: true });
  await writeFile(path.join(root, "package.json"), JSON.stringify({
    name: packageName, version: "1.0.0", type: "module", exports: "./index.js"
  }));
  await writeFile(path.join(root, "index.js"), `export function message() { return ${JSON.stringify(message)}; }\n`);
}

async function createTask(target, name, releaseRoot, env) {
  const root = sourcePath(target, name);
  const copyRoot = path.join(path.dirname(root), "connected", "library");
  await mkdir(root, { recursive: true });
  await cp(releaseRoot, root, { recursive: true, filter: source => path.basename(source) !== "node_modules" });
  await exec("git", ["init", "--initial-branch=main"], { cwd: root, env });
  await initializeGenesisProject({ projectRoot: root });
  await appendFile(path.join(root, ".gitignore"), "\nnode_modules/\n");
  // Vibe64 puts a typed dependency in effect itself: the Stack only names the default type.
  await writeFile(path.join(root, "genesis/stack.md"), [
    "# Stack", "", "## Components", "", "## Workspace setup", "",
    "- Prepare `Install normal dependencies` with `nodejs`: `npm` `ci` `--offline` `--ignore-scripts` `--no-audit` `--no-fund`",
    "", "## Connected development", "",
    "- Default package type: `npm`", ""
  ].join("\n"));
  const connection = { name: "Library", repository, relationship: "dependency" };
  await writeFile(path.join(root, "vibe64.connections.json"), JSON.stringify({ repositories: [connection] }));
  await writeLibrary(copyRoot, `${name} original source`);
  const copy = { repository: "example/library", branch: "main", path: copyRoot, baseCommit: "a".repeat(40), canonicalCommit: "a".repeat(40) };
  const runtime = new Vibe64SessionRuntime({
    promptEnvironment: env, projectContextRoot: target, projectRuntimeRoot: projectRuntimeRoot(target)
  });
  await runtime.store.createSession({ sessionId: name, runtimeKind: "genesis", metadata: {
    ...sourceMetadata(target, name),
    connected_copies: JSON.stringify({ library: copy })
  } });
  const session = await runtime.store.readSession(name);
  const inspection = await inspectVibe64ConnectedDevelopment({ projectRoot: root });
  assert.equal(inspection.status, "ready");
  const inputs = { session, inspection, env };
  await materializeConnectedDevelopmentInputs(inputs);
  await exec("git", ["add", "--all"], { cwd: root, env });
  return { root, copyRoot, runtime, session, inputs };
}

function connectedWorkspaceRunner(tasks) {
  const taskOf = session => tasks.find(candidate => candidate.session.sessionId === session.sessionId);
  const repositoriesOf = async session => (await inspectConnectedDevelopmentInputs({ ...taskOf(session).inputs, session })).repositories;
  return createWorkspaceSetupRunner({
    project: {
      async inspectWorkspaceSetup({ projectRoot, session, environment }) {
        const task = tasks.find(candidate => candidate.root === projectRoot);
        assert.equal(session.sessionId, task.session.sessionId);
        return inspectConnectedWorkspaceSetup({ session, env: environment,
          setup: await inspectVibe64WorkspaceSetup({ projectRoot }),
          inspection: await inspectVibe64ConnectedDevelopment({ projectRoot }) });
      },
      // As the project service offers Vibe64's connected adapters.
      runConnectedAdapterStep,
      async inspectConnectedAdapters({ session }) {
        return inspectConnectedAdapters({ repositories: await repositoriesOf(session), sessionSourceRoot: taskOf(session).root });
      },
      async syncConnectedRepositories({ session, runCommand }) {
        return syncConnectedRepositories({ sessionId: session.sessionId, repositories: await repositoriesOf(session),
          sessionSourceRoot: taskOf(session).root, runCommand });
      },
      projectEnvironmentStatus: async () => ({ status: "ready" })
    },
    async connectedPreparation({ mode, session }) {
      assert.ok(["prepare", "inspect"].includes(mode));
      const task = tasks.find(candidate => candidate.session.sessionId === session.sessionId);
      if (mode === "prepare") await materializeConnectedDevelopmentInputs({ ...task.inputs, session });
      return inspectConnectedDevelopmentInputs({ ...task.inputs, session });
    }
  });
}

test("Vibe64 swaps a typed npm dependency into each task's own tree, keeps it in step and blocks preparation when it is not in effect", { timeout: 180_000 }, async t => {
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "connected-node-proof";
  t.after(() => {
    if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
    else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
  });
  const tempRoot = await mkdtemp(path.join(tmpdir(), "vibe64-connected-node-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const env = { ...process.env, npm_config_cache: path.join(tempRoot, "npm-cache") };
  const published = path.join(tempRoot, "published-library");
  const releaseRoot = path.join(tempRoot, "release");
  await writeLibrary(published, "published library");
  await mkdir(path.join(releaseRoot, "release"), { recursive: true });
  const packed = await exec("npm", ["pack", "--json", "--ignore-scripts", "--offline", "--pack-destination", path.join(releaseRoot, "release")], { cwd: published, env });
  const tarball = JSON.parse(packed.stdout)[0].filename;
  await writeFile(path.join(releaseRoot, "package.json"), JSON.stringify({
    name: "connected-consumer-proof", version: "1.0.0", private: true, type: "module",
    dependencies: { [packageName]: `file:./release/${tarball}` }
  }));
  await writeFile(path.join(releaseRoot, "consume.mjs"), consumeScript);
  await exec("npm", ["install", ...npmOptions], { cwd: releaseRoot, env });
  const releaseInputs = await Promise.all(["package.json", "package-lock.json"].map(file => readFile(path.join(releaseRoot, file), "utf8")));
  const target = path.join(tempRoot, "project");
  const first = await createTask(target, "task-a", releaseRoot, env);
  const second = await createTask(target, "task-b", releaseRoot, env);
  for (const task of [first, second]) t.after(() => stopConnectedSync(task.session.sessionId));
  const runner = connectedWorkspaceRunner([first, second]);
  const installed = task => path.join(task.root, "node_modules", packageName);
  for (const task of [first, second]) {
    const started = await runner.start({ runtime: task.runtime, session: task.session });
    const state = await started.completion;
    assert.equal(state?.status, "succeeded", JSON.stringify(state || started.state));
    assert.match(state.transcript, /Put connected Library in effect \(npm\)/u);
    assert.match(state.transcript, /@connected-proof\/library 1\.0\.0 in effect in 1 installed copy/u);
    assert.match(state.transcript, /\[Connected\] Library is in effect\./u);
    // A copy in the task's own tree, never a link to the checkout.
    assert.equal((await lstat(installed(task))).isSymbolicLink(), false);
    assert.equal(await realpath(installed(task)), installed(task));
    assert.equal(await runner.isPrepared({ runtime: task.runtime, session: await task.runtime.getSessionWithoutSource(task.session.sessionId) }), true);
  }
  const consume = async task => {
    const result = await runVibe64Command({ actor: "app", command: "node", args: ["consume.mjs"],
      cwd: task.root, allowedRoots: [task.root, task.copyRoot], baseEnv: env,
      envPolicy: "session", mode: "capture", purpose: "source",
      runtimes: vibe64RuntimePacks(["nodejs"]).runtimes, timeout: 30_000 });
    assert.equal(result.ok, true, result.output);
    return result.stdout.trim();
  };
  assert.equal(await consume(first), "task-a original source");
  assert.equal(await consume(second), "task-b original source");

  // A save in the task's connected copy reaches its tree while the session runs.
  await writeLibrary(first.copyRoot, "task-a changed source");
  let seen = "";
  for (let attempt = 0; attempt < 100 && seen !== "task-a changed source"; attempt += 1) {
    await new Promise(resolve => setTimeout(resolve, 100));
    seen = await consume(first);
  }
  assert.equal(seen, "task-a changed source", "A saved connected source reaches the installed copy.");
  assert.equal(await consume(second), "task-b original source", "Another task retains its own selected checkout.");
  for (const task of [first, second]) {
    assert.deepEqual(await Promise.all(["package.json", "package-lock.json"].map(file => readFile(path.join(task.root, file), "utf8"))), releaseInputs);
    assert.equal((await exec("git", ["diff", "--name-only"], { cwd: task.root, env })).stdout, "");
    assert.equal((await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: task.root, env })).stdout, "");
  }

  // Undone (an install put a published copy back): the session is not prepared, and preparing it puts it back.
  await stopConnectedSync(first.session.sessionId);
  await writeFile(path.join(installed(first), "index.js"), "export function message() { return 'published again'; }\n");
  const undone = await first.runtime.getSessionWithoutSource(first.session.sessionId);
  assert.equal(await runner.isPrepared({ runtime: first.runtime, session: undone }), false);
  const again = await runner.start({ runtime: first.runtime, session: undone });
  const reapplied = await again.completion;
  assert.equal(reapplied?.status, "succeeded", JSON.stringify(reapplied || again.state));
  assert.match(reapplied.transcript, /Workspace preparation started again\. Connected Library is not in effect/u);
  assert.equal(await consume(first), "task-a changed source");

  // A project step after the swap that undoes it: the proof fails and the preparation with it.
  await writeFile(path.join(first.root, "undo-swap.mjs"),
    `import { writeFileSync } from 'node:fs'; writeFileSync('node_modules/${packageName}/index.js', 'export const message = () => "undone";\\n');\n`);
  await writeFile(path.join(first.root, "genesis/stack.md"), [
    "# Stack", "", "## Components", "", "## Workspace setup", "",
    "- Prepare `Install normal dependencies` with `nodejs`: `npm` `ci` `--offline` `--ignore-scripts` `--no-audit` `--no-fund`",
    "", "## Connected development", "",
    "- Sources file: `.development/connected.json`",
    "- Default package type: `npm`",
    "- Verify `Undo the swap` with `nodejs`: `node` `undo-swap.mjs`", ""
  ].join("\n"));
  first.inputs.inspection = await inspectVibe64ConnectedDevelopment({ projectRoot: first.root });
  await materializeConnectedDevelopmentInputs(first.inputs);
  const blocked = await runner.start({ runtime: first.runtime, session: await first.runtime.getSessionWithoutSource(first.session.sessionId) });
  const failed = await blocked.completion;
  assert.equal(failed?.status, "failed", JSON.stringify(failed || blocked.state));
  assert.equal(failed.currentLabel, "Check connected Library is in effect (npm)");
  assert.match(failed.diagnostic, /Connected Library is not in effect: .*index\.js no longer holds the connected source/u);
  assert.equal(await runner.isPrepared({ runtime: first.runtime, session: await first.runtime.getSessionWithoutSource(first.session.sessionId) }), false);

  // A fresh normal installation (what Staging and Production build from) resolves the release artifact.
  const freshRelease = path.join(tempRoot, "fresh-release");
  await cp(releaseRoot, freshRelease, { recursive: true, filter: source => path.basename(source) !== "node_modules" });
  await exec("npm", ["ci", ...npmOptions], { cwd: freshRelease, env });
  assert.equal((await exec(process.execPath, ["consume.mjs"], { cwd: freshRelease, env })).stdout.trim(), "published library");
  assert.deepEqual(await Promise.all(["package.json", "package-lock.json"].map(file => readFile(path.join(freshRelease, file), "utf8"))), releaseInputs);
});

test("a typed npm dependency nothing installs leaves preparation succeeding, says to remove or install it, and keeps the session prepared", { timeout: 120_000 }, async t => {
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "connected-node-unused-proof";
  t.after(() => {
    if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
    else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
  });
  const tempRoot = await mkdtemp(path.join(tmpdir(), "vibe64-connected-node-unused-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const env = { ...process.env, npm_config_cache: path.join(tempRoot, "npm-cache") };
  // The app installs nothing of the connected repository (Genesis connected, no genesis-compiler).
  const releaseRoot = path.join(tempRoot, "release");
  await mkdir(releaseRoot, { recursive: true });
  await writeFile(path.join(releaseRoot, "package.json"), JSON.stringify({ name: "connected-unused-proof", version: "1.0.0", private: true }));
  await exec("npm", ["install", ...npmOptions], { cwd: releaseRoot, env });
  const task = await createTask(path.join(tempRoot, "project"), "task-u", releaseRoot, env);
  t.after(() => stopConnectedSync(task.session.sessionId));
  const runner = connectedWorkspaceRunner([task]);
  const said = "[Connected] Library is connected, but nothing here installs it: remove it or install it. " +
    `No tree of this session installs any of its packages (${packageName}).`;

  const started = await runner.start({ runtime: task.runtime, session: task.session });
  const state = await started.completion;
  assert.equal(state?.status, "succeeded", JSON.stringify(state || started.state));
  assert.equal(state.transcript.split("\n").filter(line => line === said).length, 2, "the apply and the proof each say so");
  const session = await task.runtime.getSessionWithoutSource(task.session.sessionId);
  assert.equal(await runner.isPrepared({ runtime: task.runtime, session }), true, "an unused connection needs no preparation again");
  const [proof] = await connectedProofs(task);
  assert.deepEqual([proof.inEffect, proof.unused, proof.reason], [false, true, said.slice("[Connected] ".length)]);
});

async function connectedProofs(task) {
  const { repositories } = await inspectConnectedDevelopmentInputs({ ...task.inputs, session: task.session });
  return inspectConnectedAdapters({ repositories, sessionSourceRoot: task.root });
}

test("custom connected scripts run prepare and verify through the Stack runner with literal source arguments", { timeout: 60_000 }, async t => {
  const previousNamespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "connected-custom-proof";
  t.after(() => {
    if (previousNamespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
    else process.env.VIBE64_RUNTIME_NAMESPACE = previousNamespace;
  });
  const tempRoot = await mkdtemp(path.join(tmpdir(), "vibe64-connected-custom-"));
  t.after(() => rm(tempRoot, { recursive: true, force: true }));
  const releaseRoot = path.join(tempRoot, "release");
  await mkdir(releaseRoot);
  const env = { ...process.env };
  const task = await createTask(path.join(tempRoot, "project with spaces"), "custom-task", releaseRoot, env);
  const script = "tooling/custom handler.mjs";
  const connection = { name: "Library", repository, relationship: "dependency", type: "custom", script };
  await writeFile(path.join(task.root, "vibe64.connections.json"), JSON.stringify({ repositories: [connection] }));
  await writeFile(path.join(task.root, "genesis/stack.md"), [
    "# Stack", "", "## Components", "", "## Workspace setup", "", "- Nothing.",
    "", "## Connected development", "", "- Default package type: `npm`",
    "- Sources file: `.development/connected.json`", "- Custom runner with `nodejs`: `node`", ""
  ].join("\n"));
  await mkdir(path.join(task.root, "tooling"));
  await writeFile(path.join(task.root, script), `import assert from 'node:assert/strict';
import { appendFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { parseArgs } from 'node:util';
const { values } = parseArgs({ options: Object.fromEntries(
  ['phase', 'source-root', 'project-root', 'sources-file', 'repository'].map(name => [name, { type: 'string' }])) });
const map = JSON.parse(readFileSync(values['sources-file'], 'utf8'));
const selected = map.repositories.find(project => project.repository === values.repository);
assert.equal(selected.type, 'custom');
assert.equal(selected.sourceRoot, values['source-root']);
assert.equal(process.cwd(), values['project-root']);
assert.equal(process.argv[1], path.join(values['project-root'], selected.script));
assert.equal(values['sources-file'], path.join(values['project-root'], '.development/connected.json'));
assert.ok(['prepare', 'verify'].includes(values.phase));
appendFileSync('.development/custom-calls.jsonl', JSON.stringify(values) + '\\n');
const expected = readFileSync(path.join(values['source-root'], 'payload.txt'), 'utf8').toUpperCase();
if (values.phase === 'prepare') writeFileSync('.development/custom-output.txt', expected);
else {
  assert.equal(readFileSync('.development/custom-output.txt', 'utf8'), expected);
  if (existsSync('.development/reject-verification')) throw new Error('Custom fixture verification rejected');
}
console.log('Custom fixture ' + values.phase + ' consumed selected source.');
`);
  await writeFile(path.join(task.copyRoot, "payload.txt"), "selected custom source");
  task.inputs.inspection = await inspectVibe64ConnectedDevelopment({ projectRoot: task.root });
  await materializeConnectedDevelopmentInputs(task.inputs);
  const sourceManifest = await readFile(path.join(task.copyRoot, "package.json"), "utf8");
  const runner = connectedWorkspaceRunner([task]);
  const started = await runner.start({ runtime: task.runtime, session: task.session });
  const result = await started.completion;
  assert.equal(result?.status, "succeeded", JSON.stringify(result || started.state));
  assert.equal(await readFile(path.join(task.root, ".development/custom-output.txt"), "utf8"), "SELECTED CUSTOM SOURCE");
  const calls = () => readFile(path.join(task.root, ".development/custom-calls.jsonl"), "utf8")
    .then(content => content.trim().split("\n").map(line => JSON.parse(line)));
  assert.deepEqual(await calls(), ["prepare", "verify"].map(phase => ({
    phase, "source-root": task.copyRoot, "project-root": task.root,
    "sources-file": path.join(task.root, ".development/connected.json"), repository
  })));
  assert.equal(await readFile(path.join(task.copyRoot, "package.json"), "utf8"), sourceManifest);

  await writeFile(path.join(task.copyRoot, "payload.txt"), "changed custom source");
  await writeFile(path.join(task.root, ".development/reject-verification"), "reject");
  const retried = await runner.start({ runtime: task.runtime, session: task.session, retry: true });
  const failed = await retried.completion;
  assert.equal(failed?.status, "failed", JSON.stringify(failed || retried.state));
  assert.match(failed.transcript, /Custom fixture verification rejected/u);
  assert.equal(await readFile(path.join(task.root, ".development/custom-output.txt"), "utf8"), "CHANGED CUSTOM SOURCE");
  assert.deepEqual((await calls()).map(call => call.phase), ["prepare", "verify", "prepare", "verify"]);
});
