import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";

import {
  VIBE64_SERVICE_DATA_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV,
  VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV,
  VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_PROTOCOL_ENV,
  VIBE64_PUBLIC_USER_DOMAIN_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  createProjectRuntimeChangedPublisher
} from "../../packages/vibe64-terminals/src/server/events.js";
import { createSessionChangedPublisher } from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";
import {
  clearProjectRuntimeOpenState,
  readProjectRuntimeOpenState
} from "../../packages/vibe64-core/src/server/projectRuntimeOpenState.js";
import {
  Vibe64TerminalsProvider,
  createVibe64TerminalsFeature,
  terminalsProviderEnv
} from "../../packages/vibe64-terminals/src/server/Vibe64TerminalsProvider.js";
import { previewPublicOriginForLaunch } from "../../packages/vibe64-terminals/src/server/outputTargetTerminal.js";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-terminals-provider-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

async function failingCodexAuthPreflight() {
  throw new Error("test Codex authentication unavailable");
}

function featureDependencies({ env = {}, project, published = [] } = {}) {
  return {
    actionCatalogue: createActionCatalogue(),
    env,
    events: {
      async publish(event) {
        published.push(event);
        return event;
      }
    },
    fastify: {
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
  assert.equal(Vibe64TerminalsProvider.id, "vibe64.terminals");
  assert.deepEqual(Vibe64TerminalsProvider.provides, {
    terminals: "vibe64.terminals"
  });
  assert.deepEqual(Vibe64TerminalsProvider.requires, {
    env: "runtime.env",
    events: "runtime.events",
    fastify: "runtime.fastify",
    http: "runtime.http",
    logger: "runtime.logger",
    project: "vibe64.project",
    uploads: "runtime.uploads",
    actionCatalogue: "runtime.actions"
  });
  assert.equal(Object.hasOwn(Vibe64TerminalsProvider, "register"), false);
});

test("terminals provider overlays only live preview routing values", () => {
  assert.deepEqual(terminalsProviderEnv({
    [VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV]: "stale.example.test",
    KEEP_ME: "runtime",
    SECRET_VALUE: "runtime-secret"
  }, {
    [VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV]: "previews.users.localhost:4000",
    [VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV]: "editor-one",
    [VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_USER_DOMAIN_ENV]: "users.localhost:4000",
    SECRET_VALUE: "live-secret"
  }), {
    [VIBE64_PREVIEW_PUBLIC_DOMAIN_ENV]: "previews.users.localhost:4000",
    [VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV]: "editor-one",
    [VIBE64_PREVIEW_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_PROTOCOL_ENV]: "http",
    [VIBE64_PUBLIC_USER_DOMAIN_ENV]: "users.localhost:4000",
    KEEP_ME: "runtime",
    SECRET_VALUE: "runtime-secret"
  });
});

test("live editor namespaces reach Preview routing through the runtime environment filter", () => {
  const origin = (namespace) => previewPublicOriginForLaunch({
    env: terminalsProviderEnv({}, { [VIBE64_PREVIEW_PUBLIC_NAMESPACE_ENV]: namespace }),
    publicHost: "owner.users.example.test", sessionId: "same-cloned-session"
  });
  assert.notEqual(origin("first"), origin("second"));
  assert.equal(origin("first"), origin("first"));
});

test("terminals feature creates the direct API from runtime env", async () => {
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
    const feature = createVibe64TerminalsFeature({
      codexTerminalController: {
        codexAuthPreflight: failingCodexAuthPreflight,
        codexToolHomeSource
      }
    });
    const outputs = await feature.setup(featureDependencies({
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
        currentProjectRuntimeRoot() {
          return runtimeRoot;
        },
        currentTargetRoot() {
          return targetRoot;
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
    }), { profile: "test" });

    try {
      assert.equal(typeof outputs.terminals.setProductionEnvironmentProvider, "function");
      const result = await outputs.terminals.startGlobalCodexTerminal();
      assert.equal(result.ok, false);
      assert.match(result.error, /test Codex authentication unavailable/u);
      assert.doesNotMatch(result.error, /toolchain|image/u);
    } finally {
      await feature.shutdown(featureDependencies({ project: {} }), {
        outputs,
        profile: "test"
      });
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
    const feature = createVibe64TerminalsFeature({
      codexTerminalController: {
        async codexAuthPreflight() {
          authenticationStarts += 1;
          throw new Error("A member must not reach Codex authentication.");
        },
        codexToolHomeSource
      }
    });
    const runtimeRoot = path.join(root, "runtime");
    const targetRoot = path.join(root, "project");
    await Promise.all([
      mkdir(runtimeRoot, { recursive: true }),
      mkdir(targetRoot, { recursive: true })
    ]);
    const outputs = await feature.setup(featureDependencies({
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
    }), { profile: "test" });
    try {
      await assert.rejects(
        outputs.terminals.startGlobalCodexTerminal({
          vibe64User: { role: "user", username: "member" }
        }),
        (error) => error.code === "vibe64_assistant_owner_required"
      );
      assert.equal(authenticationStarts, 0);
    } finally {
      await feature.shutdown(featureDependencies({ project: {} }), {
        outputs,
        profile: "test"
      });
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
    const feature = createVibe64TerminalsFeature({
      codexTerminalController: {
        codexAuthPreflight: failingCodexAuthPreflight
      }
    });
    const project = {
      createSessionStore() {
        return {};
      },
      async createRuntime() {
        return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot };
      },
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
  await createSessionChangedPublisher(events)("session-1", {
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
    const project = {
      createSessionStore() { return {}; },
      async createRuntime() { return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot }; },
      currentProjectRuntimeRoot() { return runtimeRoot; },
      currentTargetRoot() { return targetRoot; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const published = [];
    const dependencies = featureDependencies({
      env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
      project,
      published
    });
    const feature = createVibe64TerminalsFeature();
    const outputs = await feature.setup(dependencies, { profile: "test" });
    try {
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
  const attachmentRoot = await mkdtemp(path.join(os.tmpdir(), "vibe64-terminals-provider-attachments-"));
  let closeCalls = 0;
  let cleanupCalls = 0;
  const terminals = {
    async close() {
      closeCalls += 1;
    },
    async closeDormantProjectRuntimes() {
      cleanupCalls += 1;
      return { closedCount: 0, failed: [], ok: true, projectCount: 0 };
    }
  };
  const feature = createVibe64TerminalsFeature();
  const dependencies = {
    env: {
      VIBE64_CODEX_ATTACHMENTS_ROOT: attachmentRoot
    },
    logger: {
      error() {},
      info() {},
      warn() {}
    }
  };
  try {
    await feature.boot(dependencies, { outputs: { terminals }, profile: "test" });
    await feature.shutdown(dependencies, { outputs: { terminals }, profile: "test" });
  } finally {
    await rm(attachmentRoot, { force: true, recursive: true });
  }

  assert.equal(cleanupCalls, 1);
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
      async createRuntime() { return { adapter: {}, projectConfig: {}, stateRoot: runtimeRoot, async listSessions() { return []; } }; },
      currentProjectRuntimeRoot() { return runtimeRoot; }, currentTargetRoot() { return targetRoot; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const published = [], dependencies = featureDependencies({ env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") }, project, published });
    const feature = createVibe64TerminalsFeature(), outputs = await feature.setup(dependencies, { profile: "test" });
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
          async listSessions() { throw new Error("session inventory unavailable"); }
        };
      },
      currentProjectRuntimeRoot() { return runtimeRoot; },
      currentTargetRoot() { return targetRoot; },
      async readCurrentProject() { return { slug: "project" }; },
      async readEnv() { return { env: { records: [] }, ok: true }; },
      runInProjectContext(_slug, operation) { return operation(); },
      async saveEnvUserValues() { return { ok: true }; }
    };
    const dependencies = featureDependencies({
      env: { [VIBE64_SERVICE_DATA_ROOT_ENV]: path.join(root, "services") },
      project
    });
    const feature = createVibe64TerminalsFeature({ projectServices });
    const outputs = await feature.setup(dependencies, { profile: "test" });
    try {
      const result = await outputs.terminals.closeProjectRuntime({ reason: "test-partial-close" });
      assert.equal(result.ok, false);
      assert.match(result.failed[0].error, /session inventory unavailable/u);
      assert.deepEqual(calls, ["begin-close", "close", "opened"]);
    } finally {
      await feature.shutdown(dependencies, { outputs, profile: "test" });
    }
  });
});
