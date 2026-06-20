import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_READ_ACCOUNTS,
  ACTION_READ_ACCOUNT_AUTH_SESSION,
  ACTION_SAVE_GIT_IDENTITY
} from "../../packages/vibe64-accounts/src/server/actions.js";
import {
  VIBE64_MANAGED_APP_AUTH_SERVICE
} from "../../packages/vibe64-accounts/src/server/managedAppAuthService.js";
import {
  registerManagedAppAuthRoutes
} from "../../packages/vibe64-accounts/src/server/registerManagedAppAuthRoutes.js";
import { registerRoutes } from "../../packages/vibe64-accounts/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("accounts read route omits signed-in user in local editor mode", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/accounts`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        input: {
          query: {}
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            accounts: [],
            ok: true
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_READ_ACCOUNTS,
        input: {}
      });
    });
  });
});

test("managed app auth status route accepts raw query requests without validated input", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      let statusInput = null;
      const routeAppMake = app.make.bind(app);
      app.make = (token) => {
        if (token === VIBE64_MANAGED_APP_AUTH_SERVICE) {
          return {
            async getStatus(input) {
              statusInput = input;
              return {
                ok: true,
                status: "ready"
              };
            }
          };
        }
        return routeAppMake(token);
      };
      registerManagedAppAuthRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64/managed-app-auth",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/managed-app-auth`
      });
      assert.ok(route);

      const reply = testReply();
      await route.handler({
        params: routeProjectParams(),
        query: {
          refresh: "1"
        },
        vibe64User: {
          id: "user-1"
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(reply.payload, {
        ok: true,
        status: "ready"
      });
      assert.deepEqual(statusInput, {
        refresh: "1",
        vibe64User: {
          id: "user-1"
        }
      });
    });
  });
});

test("accounts auth-session route preserves scoped slug params", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/accounts/auth/:sessionId`
      });
      assert.ok(route);

      const paramsValidation = route.options.params.schema.patch(routeProjectParams({
        sessionId: "auth-session-1"
      }));
      assert.deepEqual(paramsValidation.errors, {});
      assert.equal(paramsValidation.validatedObject.slug, "unit_project");
      assert.equal(paramsValidation.validatedObject.sessionId, "auth-session-1");

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        params: routeProjectParams({
          sessionId: "auth-session-1"
        }),
        async executeAction(action) {
          executedAction = action;
          return {
            account: {
              id: "codex"
            },
            id: "auth-session-1",
            ok: true,
            status: "authenticating"
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_READ_ACCOUNT_AUTH_SESSION,
        input: {
          sessionId: "auth-session-1"
        }
      });
    });
  });
});

test("accounts git identity route preserves scoped user input", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64/accounts",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/accounts/git-identity`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        body: {
          gitUserEmail: "tony@example.test",
          gitUserName: "Tony"
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            ok: true
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_GIT_IDENTITY,
        input: {
          gitUserEmail: "tony@example.test",
          gitUserName: "Tony"
        }
      });
    });
  });
});
