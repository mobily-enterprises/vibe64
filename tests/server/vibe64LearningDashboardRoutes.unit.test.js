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

// Learning v2: a lesson's practice project is an ordinary project in the
// learning space, so its Dashboard (Files, Database, Architecture, Env,
// Output) and its sessions use only the ordinary project routes. No action
// keeps a lesson-scoped access level (source-less lesson sessions are retired).
test("practice Dashboard and session actions have no lesson access", () => {
  const dashboard = [...createProjectActions({ project: {} }), ...createSourceEditorActions({ sourceEditor: {} }),
    ...createDatabaseActions({ databaseTools: {} }), ...createSystemGraphActions({ systemGraph: {} }),
    ...createTerminalActions({ terminals: {} }).filter(action => /output|preview-identity/u.test(action.id)),
    ...createSessionActions({ sessions: {} })];
  assert.ok(dashboard.length > 40);
  assert.deepEqual(dashboard.filter(action => action.extensions.vibe64.learningAccess).map(action => action.id), []);
});

test("ordinary Dashboard routes register no lesson URLs", () => {
  const app = testRouteApp();
  registerProjectRoutes(app.http, { routeSurface: "app" });
  registerDatabaseRoutes(app.http, { routeSurface: "app" });
  registerSystemGraphRoutes(app.http, { routeSurface: "app" });
  assert.ok(app.registeredRoutes.length > 0);
  assert.equal(app.registeredRoutes.some(route => route.path.startsWith("/api/learning/")), false);
});
