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
