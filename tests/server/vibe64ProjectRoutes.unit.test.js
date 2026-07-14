import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_SAVE_ENV_USER_VALUES
} from "../../packages/vibe64-project/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("Env user value route returns 400 for read-only provider Env writes", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/env/user-values`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        body: {
          environment: "dev",
          values: {
            AUTH_SUPABASE_URL: {
              secret: false,
              value: "https://override.supabase.co"
            }
          }
        },
        input: {
          body: {
            environment: "dev",
            values: {
              AUTH_SUPABASE_URL: {
                secret: false,
                value: "https://override.supabase.co"
              }
            }
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            code: "vibe64_env_value_not_editable",
            error: "AUTH_SUPABASE_URL is not editable as a user Env value.",
            errors: [
              {
                code: "vibe64_env_value_not_editable",
                message: "AUTH_SUPABASE_URL is not editable as a user Env value."
              }
            ],
            ok: false
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 400);
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_ENV_USER_VALUES,
        input: {
          environment: "dev",
          values: {
            AUTH_SUPABASE_URL: {
              secret: false,
              value: "https://override.supabase.co"
            }
          }
        }
      });
    });
  });
});

test("project template routes preserve Vibe64 user context", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const service = {
        async applyProjectTemplate(templateId, input) {
          calls.push({
            input,
            method: "applyProjectTemplate",
            templateId
          });
          return {
            ok: true
          };
        },
        async readProjectTemplates(input) {
          calls.push({
            input,
            method: "readProjectTemplates"
          });
          return {
            ok: true,
            templates: []
          };
        }
      };
      const app = testRouteApp();
      const make = app.make.bind(app);
      app.make = (token) => token === "feature.vibe64-project.service" ? service : make(token);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const vibe64User = {
        login: "ada",
        username: "ada"
      };
      const listRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/project-templates`
      });
      const applyRoute = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/project-templates/:templateId/apply`
      });
      assert.ok(listRoute);
      assert.ok(applyRoute);
      assert.deepEqual(
        applyRoute.options.params.schema.patch(routeProjectParams({
          templateId: "jskit-database"
        })),
        {
          errors: {},
          validatedObject: {
            slug: "unit_project",
            templateId: "jskit-database"
          }
        }
      );

      await listRoute.handler({
        input: {
          query: {}
        },
        params: routeProjectParams(),
        vibe64User
      }, testReply());
      await applyRoute.handler({
        body: {},
        params: routeProjectParams({
          templateId: "jskit-database"
        }),
        vibe64User
      }, testReply());

      assert.deepEqual(calls, [
        {
          input: {
            vibe64User
          },
          method: "readProjectTemplates"
        },
        {
          input: {
            vibe64User
          },
          method: "applyProjectTemplate",
          templateId: "jskit-database"
        }
      ]);
    });
  });
});
