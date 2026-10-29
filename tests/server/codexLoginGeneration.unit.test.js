import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { currentCodexLoginGeneration, writeCodexAuthMarker } from "../../packages/vibe64-core/src/server/codexAuthState.js";
import { codexAppServerRuntimeDir } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { createCodexRuntimeHost, createCodexSessionRuntimeHost } from "../../packages/vibe64-terminals/src/server/codexRuntimeHost.js";

// A running Codex app-server keeps the credentials it started with. Each
// sign-in therefore gets its own runtime directory and provider identity, so
// new work starts on the new account beside a turn still running on the old one.
async function fixture(t) {
  const namespace = process.env.VIBE64_RUNTIME_NAMESPACE;
  process.env.VIBE64_RUNTIME_NAMESPACE = "login-generation-test";
  t.after(() => {
    if (namespace === undefined) delete process.env.VIBE64_RUNTIME_NAMESPACE;
    else process.env.VIBE64_RUNTIME_NAMESPACE = namespace;
  });
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-codex-login-generation-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  const systemRoot = path.join(root, "system");
  const toolHomeSource = path.join(root, "home");
  await mkdir(path.join(toolHomeSource, ".codex"), { recursive: true });
  const env = { HOME: toolHomeSource, VIBE64_AGENT_RUNTIME_DIR: path.join(root, "runtime") };
  const runtimeHost = createCodexRuntimeHost({
    env,
    codexAppServerProviderOptions: { env, systemRoot, toolHomeSource },
    codexToolHomeSource: toolHomeSource
  });
  const signIn = () => writeCodexAuthMarker(systemRoot, {
    connected: true, loginId: randomUUID(), updatedAt: new Date().toISOString(), version: 1
  });
  return { root, runtimeHost, signIn, systemRoot, toolHomeSource };
}

test("each Codex sign-in has its own login generation", async t => {
  const { signIn, systemRoot } = await fixture(t);
  assert.equal(currentCodexLoginGeneration(systemRoot), "");
  await signIn();
  const first = currentCodexLoginGeneration(systemRoot);
  assert.match(first, /^[a-f0-9]{24}$/u);
  assert.equal(currentCodexLoginGeneration(systemRoot), first);
  await signIn();
  assert.notEqual(currentCodexLoginGeneration(systemRoot), first);
  await writeCodexAuthMarker(systemRoot, { connected: false, version: 1 });
  assert.equal(currentCodexLoginGeneration(systemRoot), "");
});

test("a new Codex sign-in gives the session a new runtime directory and provider", async t => {
  const { runtimeHost, signIn, toolHomeSource } = await fixture(t);
  const workdir = "/srv/project/sessions/one/source";
  await signIn();
  const before = runtimeHost.codexAppServerRuntimeOptions({ toolHomeSource, workdir, executionRoot: workdir });
  await signIn();
  const after = runtimeHost.codexAppServerRuntimeOptions({ toolHomeSource, workdir, executionRoot: workdir });

  assert.notEqual(after.runtimeDir, before.runtimeDir);
  assert.equal(codexAppServerRuntimeDir(before), before.runtimeDir, "The previous runtime keeps its own directory");
  const beforeKey = runtimeHost.codexAppServerProviderKey("one", before);
  const afterKey = runtimeHost.codexAppServerProviderKey("one", after);
  assert.notEqual(afterKey, beforeKey);
  const { loginGeneration: _before, ...beforeFields } = runtimeHost.codexAppServerProviderKeyFields(beforeKey);
  const { loginGeneration: _after, ...afterFields } = runtimeHost.codexAppServerProviderKeyFields(afterKey);
  assert.deepEqual(afterFields, beforeFields, "Only the sign-in distinguishes the two providers of one session");
});

test("a session saved on the previous sign-in moves to the current sign-in's runtime", async t => {
  const { runtimeHost, signIn, toolHomeSource } = await fixture(t);
  const workdir = "/srv/project/sessions/one/source";
  const sessionRuntimeHost = createCodexSessionRuntimeHost({
    runtimeHost,
    accountPreparation: { codexToolHomeResult: async () => ({ ok: true, toolHomeSource }) },
    sessionEnvironment: { codexManagedCommandEnv: async () => ({}) },
    projectService: {},
    runCommand: async () => ({})
  });
  await signIn();
  const session = { sessionId: "one", metadata: { source_path: workdir } };
  const first = await sessionRuntimeHost.codexAppServerRuntimeOptionsForSession(session, { runtime: {}, terminalEnv: {} });
  session.metadata.agent_transport_runtime_dir = first.runtimeDir;
  assert.equal((await sessionRuntimeHost.codexAppServerRuntimeOptionsForSession(session, { runtime: {}, terminalEnv: {} })).runtimeDir,
    first.runtimeDir, "The same sign-in reuses the saved runtime");
  await signIn();
  const moved = await sessionRuntimeHost.codexAppServerRuntimeOptionsForSession(session, { runtime: {}, terminalEnv: {} });
  assert.notEqual(moved.runtimeDir, first.runtimeDir);
});
