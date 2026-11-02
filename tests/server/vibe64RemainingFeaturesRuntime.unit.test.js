import assert from "node:assert/strict";
import test from "node:test";

import { ActionProvider } from "@jskit-ai/kernel/server/actions";
import { Vibe64ActionPolicyProvider } from "@local/vibe64-core/server/Vibe64ActionPolicyProvider";
import {
  createCapabilityRuntime,
  defineProvider
} from "@jskit-ai/kernel/shared/capabilities";

import { CurrentAppFeature } from "../../packages/current-app/src/server/CurrentAppFeature.js";
import { StudioHealthFeature } from "../../packages/studio-health/src/server/StudioHealthFeature.js";
import { Vibe64SourceEditorFeature } from "../../packages/vibe64-source-editor/src/server/Vibe64SourceEditorFeature.js";
import {
  sourceEditorFileCreatedEvent,
  sourceEditorFileSavedEvent
} from "../../packages/vibe64-source-editor/src/server/events.js";
import { Vibe64SystemGraphFeature } from "../../packages/vibe64-system-graph/src/server/Vibe64SystemGraphFeature.js";
import process from "node:process";
import { configureStudioProjectContext } from "@local/vibe64-core/server/studioProjectContext";

// The server configures the Studio project context before any feature reads it.
configureStudioProjectContext({ env: process.env });

function projectApi() {
  return Object.freeze({
    async createRuntime() {
      return {
        async getSession(sessionId) {
          return { sessionId, sourcePath: "", targetRoot: "" };
        },
        getSessionWithoutSource(sessionId) { return this.getSession(sessionId); }
      };
    },
    createRuntimeWithoutSource(options) { return this.createRuntime(options); },
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
      ActionProvider,
      Vibe64ActionPolicyProvider,
      actionObserver,
      CurrentAppFeature,
      StudioHealthFeature,
      Vibe64SourceEditorFeature,
      Vibe64SystemGraphFeature
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
    ...["status.read", "architecture.read", "refresh", "refresh.cancel", "refresh.status",
      "usage.entries.read", "usage.web.read", "usage.function.read", "usage.join"].map((name) => `vibe64.system-graph.${name}`)
  ].sort());
  for (const action of actions.listDefinitions().filter(({ id }) => id.startsWith("vibe64.source-editor."))) {
    assert.equal(action.input.mode, "create");
    assert.equal(action.extensions.assistant.exclude === true,
      !["vibe64.source-editor.integrations.read", "vibe64.source-editor.integrations.providers.read", "vibe64.source-editor.integrations.save", "vibe64.source-editor.integrations.setup"].includes(action.id),
      "Only integration product controls are exposed; source tools belong to coding sessions.");
  }
  // 59 project routes (Health's tool check, the 12 project-shared Files routes and Usage's 4 included). Learning v2: a
  // practice project uses these ordinary project routes, so none is mirrored under /api/learning/:learningAttemptId.
  assert.equal(routes.length, 59);
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
    ["GET", "/system-graph/sessions/:sessionId/refresh/status"],
    ["GET", "/system-graph/sessions/:sessionId/usage/web"],
    ["POST", "/system-graph/sessions/:sessionId/usage/join"]
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

test("source editor builds explicit top-level realtime events", async () => {
  const saved = sourceEditorFileSavedEvent({
    result: {
      fileChange: {
        hash: "hash-1",
        originId: "tab-1",
        path: "src/app.js",
        projectSlug: "example",
        sessionId: "session-1",
        updatedAt: "2026-08-16T00:00:00.000Z"
      },
      ok: true
    }
  });

  assert.equal(sourceEditorFileSavedEvent({ result: { ok: false } }), null);
  assert.equal(saved.entityId, "session-1:src/app.js");
  assert.equal(saved.realtime.event, "vibe64.source-editor.file.changed");
  assert.equal(saved.type, "entity.changed");
  assert.equal(saved.operation, "saved");

  const created = sourceEditorFileCreatedEvent({
    result: {
      fileChange: {
        hash: "hash-2",
        originId: "tab-2",
        path: "src/new.js",
        projectSlug: "example",
        sessionId: "session-1",
        updatedAt: "2026-08-16T00:01:00.000Z"
      },
      ok: true
    }
  });

  assert.equal(created.operation, "created");
  assert.equal(created.entityId, "session-1:src/new.js");
});
