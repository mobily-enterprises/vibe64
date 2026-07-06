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

test("adapter settings routes preserve Vibe64 user context", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const service = {
        async adapterSettingsActionStatus(actionId, input) {
          calls.push({
            actionId,
            input,
            method: "adapterSettingsActionStatus"
          });
          return {
            ok: true
          };
        },
        async cancelAdapterSettingsAction(actionId, input) {
          calls.push({
            actionId,
            input,
            method: "cancelAdapterSettingsAction"
          });
          return {
            ok: true
          };
        },
        async readAdapterSettings(input) {
          calls.push({
            input,
            method: "readAdapterSettings"
          });
          return {
            ok: true
          };
        },
        async startAdapterSettingsAction(actionId, input) {
          calls.push({
            actionId,
            input,
            method: "startAdapterSettingsAction"
          });
          return {
            ok: true
          };
        },
        async submitAdapterSettingsAction(actionId, stepId, input) {
          calls.push({
            actionId,
            input,
            method: "submitAdapterSettingsAction",
            stepId
          });
          return {
            ok: true
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
        login: "ada"
      };
      const cases = [
        {
          method: "GET",
          path: `${apiRouteBase}/vibe64/adapter-settings`,
          request: {
            input: {
              query: {
                projectType: "jskit"
              }
            }
          }
        },
        {
          method: "GET",
          path: `${apiRouteBase}/vibe64/adapter-settings/actions/:actionId/status`,
          request: {
            input: {
              query: {
                projectType: "jskit"
              }
            },
            params: {
              actionId: "provision-auth"
            }
          }
        },
        {
          method: "POST",
          path: `${apiRouteBase}/vibe64/adapter-settings/actions/:actionId/start`,
          request: {
            body: {
              projectType: "jskit"
            },
            params: {
              actionId: "provision-auth"
            }
          }
        },
        {
          method: "POST",
          path: `${apiRouteBase}/vibe64/adapter-settings/actions/:actionId/steps/:stepId`,
          request: {
            body: {
              payload: {
                token: "token-1"
              },
              projectType: "jskit"
            },
            params: {
              actionId: "provision-auth",
              stepId: "token"
            }
          }
        },
        {
          method: "POST",
          path: `${apiRouteBase}/vibe64/adapter-settings/actions/:actionId/cancel`,
          request: {
            body: {
              projectType: "jskit"
            },
            params: {
              actionId: "provision-auth"
            }
          }
        }
      ];

      for (const testCase of cases) {
        const route = findRegisteredRoute(app, testCase);
        assert.ok(route, `${testCase.method} ${testCase.path}`);
        await route.handler({
          ...testCase.request,
          params: routeProjectParams(testCase.request.params),
          vibe64User
        }, testReply());
      }

      assert.equal(calls.length, cases.length);
      for (const call of calls) {
        assert.deepEqual(call.input.vibe64User, vibe64User);
      }
    });
  });
});
