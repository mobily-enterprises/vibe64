import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { appendFile, cp, mkdir, mkdtemp, readFile, realpath, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { Vibe64SessionRuntime } from "@local/vibe64-runtime/server";
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
import { createWorkspaceSetupRunner } from "../../packages/vibe64-terminals/src/server/workspaceSetup.js";
import { vibe64RuntimePacks } from "../../packages/vibe64-terminals/src/server/vibe64OutputTargets.js";
import { projectRuntimeRoot, sourceMetadata, sourcePath } from "./vibe64TestHelpers.js";

const exec = promisify(execFile);
const packageName = "@connected-proof/library";
const repository = "https://github.com/example/library";
const npmOptions = ["--offline", "--ignore-scripts", "--no-audit", "--no-fund"];

// These are project-owned commands, declared by this fixture's Stack. Product
// code supplies the source map and argv runner, without knowing npm's grammar.
const prepareScript = `import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
const map = JSON.parse(readFileSync('.development/connected.json', 'utf8'));
assert.equal(map.contract, 'vibe64.connected-sources.v1');
const selected = map.projects.find(project => project.repository === '${repository}');
assert.ok(selected);
execFileSync('npm', ['install', '--no-save', '--package-lock=false', '--install-links=false',
  '--ignore-scripts', '--offline', '--no-audit', '--no-fund', selected.sourceRoot], { stdio: 'inherit' });
`;
const verifyScript = `import assert from 'node:assert/strict';
import { readFileSync, realpathSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { message } from '${packageName}';
const map = JSON.parse(readFileSync('.development/connected.json', 'utf8'));
const selected = map.projects.find(project => project.repository === '${repository}');
assert.equal(realpathSync(fileURLToPath(import.meta.resolve('${packageName}'))),
  realpathSync(path.join(selected.sourceRoot, 'index.js')));
console.log(message());
`;
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
  const id = randomUUID();
  const receiverTarget = path.join(target, "library");
  const receiverRoot = sourcePath(receiverTarget, id);
  await mkdir(root, { recursive: true });
  await cp(releaseRoot, root, { recursive: true, filter: source => path.basename(source) !== "node_modules" });
  await exec("git", ["init", "--initial-branch=main"], { cwd: root, env });
  await initializeGenesisProject({ projectRoot: root });
  await appendFile(path.join(root, ".gitignore"), "\nnode_modules/\n");
  await writeFile(path.join(root, "prepare-connected.mjs"), prepareScript);
  await writeFile(path.join(root, "verify-connected.mjs"), verifyScript);
  await writeFile(path.join(root, "genesis/stack.md"), [
    "# Stack", "", "## Components", "", "## Workspace setup", "",
    "- Prepare `Install normal dependencies` with `nodejs`: `npm` `ci` `--offline` `--ignore-scripts` `--no-audit` `--no-fund`",
    "", "## Connected development", "",
    "- Sources file: `.development/connected.json`",
    "- Default package type: `npm`",
    "- Prepare `Select connected library` with `nodejs`: `node` `prepare-connected.mjs`",
    "- Verify `Import selected library` with `nodejs`: `node` `verify-connected.mjs`", ""
  ].join("\n"));
  const connection = { name: "Library", repository, relationship: "dependency" };
  await writeFile(path.join(root, "vibe64.connections.json"), JSON.stringify({ projects: [connection] }));
  await writeLibrary(receiverRoot, `${name} original source`);
  const contribution = { schemaVersion: 1, id, repository: "example/library", integrationBranch: "main", baseCommit: "a".repeat(40) };
  const runtime = new Vibe64SessionRuntime({
    promptEnvironment: env, projectContextRoot: target, projectRuntimeRoot: projectRuntimeRoot(target)
  });
  await runtime.store.createSession({ sessionId: name, runtimeKind: "genesis", metadata: {
    ...sourceMetadata(target, name),
    connected_sources: JSON.stringify({ schemaVersion: 1, sources: [{ projectSlug: "library", contribution }] })
  } });
  const session = await runtime.store.readSession(name);
  const projects = [{ ...connection, projectSlug: "library", session: {
    sessionId: id, sourceReady: true, metadata: {
      ...sourceMetadata(receiverTarget, id), connected_contribution: JSON.stringify(contribution)
    }
  } }];
  const inspection = await inspectVibe64ConnectedDevelopment({ projectRoot: root });
  assert.equal(inspection.status, "ready");
  const inputs = { session, projects, inspection, env };
  await materializeConnectedDevelopmentInputs(inputs);
  await exec("git", ["add", "--all"], { cwd: root, env });
  return { root, receiverRoot, runtime, session, inputs };
}

function connectedWorkspaceRunner(tasks) {
  return createWorkspaceSetupRunner({
    projectService: {},
    async inspect({ projectRoot, session, environment }) {
      const task = tasks.find(candidate => candidate.root === projectRoot);
      assert.equal(session.sessionId, task.session.sessionId);
      return inspectConnectedWorkspaceSetup({ session, env: environment,
        setup: await inspectVibe64WorkspaceSetup({ projectRoot }),
        inspection: await inspectVibe64ConnectedDevelopment({ projectRoot }) });
    },
    async connectedPreparation({ mode, session }) {
      assert.ok(["prepare", "inspect"].includes(mode));
      const task = tasks.find(candidate => candidate.session.sessionId === session.sessionId);
      if (mode === "prepare") await materializeConnectedDevelopmentInputs({ ...task.inputs, session });
      return inspectConnectedDevelopmentInputs({ ...task.inputs, session });
    }
  });
}

test("Stack preparation imports connected Node packages through task-local node_modules without changing release inputs", { timeout: 120_000 }, async t => {
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
  const runner = connectedWorkspaceRunner([first, second]);
  for (const task of [first, second]) {
    await inspectConnectedDevelopmentInputs(task.inputs);
    const started = await runner.start({ runtime: task.runtime, session: task.session });
    const state = await started.completion;
    assert.equal(state?.status, "succeeded", JSON.stringify(state || started.state));
    assert.match(state.transcript, new RegExp(`${task.session.sessionId} original source`, "u"));
    assert.equal(await realpath(path.join(task.root, "node_modules", packageName)), await realpath(task.receiverRoot));
  }
  const consume = async task => {
    const result = await runVibe64Command({ actor: "app", command: "node", args: ["verify-connected.mjs"],
      cwd: task.root, allowedRoots: [task.root, task.receiverRoot], baseEnv: env,
      envPolicy: "session", mode: "capture", purpose: "source",
      runtimes: vibe64RuntimePacks(["nodejs"]).runtimes, timeout: 30_000 });
    assert.equal(result.ok, true, result.output);
    return result.stdout.trim();
  };
  assert.equal(await consume(first), "task-a original source");
  await writeLibrary(first.receiverRoot, "task-a changed source");
  assert.equal(await consume(first), "task-a changed source", "A fresh ordinary package import observes the selected source edit.");
  assert.equal(await consume(second), "task-b original source", "Another task retains its own selected checkout.");
  for (const task of [first, second]) {
    assert.deepEqual(await Promise.all(["package.json", "package-lock.json"].map(file => readFile(path.join(task.root, file), "utf8"))), releaseInputs);
    assert.equal((await exec("git", ["diff", "--name-only"], { cwd: task.root, env })).stdout, "");
    assert.equal((await exec("git", ["ls-files", "--others", "--exclude-standard"], { cwd: task.root, env })).stdout, "");
  }
  // A fresh normal installation still resolves the release artifact, with no
  // connected source map and no task-specific path in its manifest or lockfile.
  const freshRelease = path.join(tempRoot, "fresh-release");
  await cp(releaseRoot, freshRelease, { recursive: true, filter: source => path.basename(source) !== "node_modules" });
  await exec("npm", ["ci", ...npmOptions], { cwd: freshRelease, env });
  assert.equal((await exec(process.execPath, ["consume.mjs"], { cwd: freshRelease, env })).stdout.trim(), "published library");
  assert.deepEqual(await Promise.all(["package.json", "package-lock.json"].map(file => readFile(path.join(freshRelease, file), "utf8"))), releaseInputs);
});

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
  await writeFile(path.join(task.root, "vibe64.connections.json"), JSON.stringify({ projects: [connection] }));
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
const selected = map.projects.find(project => project.repository === values.repository);
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
  await writeFile(path.join(task.receiverRoot, "payload.txt"), "selected custom source");
  task.inputs.projects = [{ ...task.inputs.projects[0], ...connection }];
  task.inputs.inspection = await inspectVibe64ConnectedDevelopment({ projectRoot: task.root });
  await materializeConnectedDevelopmentInputs(task.inputs);
  const sourceManifest = await readFile(path.join(task.receiverRoot, "package.json"), "utf8");
  const runner = connectedWorkspaceRunner([task]);
  const started = await runner.start({ runtime: task.runtime, session: task.session });
  const result = await started.completion;
  assert.equal(result?.status, "succeeded", JSON.stringify(result || started.state));
  assert.equal(await readFile(path.join(task.root, ".development/custom-output.txt"), "utf8"), "SELECTED CUSTOM SOURCE");
  const calls = () => readFile(path.join(task.root, ".development/custom-calls.jsonl"), "utf8")
    .then(content => content.trim().split("\n").map(line => JSON.parse(line)));
  assert.deepEqual(await calls(), ["prepare", "verify"].map(phase => ({
    phase, "source-root": task.receiverRoot, "project-root": task.root,
    "sources-file": path.join(task.root, ".development/connected.json"), repository
  })));
  assert.equal(await readFile(path.join(task.receiverRoot, "package.json"), "utf8"), sourceManifest);

  await writeFile(path.join(task.receiverRoot, "payload.txt"), "changed custom source");
  await writeFile(path.join(task.root, ".development/reject-verification"), "reject");
  const retried = await runner.start({ runtime: task.runtime, session: task.session, retry: true });
  const failed = await retried.completion;
  assert.equal(failed?.status, "failed", JSON.stringify(failed || retried.state));
  assert.match(failed.transcript, /Custom fixture verification rejected/u);
  assert.equal(await readFile(path.join(task.root, ".development/custom-output.txt"), "utf8"), "CHANGED CUSTOM SOURCE");
  assert.deepEqual((await calls()).map(call => call.phase), ["prepare", "verify", "prepare", "verify"]);
});
