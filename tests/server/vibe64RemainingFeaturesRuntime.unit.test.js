import assert from "node:assert/strict";
import test from "node:test";

import { createActionProvider } from "@jskit-ai/kernel/server/actions";
import {
  createCapabilityRuntime,
  defineProvider
} from "@jskit-ai/kernel/shared/capabilities";

import { CurrentAppProvider } from "../../packages/current-app/src/server/CurrentAppProvider.js";
import { StudioHealthProvider } from "../../packages/studio-health/src/server/StudioHealthProvider.js";
import { Vibe64SourceEditorProvider } from "../../packages/vibe64-source-editor/src/server/Vibe64SourceEditorProvider.js";
import {
  createSourceEditorFileChangedPublisher
} from "../../packages/vibe64-source-editor/src/server/events.js";
import { Vibe64SystemGraphProvider } from "../../packages/vibe64-system-graph/src/server/Vibe64SystemGraphProvider.js";

function projectApi() {
  return Object.freeze({
    async createRuntime() {
      return {
        async getSession(sessionId) {
          return { sessionId, sourcePath: "", targetRoot: "" };
        }
      };
    },
    currentProjectSourceRoot() {
      return "";
    },
    async listProjects() {
      return { ok: true, projects: [] };
    },
    async projectExecutionEnvironment() {
      return {};
    },
    async projectInspectionEnvironment() {
      return {};
    }
  });
}

test("remaining Vibe64 features use named capabilities and register direct routes/actions", async (t) => {
  const routes = [];
  let actions = null;
  let sourceEditor = null;
  const actionObserver = defineProvider({
    id: "test.remaining-feature-actions",
    requires: {
      actionCatalogue: "runtime.actions"
    },
    setup({ actionCatalogue }) {
      actions = actionCatalogue;
      return {};
    }
  });
  const runtime = createCapabilityRuntime({
    providers: [
      createActionProvider(),
      actionObserver,
      CurrentAppProvider,
      StudioHealthProvider,
      Vibe64SourceEditorProvider,
      Vibe64SystemGraphProvider
    ],
    inputs: {
      "runtime.env": {},
      "runtime.events": {
        async publish() {
          return null;
        }
      },
      "runtime.http": {
        router: {
          register(method, path, options, handler) {
            routes.push({ handler, method, options, path });
          }
        }
      },
      "runtime.logger": console,
      "vibe64.connections": {
        async getStatus() {
          return { ok: true, connections: [] };
        }
      },
      "vibe64.project": projectApi(),
      "vibe64.terminals": {
        setSourceEditorProvider(value) { sourceEditor = value; }
      }
    }
  });

  t.after(() => runtime.shutdown());
  await runtime.start();
  assert.equal(typeof sourceEditor.close, "function");

  assert.deepEqual(actions.listDefinitions().map((action) => action.id).sort(), [
    "vibe64.current-app.read",
    "vibe64.studio-health.read",
    "vibe64.studio-health.tools",
    ...[
      "file-areas.read", "file-area.tree", "file-area.file", "file-area.download", "file-area.archive",
      "file-area.upload", "file-area.save", "file-area.rename", "file-area.mkdir", "file-area.delete",
      "file-area.create", "file-area.transfer", "file-area.conflicts",
      "integrations.read", "integrations.providers.read", "integrations.n8n.discover", "integrations.save", "integrations.oauth-client.register", "integrations.setup",
      "tree.read", "files.find", "file.download", "stars.read", "star.set", "search", "path.resolve",
      "explanations.cleanup", "explanation.delete", "explanation.stop",
      "file.read", "file.create", "file.save"
    ].map((name) => `vibe64.source-editor.${name}`),
    ...["status.read", "architecture.read", "refresh", "refresh.cancel", "refresh.status"].map((name) => `vibe64.system-graph.${name}`)
  ].sort());
  for (const action of actions.listDefinitions().filter(({ id }) => id.startsWith("vibe64.source-editor."))) {
    assert.equal(action.input.mode, "create");
    assert.equal(action.extensions.assistant.exclude === true,
      !["vibe64.source-editor.integrations.read", "vibe64.source-editor.integrations.providers.read", "vibe64.source-editor.integrations.save", "vibe64.source-editor.integrations.setup"].includes(action.id),
      "Only integration product controls are exposed; source tools belong to coding sessions.");
  }
  // 55 project routes (Health's tool check and the 12 project-shared Files routes included). Learning v2: a
  // practice project uses these ordinary project routes, so none is mirrored under /api/learning/:learningAttemptId.
  assert.equal(routes.length, 55);
  assert.equal(routes.filter((route) => String(route.path || route.url || "").startsWith("/api/learning/")).length, 0);
  for (const [method, suffix] of [
    ["GET", "/source-editor/download"],
    ["GET", "/source-editor/stars"],
    ["POST", "/source-editor/stars"],
    ["GET", "/sessions/:sessionId/files/:area/archive"],
    ["POST", "/sessions/:sessionId/files/:area/transfer"],
    ["POST", "/project-files/:area/transfer"],
    ["POST", "/sessions/:sessionId/integrations/:integrationId/setup"],
    ["GET", "/sessions/:sessionId/integrations/providers"],
    ["GET", "/system-graph/sessions/:sessionId/architecture"],
    ["POST", "/system-graph/sessions/:sessionId/refresh/cancel"],
    ["GET", "/system-graph/sessions/:sessionId/refresh/status"]
  ]) {
    assert.equal(
      routes.filter((route) => route.method === method && !route.path.startsWith("/api/learning/") && route.path.endsWith(suffix)).length,
      1,
      `${method} ${suffix} must be registered exactly once`
    );
  }
  assert.equal(routes.every((route) => typeof route.handler === "function"), true);
  assert.equal(runtime.diagnostics().capabilityIds.includes("vibe64.current-app"), true);
  assert.equal(runtime.diagnostics().capabilityIds.includes("vibe64.source-editor"), true);
  assert.equal(runtime.diagnostics().capabilityIds.includes("vibe64.studio-health"), true);
  assert.equal(runtime.diagnostics().capabilityIds.includes("vibe64.system-graph"), true);
});

test("source editor publishes explicit top-level realtime events", async () => {
  const published = [];
  const events = {
    async publish(event) {
      published.push(event);
      return event;
    }
  };
  const publishChanged = createSourceEditorFileChangedPublisher(events);

  await publishChanged({
    fileChange: {
      hash: "hash-1",
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "example",
      sessionId: "session-1",
      updatedAt: "2026-08-16T00:00:00.000Z"
    },
    ok: true
  });
  await publishChanged({ ok: false });

  assert.equal(published.length, 1);
  assert.equal(published[0].entityId, "session-1:src/app.js");
  assert.equal(published[0].realtime.event, "vibe64.source-editor.file.changed");
  assert.equal(published.every((event) => event.type === "entity.changed"), true);

  await publishChanged({
    fileChange: {
      hash: "hash-2",
      originId: "tab-2",
      path: "src/new.js",
      projectSlug: "example",
      sessionId: "session-1",
      updatedAt: "2026-08-16T00:01:00.000Z"
    },
    ok: true
  }, {
    operation: "created"
  });

  assert.equal(published[1].operation, "created");
  assert.equal(published[1].entityId, "session-1:src/new.js");
});
