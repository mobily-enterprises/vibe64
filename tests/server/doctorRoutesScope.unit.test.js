import assert from "node:assert/strict";
import test from "node:test";

import {
  registerRoutes as registerProjectSetupRoutes
} from "../../packages/project-setup-doctor/src/server/registerRoutes.js";
import {
  registerRoutes as registerStudioSetupRoutes
} from "../../packages/studio-setup-doctor/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  testRouteApp
} from "./vibe64RouteTestHelpers.js";

test("Studio setup doctor routes are global while project setup remains workspace-scoped", () => {
  const app = testRouteApp();

  registerStudioSetupRoutes(app, {
    routeRelativePath: "studio/studio-setup",
    routeSurface: "app",
    workspaceScoped: false
  });
  registerProjectSetupRoutes(app, {
    routeRelativePath: "studio/project-setup",
    routeSurface: "app"
  });

  assert.ok(findRegisteredRoute(app, {
    method: "GET",
    path: "/api/studio/studio-setup"
  }));
  assert.ok(findRegisteredRoute(app, {
    method: "GET",
    path: "/api/app/:slug/studio/project-setup"
  }));
  assert.equal(findRegisteredRoute(app, {
    method: "GET",
    path: "/api/app/:slug/studio/studio-setup"
  }), null);
});
