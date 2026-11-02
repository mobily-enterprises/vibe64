import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { vibe64ActionPolicy } from "@local/vibe64-core/server/actionContext";

import {
  VIBE64_SERVICE_DATA_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import { VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV } from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  createProjectRuntimeChangedPublisher
} from "../../packages/vibe64-terminals/src/server/events.js";
import { createSessionChangedPublisher } from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";
import {
  clearProjectRuntimeOpenState,
  readProjectRuntimeOpenState
} from "../../packages/vibe64-core/src/server/projectRuntimeOpenState.js";
import { Vibe64TerminalsFeature } from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsFeature.js";
import { createService } from "../../packages/vibe64-terminals/src/server/service.js";
import { terminalsServiceCollaborators } from "../fixtures/terminalsServiceCollaborators.js";
import { codexAttachmentHostRoot } from "../../packages/vibe64-runtime/src/server/codexAttachmentPaths.js";
import { createCodexSessionEnvironment } from "../../packages/vibe64-terminals/src/server/codexSessionEnvironment.js";
import { Vibe64SessionRuntime } from "../../packages/vibe64-runtime/src/server/runtime.js";
import { startProjectRuntimeDormancyCleanupSchedule } from "../../packages/vibe64-terminals/src/server/projectRuntimeDormancy.js";
import { previewPublicOriginForLaunch } from "../../packages/vibe64-terminals/src/server/previewPublicOrigin.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-terminals-provider-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

const silentLogger = Object.freeze({ error() {}, info() {}, warn() {} });

/**
 * The env the server composes features with: the process env under the test's settings.
 * @param {object} settings
 */
function serverEnv(settings) {
  return { ...process.env, ...settings };
}

/**
 * A terminals service built as the feature builds it, with the test's own Codex terminal settings.
 * @param {object} dependencies
 */
function terminalsService({ env, ...dependencies }) {
  return createService(terminalsServiceCollaborators({
    env: serverEnv(env),
    logger: silentLogger,
    ...dependencies
  }));
}

async function failingCodexAuthPreflight() {
  throw new Error("test Codex authentication unavailable");
}

function featureDependencies({ env = {}, project, published = [], hooks = [] } = {}) {
  return {
    actionCatalogue: createActionCatalogue({ policy: vibe64ActionPolicy }),
    env: serverEnv(env),
    events: {
      async publish(event) {
        published.push(event);
        return event;
      }
    },
    fastify: {
      addHook(name, callback) { hooks.push({ name, callback }); },
      get() {}
    },
    http: {
      router: {
        register() {}
      }
    },
    logger: {
      error() {},
      info() {},
      warn() {}
    },
    project,
    uploads: {
      readSingleMultipartFile() {}
    }
  };
}

test("terminals feature declares only named AI-first capabilities", () => {
  assert.equal(Vibe64TerminalsFeature.id, "vibe64.terminals");
  assert.deepEqual(Vibe64TerminalsFeature.provides, {
    terminals: "vibe64.terminals"
  });
  assert.deepEqual(Vibe64TerminalsFeature.requires, {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    uploads: "runtime.uploads",
    actionCatalogue: "runtime.actions"
  });
  assert.equal(Object.hasOwn(Vibe64TerminalsFeature, "register"), false);
});

test("installed host guidance in the env reaches agent context", () => {
  const guidance = "Installed here: vibe64-local update; SSH recovery: sudo vibe64-local restore.";
  const context = createCodexSessionEnvironment({ env: { VIBE64_HOST_AGENT_GUIDANCE: guidance } }).vibe64SessionContextInput();
  assert.equal(context.hostGuidance, guidance);
  assert.equal(Object.hasOwn(createCodexSessionEnvironment({ env: {} }).vibe64SessionContextInput(), "hostGuidance"), false);
});

test("editor namespaces in the env reach Preview routing", () => {
  const origin = (namespace) => previewPublicOriginForLaunch({
    env: { [VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV]: namespace },
    publicHost: "owner.users.example.test", sessionId: "same-cloned-session"
  });
  assert.notEqual(origin("first"), origin("second"));
  assert.equal(origin("first"), origin("first"));
});

test("terminals service creates the direct API from runtime env", async () => {
  await withTemporaryRoot(async (root) => {
    const serviceDataRoot = path.join(root, "services");
    const targetRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    await mkdir(targetRoot, { recursive: true });
    await mkdir(runtimeRoot, { recursive: true });
    const codexToolHomeSource = path.join(root, "codex-tool-home");
    await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
    await writeFile(path.join(codexToolHomeSource, ".codex", "auth.json"), JSON.stringify({
      auth_mode: "api_key",
      OPENAI_API_KEY: "fixture-terminals-provider-key"
    }));
    const terminals = terminalsService({
      codexTerminalController: {
        codexAuthPreflight: failingCodexAuthPreflight,
        codexToolHomeSource
      },
      env: {
        [VIBE64_SERVICE_DATA_ROOT_ENV]: serviceDataRoot
      },
      project: {
        createSessionStore() {
          return {};
        },
        async createRuntime() {
          return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot };
        },
        createRuntimeWithoutSource(options) { return this.createRuntime(options); },
        currentProjectRuntimeRoot() {
          return runtimeRoot;
        },
        currentTargetRoot() {
          return targetRoot;
        },
        async projectExecutionEnvironment() {
          return {};
        },
        async readCurrentProject() {
          return {
            slug: "project"
          };
        },
        async readEnv() {
          return {
            env: {
              records: []
            },
            ok: true
          };
        },
        runInProjectContext(_slug, operation) {
          return operation();
        },
        async saveEnvUserValues() {
          return {
            ok: true
          };
        }
      }
    });

    try {
      const result = await terminals.startGlobalCodexTerminal();
      assert.equal(result.ok, false);
      assert.match(result.error, /test Codex authentication unavailable/u);
      assert.doesNotMatch(result.error, /toolchain|image/u);
    } finally {
      await terminals.close();
    }
  });
});

test("personal Codex access blocks a member before authentication starts", async () => {
  await withTemporaryRoot(async (root) => {
    let authenticationStarts = 0;
    const codexToolHomeSource = path.join(root, "codex-tool-home");
    await mkdir(path.join(codexToolHomeSource, ".codex"), { recursive: true });
    await writeFile(path.join(codexToolHomeSource, ".codex", "auth.json"), JSON.stringify({
      auth_mode: "chatgpt",
      tokens: { account_id: "fixture-owner", access_token: "fixture-owner-access-token" }
    }));
    const runtimeRoot = path.join(root, "runtime");
    const targetRoot = path.join(root, "project");
    await Promise.all([
      mkdir(runtimeRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true })
    ]);
    const terminals = terminalsService({
      codexTerminalController: {
        async codexAuthPreflight() {
          authenticationStarts += 1;
          throw new Error("A member must not reach Codex authentication.");
        },
        codexToolHomeSource
      },
      env: {
        [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services")
      },
      project: {
        createSessionStore() {
          return {};
        },
        async createRuntime() {
          return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot };
        },
        createRuntimeWithoutSource(options) { return this.createRuntime(options); },
        currentProjectRuntimeRoot() {
          return runtimeRoot;
        },
        currentTargetRoot() {
          return targetRoot;
        },
        async readCurrentProject() {
          return { slug: "project" };
        },
        async readEnv() {
          return { env: { records: [] }, ok: true };
        },
        runInProjectContext(_slug, operation) {
          return operation();
        },
        async saveEnvUserValues() {
          return { ok: true };
        }
      }
    });
    try {
      await assert.rejects(
        terminals.startGlobalCodexTerminal({
          vibe64User: { role: "user", username: "member" }
        }),
        (error) => error.code === "vibe64_assistant_owner_required"
      );
      assert.equal(authenticationStarts, 0);
    } finally {
      await terminals.close();
    }
  });
});

test("session source creation holds the project source mutation lock while it reads repository authority", async () => {
  await withTemporaryRoot(async (root) => {
    const targetRoot = path.join(root, "project");
    const runtimeRoot = path.join(root, "runtime");
    await Promise.all([
      mkdir(targetRoot, { recursive: true }),
      mkdir(runtimeRoot, { recursive: true })
    ]);
    let lockHeld = false;
    let lockOptions = null;
    const feature = Vibe64TerminalsFeature;
    const project = {
      createSessionStore() {
        return {};
      },
      async createRuntime() {
        return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot };
      },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() {
        return runtimeRoot;
      },
      currentTargetRoot() {
        return targetRoot;
      },
      async readCurrentProject() {
        assert.equal(lockHeld, true);
        return {
          repository: {
            defaultBranch: "main",
            mode: "managed_git"
          },
          repositoryMode: "managed_git",
          slug: "project"
        };
      },
      async readEnv() {
        return {
          env: {
            records: []
          },
          ok: true
        };
      },
      runInProjectContext(_slug, operation) {
        return operation();
      },
      async runProjectSourceExclusive(operation, options = {}) {
        lockHeld = true;
        lockOptions = options;
        try {
          return await operation();
        } finally {
          lockHeld = false;
        }
      },
      async saveEnvUserValues() {
        return {
          ok: true
        };
      }
    };
    const outputs = await feature.setup(featureDependencies({
      env: {
        [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services")
      },
      project
    }), { profile: "test" });

    await assert.rejects(
      () => outputs.terminals.createSessionSource(),
      {
        code: "vibe64_session_source_context_missing"
      }
    );
    assert.deepEqual(lockOptions, {
      operation: "session-source-create"
    });
    assert.equal(lockHeld, false);
    await feature.shutdown(featureDependencies({ project }), {
      outputs,
      profile: "test"
    });
  });
});

test("terminal events publish direct session and project events without service receipts", async () => {
  const published = [];
  const events = {
    async publish(event) {
      published.push(event);
      return event;
    }
  };
  await createSessionChangedPublisher({ events })("session-1", {
    reason: "output-target-started"
  });
  await createProjectRuntimeChangedPublisher(events)({
    ok: true,
    projectSlug: "dogandgroom",
    runtime: { open: true },
    targetRoot: "/project"
  }, {
    action: "runtime-opened"
  });

  assert.equal(published[0].realtime.event, "vibe64.session.changed");
  assert.equal(published[0].realtime.payload.reason, "output-target-started");
  assert.equal(published[1].realtime.event, "vibe64.project.changed");
  assert.equal(published[1].realtime.payload.reason, "runtime-opened");
  assert.equal(published[1].realtime.payload.action, "runtime-opened");
  assert.equal(Object.hasOwn(published[0], "meta"), false);
  assert.equal(Object.hasOwn(published[1], "meta"), false);
});

test("opening one runtime from multiple tabs publishes only its closed-to-open transition", async () => {
  await withTemporaryRoot(async (root) => {
    const runtimeRoot = path.join(root, "runtime");
    const targetRoot = path.join(root, "project");
    await mkdir(targetRoot, { recursive: true });
    let recovered = 0;
    const project = {
      createSessionStore() { return {}; },
      async createRuntime() { return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot,
        async listSessions() { recovered += 1; return []; } }; },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() { return runtimeRoot; },
      currentTargetRoot() { return targetRoot; },
      async listProjects() { return { ok: true, projects: [{ slug: "project", runtime: { open: true } }] }; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const published = [], hooks = [];
    const dependencies = featureDependencies({
      env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
      project,
      published,
      hooks
    });
    const feature = Vibe64TerminalsFeature;
    const outputs = await feature.setup(dependencies, { profile: "test" });
    try {
      assert.equal(recovered, 0, "feature setup must not recover before catalogue admission is configured");
      await hooks.find(hook => hook.name === "onReady").callback();
      assert.equal(recovered, 0, "recovery does not block Fastify's readiness hook");
      await new Promise(resolve => setImmediate(resolve));
      assert.equal(recovered, 1);
      const reasons = Array.from({ length: 6 }, (_, index) => `tab-${index}`);
      const results = await Promise.all(reasons.map((reason) => (
        outputs.terminals.openProjectRuntime({ reason })
      )));
      assert.ok(results.every((result) => result.ok && result.runtime.open));
      assert.deepEqual(results.map((result) => result.reason), reasons);
      assert.equal(published.length, 1);
      assert.equal(published[0].realtime.payload.reason, "runtime-opened");

      await outputs.terminals.openProjectRuntime({ reason: "tab-reload" });
      assert.equal(published.length, 1);
      assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).reason, "tab-reload");

      await clearProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot });
      await outputs.terminals.openProjectRuntime();
      assert.equal(published.length, 2);
      assert.equal(published[1].realtime.payload.runtime.open, true);
    } finally {
      await feature.shutdown(dependencies, { outputs, profile: "test" });
    }
  });
});

test("terminals feature owns attachment and dormancy startup and shutdown", async () => {
  let cleanupCalls = 0;
  await withTemporaryRoot(async (root) => {
    // Boot prepares the attachment files below the root the server named and its idle-project sweep lists the projects.
    const project = {
      async listProjects() {
        cleanupCalls += 1;
        return { ok: true, projects: [] };
      },
      async listPracticeProjectSlugs() { return []; }
    };
    const dependencies = featureDependencies({
      env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
      project
    });
    const outputs = await Vibe64TerminalsFeature.setup(dependencies, { profile: "test" });
    await Vibe64TerminalsFeature.boot(dependencies, { outputs, profile: "test" });
    const attachmentRoot = codexAttachmentHostRoot({ env: dependencies.env });
    assert.equal((await stat(attachmentRoot)).isDirectory(), true);
    await Vibe64TerminalsFeature.shutdown(dependencies, { outputs, profile: "test" });
  });

  assert.equal(cleanupCalls, 1);
});

test("terminals service shutdown closes every project's services", async () => {
  let closeCalls = 0;
  await withTemporaryRoot(async (root) => {
    const terminals = terminalsService({
      env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
      project: {},
      projectServices: { beginClose() {}, async close() {}, async closeAll() { closeCalls += 1; }, async ensure() {}, opened() {} }
    });
    await terminals.close();
  });
  assert.equal(closeCalls, 1);
});


test("runtime close publisher retains only the bounded original close reason for its exact closed project", async () => {
  const published = [];
  const publish = createProjectRuntimeChangedPublisher({ async publish(event) { published.push(event); return event; } });
  await publish({ ok: true, projectSlug: "outer", runtime: { open: false }, reason: "idle-timeout" }, { action: "runtime-closed", dormant: true });
  assert.equal(published[0].realtime.payload.runtimeCloseReason, "idle-timeout");
  assert.equal(published[0].realtime.payload.runtimeDormantClose, true);
  assert.equal(published[0].realtime.payload.projectSlug, "outer");
  assert.equal(published[0].realtime.payload.reason, "runtime-closed");
  await publish({ ok: true, projectSlug: "outer", runtime: { open: false }, reason: "x".repeat(101) }, { action: "runtime-closed" });
  assert.equal(published[1].realtime.payload.runtimeCloseReason.length, 100);
  assert.equal(Object.hasOwn(published[1].realtime.payload, "runtimeDormantClose"), false);
  await publish({ ok: true, projectSlug: "outer", runtime: { open: true }, reason: "project-open" }, { action: "runtime-opened" });
  assert.equal(Object.hasOwn(published[2].realtime.payload, "runtimeCloseReason"), false);
  await publish({ ok: false, projectSlug: "outer", runtime: { open: false }, reason: "idle-timeout" }, { action: "runtime-closed" });
  assert.equal(published.length, 3);
});


test("original dormancy owner supplies internal close authority while an explicit same-reason Close does not", async () => {
  await withTemporaryRoot(async root => {
    const runtimeRoot = path.join(root, "runtime"), targetRoot = path.join(root, "project");
    await mkdir(targetRoot, { recursive: true });
    const project = {
      createSessionStore() { return {}; },
      async createRuntime() { return { store: { withUnpinnedProject: operation => operation() }, adapter: {}, projectConfig: {}, stateRoot: runtimeRoot, async listSessions() { return []; } }; },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const published = [], dependencies = featureDependencies({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project, published });
    const feature = Vibe64TerminalsFeature, outputs = await feature.setup(dependencies, { profile: "test" });
    try {
      await outputs.terminals.openProjectRuntime();
      const dormant = await outputs.terminals.closeDormantProjectRuntime({ nowMs: Date.now() + 31 * 60 * 1000 });
      assert.equal(dormant.dormant, true); assert.equal(dormant.ok, true);
      const closed = published.find(event => event.realtime.payload.action === "runtime-closed").realtime.payload;
      assert.equal(closed.runtimeDormantClose, true); assert.equal(closed.runtimeCloseReason, "idle-timeout");
      assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, false);
      await outputs.terminals.openProjectRuntime();
      const explicit = await outputs.terminals.closeProjectRuntime({ reason: "idle-timeout", dormant: true });
      assert.equal(explicit.ok, true);
      const explicitClosed = published.filter(event => event.realtime.payload.action === "runtime-closed").at(-1).realtime.payload;
      assert.equal(explicitClosed.runtimeCloseReason, "idle-timeout");
      assert.equal(Object.hasOwn(explicitClosed, "runtimeDormantClose"), false);
    } finally { await feature.shutdown(dependencies, { outputs, profile: "test" }); }
  });
});

test("the dormant sweep closes an idle practice project outside the catalogue", async () => {
  await withTemporaryRoot(async root => {
    const runtimeRoot = path.join(root, "runtime"), targetRoot = path.join(root, "project");
    await mkdir(targetRoot, { recursive: true });
    const contexts = [];
    const project = {
      createSessionStore() { return {}; },
      async createRuntime() { return { store: { withUnpinnedProject: operation => operation() }, adapter: {}, projectConfig: {}, stateRoot: runtimeRoot, async listSessions() { return []; } }; },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
      async listProjects() { return { ok: true, projects: [] }; },
      async listPracticeProjectSlugs() { return ["training-0123abcd"]; },
      async readCurrentProject() { return { slug: "training-0123abcd" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(slug, operation) { contexts.push(slug); return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const dependencies = featureDependencies({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project, published: [] });
    const feature = Vibe64TerminalsFeature, outputs = await feature.setup(dependencies, { profile: "test" });
    try {
      await outputs.terminals.openProjectRuntime();
      const fresh = await outputs.terminals.closeDormantProjectRuntimes({});
      assert.equal(fresh.closedCount, 0);
      assert.equal(fresh.results[0].reason, "not-dormant");
      const swept = await outputs.terminals.closeDormantProjectRuntimes({ nowMs: Date.now() + 31 * 60 * 1000 });
      assert.equal(swept.ok, true); assert.equal(swept.closedCount, 1);
      assert.deepEqual(contexts, ["training-0123abcd", "training-0123abcd"]);
      assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, false);
    } finally { await feature.shutdown(dependencies, { outputs, profile: "test" }); }
  });
});

test("a partial project close restores Preview service admission after services drain", async () => {
  await withTemporaryRoot(async (root) => {
    const runtimeRoot = path.join(root, "runtime");
    const targetRoot = path.join(root, "project");
    await mkdir(targetRoot, { recursive: true });
    const calls = [];
    const projectServices = {
      beginClose() { calls.push("begin-close"); },
      async close() { calls.push("close"); },
      async closeAll() {},
      async ensure() {},
      opened() { calls.push("opened"); }
    };
    const project = {
      createSessionStore() { return {}; },
      async createRuntime() {
        return {
          adapter: {},
          projectConfig: {},
          stateRoot: runtimeRoot,
          store: { withUnpinnedProject: operation => operation() },
          async listSessions() { throw new Error("session inventory unavailable"); }
        };
      },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() { return runtimeRoot; },
      currentTargetRoot() { return targetRoot; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const terminals = terminalsService({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project, projectServices });
    try {
      const result = await terminals.closeProjectRuntime({ reason: "test-partial-close" });
      assert.equal(result.ok, false);
      // Without a project request context the close acts on the global scope,
      // the same scope its terminal namespaces use.
      assert.equal(result.projectSlug, "global");
      assert.equal(result.projectScope, "global");
      assert.match(result.failed[0].error, /session inventory unavailable/u);
      assert.deepEqual(calls, ["begin-close", "close", "opened"]);
    } finally {
      await terminals.close();
    }
  });
});

const claudeSelection = JSON.stringify({ engineId: "claude", agentId: "claude", modelId: "sonnet", modelProviderId: "anthropic",
  variantId: "high", catalogRevision: `sha256:${"a".repeat(64)}` });

function dormancyProject(root, createRuntime) {
  const runtimeRoot = path.join(root, "runtime"), targetRoot = path.join(root, "project");
  return {
    runtimeRoot,
    targetRoot,
    project: {
      createSessionStore() { return {}; },
      createRuntime: () => createRuntime({ runtimeRoot, targetRoot }),
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
      async listProjects() { return { ok: true, projects: [] }; },
      async listPracticeProjectSlugs() { return ["training-0123abcd"]; },
      async readCurrentProject() { return { slug: "training-0123abcd" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    }
  };
}

test("a Claude session whose source was never created blocks no idle close, project Close or archive stop", async () => {
  await withTemporaryRoot(async root => {
    let runtime = null;
    const { project, runtimeRoot, targetRoot } = dormancyProject(root, async ({ runtimeRoot, targetRoot }) => {
      runtime ||= new Vibe64SessionRuntime({
        projectContextRoot: targetRoot,
        projectRuntimeRoot: runtimeRoot,
        promptEnvironment: process.env,
        inspectSourceByDefault: false
      });
      return runtime;
    });
    await mkdir(targetRoot, { recursive: true });
    // A failed clone leaves a blocked session with its selection but no source.
    const created = await project.createRuntime();
    await created.store.createSession({ sessionId: "clone-failed", runtimeKind: "genesis",
      metadata: { assistant_selection: claudeSelection, source_creation_failed: "yes" } });
    await created.store.writeStatus("clone-failed", "blocked");
    const dependencies = featureDependencies({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project });
    const feature = Vibe64TerminalsFeature, outputs = await feature.setup(dependencies, { profile: "test" });
    try {
      await outputs.terminals.openProjectRuntime();
      const idle = await outputs.terminals.closeDormantProjectRuntime({ nowMs: Date.now() + 31 * 60 * 1000 });
      assert.equal(idle.dormant, true, JSON.stringify(idle.failed || idle.closeResult?.failed || idle.reason));
      assert.equal(idle.ok, true, JSON.stringify(idle.closeResult?.failed));
      assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, false);
      await outputs.terminals.openProjectRuntime();
      const closed = await outputs.terminals.closeProjectRuntime({ reason: "project-close" });
      assert.equal(closed.ok, true, JSON.stringify(closed.failed));
      // Archiving stops the session's work the same way before removing it.
      const session = await runtime.getSessionWithoutSource("clone-failed");
      assert.equal(session.sourceReady, false);
      const stopped = await outputs.terminals.closeSessionTerminals("clone-failed", { session, forgetConversationBinding: true });
      assert.equal(stopped.ok, true);
    } finally { await feature.shutdown(dependencies, { outputs, profile: "test" }); }
  });
});

test("an unreadable session keeps an idle project open, named in an operational warning", async () => {
  await withTemporaryRoot(async root => {
    const unreadable = { sessionId: "goal-unreadable", status: "active", sourceReady: false, sourcePath: "",
      metadata: { assistant_goal_intent: "{not json" } };
    const { project, runtimeRoot, targetRoot } = dormancyProject(root, async ({ runtimeRoot }) => ({
      store: { withUnpinnedProject: operation => operation() },
      adapter: {}, projectConfig: {}, stateRoot: runtimeRoot, async listSessions() { return [structuredClone(unreadable)]; }
    }));
    await mkdir(targetRoot, { recursive: true });
    const warnings = [];
    const dependencies = featureDependencies({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project });
    const feature = Vibe64TerminalsFeature, outputs = await feature.setup(dependencies, { profile: "test" });
    const schedule = startProjectRuntimeDormancyCleanupSchedule({
      idleAfterMs: 1, logger: { warn(fields, message) { warnings.push({ fields, message }); } },
      serviceFactory: () => outputs.terminals, setIntervalImpl: () => null, clearIntervalImpl() {}
    });
    try {
      await outputs.terminals.openProjectRuntime();
      await new Promise((resolve) => setTimeout(resolve, 5));
      const sweep = await schedule.runNow();
      assert.equal(sweep.closedCount, 0);
      assert.equal(sweep.results[0].reason, "session-state-unreadable");
      assert.deepEqual(sweep.results[0].failed.map(({ sessionId }) => sessionId), ["goal-unreadable"]);
      assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, true);
      assert.deepEqual(warnings.map(({ fields }) => [fields.event, fields.projectSlug, fields.sessionIds]), [
        ["vibe64.project_runtime.dormant_close_failed", sweep.results[0].projectSlug, ["goal-unreadable"]]
      ]);
    } finally {
      schedule.stop();
      await feature.shutdown(dependencies, { outputs, profile: "test" });
    }
  });
});

test("a pinned project cannot close explicitly or through idle cleanup", async () => {
  await withTemporaryRoot(async root => {
    const runtimeRoot = path.join(root, "runtime"), targetRoot = path.join(root, "project");
    await mkdir(targetRoot, { recursive: true });
    let pinned = true, closed = 0;
    const project = {
      createSessionStore() { return {}; },
      async createRuntime() { return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot,
        store: { async withUnpinnedProject(operation) {
          if (pinned) throw Object.assign(new Error("Unpin first"), { code: "vibe64_project_pinned" });
          return operation();
        } },
        async listSessions() { return pinned ? [{ sessionId: "main", pinnedSessionId: "main" }] : []; }
      }; },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); },
      currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const terminals = terminalsService({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project,
      projectServices: { beginClose() { closed++; }, async close() {}, async closeAll() {}, opened() {}, async ensure() {} } });
    try {
      await terminals.openProjectRuntime();
      await assert.rejects(terminals.closeProjectRuntime(), { code: "vibe64_project_pinned" });
      const idle = await terminals.closeDormantProjectRuntime({ nowMs: Date.now() + 31 * 60 * 1000 });
      assert.equal(idle.skipped, true); assert.equal(idle.reason, "pinned-session");
      assert.equal(closed, 0); assert.equal((await readProjectRuntimeOpenState({ projectRuntimeRoot: runtimeRoot })).open, true);
      pinned = false;
      assert.equal((await terminals.closeProjectRuntime()).ok, true);
      assert.equal(closed, 1);
    } finally { await terminals.close(); }
  });
});
