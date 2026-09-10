import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { constants } from "node:fs";
import { lstat, mkdir, mkdtemp, open, readFile, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { resourceWorkflowIdentity, startResourceWorkflow } from "../../packages/vibe64-terminals/src/server/resourceWorkflow.js";
import { installVibe64ManagedExecutionProvider } from "../../packages/vibe64-execution/src/server/managedExecution.js";
import { runWithProjectRequestContext } from "../../packages/vibe64-core/src/server/projectRequestContext.js";

async function fixture(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-resource-identity-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const runtimeRoot = path.join(root, "runtime");
  const sourceRoot = path.join(root, "source");
  await mkdir(path.join(runtimeRoot, "node26/bin"), { recursive: true });
  await mkdir(sourceRoot);
  await writeFile(path.join(runtimeRoot, "node26/bin/node"), "runtime-version-one");
  await writeFile(path.join(sourceRoot, "package-lock.json"), '{"lockfileVersion":3}');
  return {
    root, sourceRoot, runtimeRoot,
    input: {
      sourceRoot, operation: { kind: "output", targetId: "app" }, runtimes: ["node26"],
      steps: [{ argv: ["npm", "run", "dev"], workdir: "." }],
      env: { VIBE64_RUNTIME_PACK_ROOT: runtimeRoot }
    }
  };
}

test("resource compatibility follows runtime, commands and dependencies, not ordinary source or session paths", async (t) => {
  const f = await fixture(t);
  const first = await resourceWorkflowIdentity(f.input);
  assert.equal(first.compatibilityStatus, "complete");
  await writeFile(path.join(f.sourceRoot, "main.js"), "source changed");
  assert.deepEqual(await resourceWorkflowIdentity(f.input), first);
  const secondSource = path.join(f.root, "another-session");
  await mkdir(secondSource);
  await writeFile(path.join(secondSource, "package-lock.json"), '{"lockfileVersion":3}');
  assert.deepEqual(await resourceWorkflowIdentity({ ...f.input, sourceRoot: secondSource }), first);
  assert.notEqual((await resourceWorkflowIdentity({ ...f.input, steps: [{ argv: ["npm", "run", "test"] }] })).compatibilityKey, first.compatibilityKey);
  assert.notEqual((await resourceWorkflowIdentity({ ...f.input, operation: { kind: "output", targetId: "test-app" } })).compatibilityKey, first.compatibilityKey);
  await writeFile(path.join(f.sourceRoot, "package-lock.json"), '{"lockfileVersion":3,"updated":true}');
  const changedDependencies = await resourceWorkflowIdentity(f.input);
  assert.notEqual(changedDependencies.compatibilityKey, first.compatibilityKey);
  await writeFile(path.join(f.runtimeRoot, "node26/bin/node"), "runtime-version-two-upgraded");
  assert.notEqual((await resourceWorkflowIdentity(f.input)).compatibilityKey, changedDependencies.compatibilityKey);
});

test("a pack upgrade changes identity even when its first executable resolves to the same tool", async (t) => {
  const f = await fixture(t);
  const node = path.join(f.root, "shared-node");
  await writeFile(node, "unchanged-node-version");
  const bin = path.join(f.runtimeRoot, "node26/bin");
  await rm(path.join(bin, "node"));
  await symlink(node, path.join(bin, "node"));
  const first = await resourceWorkflowIdentity(f.input);
  assert.equal(first.compatibilityStatus, "complete");
  const replacement = path.join(f.root, "new-pack-bin");
  await mkdir(replacement);
  await symlink(node, path.join(replacement, "node"));
  await rm(bin, { recursive: true });
  await symlink(replacement, bin);
  const upgraded = await resourceWorkflowIdentity(f.input);
  assert.equal(upgraded.compatibilityStatus, "complete");
  assert.notEqual(upgraded.compatibilityKey, first.compatibilityKey);
});

test("mutable operator wrappers include both commands and their installed package manifests", async (t) => {
  const f = await fixture(t);
  const manifests = ["operator-clis/lib/node_modules/@openai/codex/package.json", "operator-clis/lib/node_modules/opencode-ai/package.json"];
  for (const file of manifests) {
    await mkdir(path.dirname(path.join(f.runtimeRoot, file)), { recursive: true });
    await writeFile(path.join(f.runtimeRoot, file), '{"version":"1.0.0"}');
  }
  for (const directory of ["managed-bin", "operator-clis/bin"]) {
    await mkdir(path.join(f.runtimeRoot, directory), { recursive: true });
    for (const command of ["codex", "opencode"]) {
      await writeFile(path.join(f.runtimeRoot, directory, command),
        `#!/bin/sh\necho should-not-run > ${JSON.stringify(path.join(f.root, "invoked"))}\n`, { mode: 0o755 });
    }
  }
  const input = { ...f.input, runtimes: ["operator-clis"] };
  const first = await resourceWorkflowIdentity(input);
  assert.equal(first.compatibilityStatus, "complete");
  await writeFile(path.join(f.runtimeRoot, "operator-clis/bin/opencode"), "new-opencode-launcher");
  const launcherChanged = await resourceWorkflowIdentity(input);
  assert.equal(launcherChanged.compatibilityStatus, "complete");
  assert.notEqual(launcherChanged.compatibilityKey, first.compatibilityKey);
  await writeFile(path.join(f.runtimeRoot, manifests[1]), '{"version":"1.0.1"}');
  const packageChanged = await resourceWorkflowIdentity(input);
  assert.equal(packageChanged.compatibilityStatus, "complete");
  assert.notEqual(packageChanged.compatibilityKey, launcherChanged.compatibilityKey);
  assert.deepEqual(await resourceWorkflowIdentity(input), packageChanged);
  assert.equal(JSON.stringify(packageChanged).includes(f.root), false);
  await assert.rejects(readFile(path.join(f.root, "invoked")), { code: "ENOENT" });
  await rm(path.join(f.runtimeRoot, manifests[0]));
  assert.equal((await resourceWorkflowIdentity(input)).compatibilityStatus, "incomplete");
});

test("Playwright browser identity follows its installed manifest and browser store, not only the CLI", async (t) => {
  const f = await fixture(t);
  const pack = path.join(f.runtimeRoot, "playwright");
  await mkdir(path.join(pack, "bin"), { recursive: true });
  await mkdir(path.join(pack, "browsers"));
  await writeFile(path.join(pack, "bin/playwright"), "unchanged-cli");
  const manifest = path.join(pack, "runtime.env");
  await writeFile(manifest, "playwright_version=1.61.1\nchromium_revision=first\n");
  const input = { ...f.input, runtimes: ["playwright"] };
  const first = await resourceWorkflowIdentity(input);
  assert.equal(first.compatibilityStatus, "complete");
  await writeFile(manifest, "playwright_version=1.61.1\nchromium_revision=second\n");
  const manifestChanged = await resourceWorkflowIdentity(input);
  assert.notEqual(manifestChanged.compatibilityKey, first.compatibilityKey);
  const replacement = path.join(f.root, "new-browser-store");
  await mkdir(replacement);
  await rm(path.join(pack, "browsers"), { recursive: true });
  await symlink(replacement, path.join(pack, "browsers"));
  const browsersChanged = await resourceWorkflowIdentity(input);
  assert.equal(browsersChanged.compatibilityStatus, "complete");
  assert.notEqual(browsersChanged.compatibilityKey, manifestChanged.compatibilityKey);
  await rm(manifest);
  const missing = await resourceWorkflowIdentity(input);
  assert.equal(missing.compatibilityStatus, "incomplete");
  assert.equal(missing.compatibilityDiagnostic, "runtime_or_dependency_identity_unavailable");
});

test("incomplete and unsafe dependency identities stay explicitly unlearnable, with no source or secrets in metadata", async (t) => {
  const f = await fixture(t);
  const outside = path.join(f.root, "private-secret-marker");
  await writeFile(outside, "must-not-be-read");
  await rm(path.join(f.sourceRoot, "package-lock.json"));
  await symlink(outside, path.join(f.sourceRoot, "package-lock.json"));
  const identity = await resourceWorkflowIdentity({ ...f.input, steps: [{ argv: ["command-private-marker"] }] });
  assert.equal(identity.compatibilityStatus, "incomplete");
  assert.equal(identity.compatibilityDiagnostic, "dependency_outside_source");
  assert.equal(JSON.stringify(identity).includes("private-marker"), false);
  assert.equal(JSON.stringify(identity).includes(f.root), false);
  await rm(path.join(f.sourceRoot, "package-lock.json"));
  const file = await open(path.join(f.sourceRoot, "package-lock.json"), "w");
  await file.truncate(8 * 1024 * 1024 + 1);
  await file.close();
  assert.equal((await resourceWorkflowIdentity(f.input)).compatibilityDiagnostic, "dependency_identity_too_large");
  await rm(path.join(f.runtimeRoot, "node26/bin/node"));
  assert.equal((await resourceWorkflowIdentity(f.input)).compatibilityStatus, "incomplete");
  await assert.rejects(resourceWorkflowIdentity({ ...f.input, steps: [{ argv: ["npm"], workdir: "../outside" }] }), /outside/u);
});

test("a workflow starts with resolved project/session identity and host-local compatibility metadata", async (t) => {
  const f = await fixture(t);
  let request;
  const release = installVibe64ManagedExecutionProvider({
    runCommand() {}, stopExecution() {},
    startWorkflow(input) { request = input; return { ok: true, workflow: { id: "owned-workflow" } }; }
  });
  t.after(release);
  const input = { ...f.input, configuration: { mode: "interactive" }, session: { sessionId: "session" }, kind: "preview", label: "Application", environment: "test" };
  await assert.rejects(startResourceWorkflow(input), /resolved project/u);
  const result = await runWithProjectRequestContext({ slug: "example" }, () => startResourceWorkflow(input));
  assert.equal(result.workflow.id, "owned-workflow");
  assert.equal(request.projectSlug, "example");
  assert.equal(request.sessionId, "session");
  assert.equal(request.ownerId, "session");
  assert.equal(request.environment, "test");
  assert.equal(request.mode, "interactive");
  assert.equal(request.compatibilityStatus, "complete");
  assert.match(request.compatibilityKey, /^[a-f0-9]{64}$/u);
  assert.equal(request.sourceRoot, undefined);
  assert.equal(request.steps, undefined);
  assert.equal(request.env, undefined);
});

test("a dependency named pipe does not block startup or reuse an older cached fingerprint", async (t) => {
  const f = await fixture(t);
  const original = await resourceWorkflowIdentity(f.input);
  const lockfile = path.join(f.sourceRoot, "package-lock.json");
  await rm(lockfile);
  execFileSync("mkfifo", ["-m", "0600", lockfile]);
  let request;
  const release = installVibe64ManagedExecutionProvider({
    runCommand() {}, stopExecution() {},
    startWorkflow(input) { request = input; return { ok: true, workflow: { id: "accounted" } }; }
  });
  t.after(release);
  const pending = runWithProjectRequestContext({ slug: "example" }, () => startResourceWorkflow({
    ...f.input, session: { sessionId: "session" }, kind: "preview", configuration: { mode: "interactive" }
  }));
  let timer;
  let result;
  try {
    result = await Promise.race([pending, new Promise((resolve) => { timer = setTimeout(() => resolve("blocked"), 1000); })]);
  } finally { clearTimeout(timer); }
  if (result === "blocked") {
    // Release a regressed blocking open before failing the test, without
    // leaving a filesystem worker or managed execution alive.
    const writer = await open(lockfile, constants.O_WRONLY | constants.O_NONBLOCK);
    await writer.close();
    await pending;
  }
  assert.notEqual(result, "blocked", "optional fingerprinting waited for a FIFO writer");
  assert.equal(result.ok, true);
  assert.equal(request.compatibilityStatus, "incomplete");
  assert.equal(request.compatibilityDiagnostic, "runtime_or_dependency_identity_unavailable");
  assert.notEqual(request.compatibilityKey, original.compatibilityKey);
  assert.ok((await lstat(lockfile)).isFIFO(), "inspection must leave the source file untouched");
  await rm(lockfile);
  await writeFile(lockfile, '{"lockfileVersion":3}');
  assert.deepEqual(await resourceWorkflowIdentity(f.input), original, "normal identity recovers after an explicit source repair");
});

test("changed application configuration selects a new generation; unavailable configuration disables learning", async (t) => {
  const f = await fixture(t);
  const first = await resourceWorkflowIdentity({ ...f.input, configuration: { environmentFingerprint: "a".repeat(64) } });
  const changed = await resourceWorkflowIdentity({ ...f.input, configuration: { environmentFingerprint: "b".repeat(64) } });
  assert.equal(first.compatibilityStatus, "complete");
  assert.equal(changed.compatibilityStatus, "complete");
  assert.notEqual(first.compatibilityKey, changed.compatibilityKey);
  let request;
  const release = installVibe64ManagedExecutionProvider({
    runCommand() {}, stopExecution() {},
    startWorkflow(input) { request = input; return { ok: true, workflow: { id: "accounted" } }; }
  });
  t.after(release);
  const result = await runWithProjectRequestContext({ slug: "example" }, () => startResourceWorkflow({
    ...f.input, session: { sessionId: "session" }, configuration: { environmentFingerprint: null }
  }));
  assert.equal(result.workflow.id, "accounted");
  assert.equal(request.compatibilityStatus, "incomplete");
  assert.equal(request.compatibilityDiagnostic, "configuration_identity_unavailable");
  assert.equal(request.configuration, undefined);
});

test("legacy projects without dependency files or resource estimates can start without teaching an incomplete identity", async (t) => {
  const f = await fixture(t);
  await rm(path.join(f.sourceRoot, "package-lock.json"));
  await rm(path.join(f.runtimeRoot, "node26/bin/node"));
  let request;
  const release = installVibe64ManagedExecutionProvider({
    runCommand() {}, stopExecution() {},
    startWorkflow(input) { request = input; return { ok: true, workflow: { id: "legacy-workflow" } }; }
  });
  t.after(release);
  const result = await runWithProjectRequestContext({ slug: "existing-project" }, () => startResourceWorkflow({
    ...f.input, session: { sessionId: "older-session" }, kind: "preview", configuration: { mode: "interactive" }
  }));
  assert.equal(result.ok, true);
  assert.equal(request.estimates, undefined);
  assert.equal(request.environment, "development");
  assert.equal(request.compatibilityStatus, "incomplete");
  assert.equal(request.compatibilityDiagnostic, "runtime_or_dependency_identity_unavailable");
});

test("standalone operation does not require hosted resource metadata or a resource store", async () => {
  assert.deepEqual(await startResourceWorkflow({}), { ok: true, workflow: null });
});
