import assert from "node:assert/strict";
import test from "node:test";
import { createSessionActions } from "../../packages/vibe64-sessions/src/server/actions.js";
import { registerRoutes as registerProjectRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import { createProjectActions } from "../../packages/vibe64-project/src/server/actions.js";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/actions.js";
import { createDatabaseActions } from "../../packages/vibe64-database-tools/src/server/actions.js";
import { registerRoutes as registerDatabaseRoutes } from "../../packages/vibe64-database-tools/src/server/registerRoutes.js";
import { createSystemGraphActions } from "../../packages/vibe64-system-graph/src/server/actions.js";
import { registerRoutes as registerSystemGraphRoutes } from "../../packages/vibe64-system-graph/src/server/registerRoutes.js";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

// Learning v2: a lesson's practice project is an ordinary project, so its
// Dashboard (Files, Database, Architecture, Env, Output) uses only the ordinary
// project routes. No Dashboard action keeps a lesson-scoped access level and
// a lesson attempt identity cannot reach any of them.
test("practice Dashboard actions have no lesson access and refuse a lesson attempt identity", async () => {
  const dashboard = [...createProjectActions({ project: {} }), ...createSourceEditorActions({ sourceEditor: {} }),
    ...createDatabaseActions({ databaseTools: {} }), ...createSystemGraphActions({ systemGraph: {} }),
    ...createTerminalActions({ terminals: {} }).filter(action => /output|preview-identity/u.test(action.id))];
  assert.ok(dashboard.length > 40);
  assert.deepEqual(dashboard.filter(action => action.extensions.vibe64.learningAccess).map(action => action.id), []);
  const sessions = createSessionActions({ sessions: {} });
  assert.ok(sessions.some(action => action.extensions.vibe64.learningAccess), "source-less lessons keep their session access until F2");
  const env = dashboard.find(action => action.id === "vibe64.project.env.read");
  await assert.rejects(env.execute({ environment: "dev", learningAttemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" },
    { vibe64Action: { user: { uid: 42 }, learning: { learningScope: { attemptId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" } } } }),
  { code: "vibe64_learning_authority_required" });
});

test("ordinary Dashboard routes register no lesson URLs", () => {
  const app = testRouteApp();
  registerProjectRoutes(app.http, { routeSurface: "app" });
  registerDatabaseRoutes(app.http, { routeSurface: "app" });
  registerSystemGraphRoutes(app.http, { routeSurface: "app" });
  assert.ok(app.registeredRoutes.length > 0);
  assert.equal(app.registeredRoutes.some(route => route.path.startsWith("/api/learning/")), false);
});
