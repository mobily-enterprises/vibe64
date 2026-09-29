import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_LIST_ASSISTANT_CAPABILITIES,
  ACTION_UPDATE_ASSISTANT_MODEL_ACCESS
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  registerRoutes
} from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

test("assistant capability routes forward configured and connected filters", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app.http, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const route = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/assistants/capabilities`
      });
      assert.ok(route);

      let action = null;
      await route.handler({
        executeAction: async (payload) => {
          action = payload;
          return { ok: true };
        },
        input: {
          query: {
            configuredOnly: "true",
            connectedOnly: "true",
            engineId: "opencode",
            limit: "25"
          }
        },
        params: routeProjectParams(),
        vibe64User: { username: "owner" }
      }, testReply());

      assert.equal(action.actionId, ACTION_LIST_ASSISTANT_CAPABILITIES);
      assert.equal(action.input.configuredOnly, "true");
      assert.equal(action.input.connectedOnly, "true");
      assert.equal(action.input.engineId, "opencode");
      assert.equal(action.input.limit, "25");

      const updateRoute = findRegisteredRoute(app, {
        method: "PATCH",
        path: `${apiRouteBase}/vibe64/assistants/model-access`
      });
      assert.ok(updateRoute);
      await updateRoute.handler({
        executeAction: async (payload) => {
          action = payload;
          return { ok: true };
        },
        input: {
          body: {
            engineId: "opencode",
            modelProviderId: "zai",
            unlocked: true,
            vibe64User: { role: "owner", username: "forged" }
          }
        },
        params: routeProjectParams(),
        vibe64User: { role: "owner", username: "ada" }
      }, testReply());

      assert.equal(action.actionId, ACTION_UPDATE_ASSISTANT_MODEL_ACCESS);
      assert.equal(action.input.engineId, "opencode");
      assert.equal(action.input.modelProviderId, "zai");
      assert.equal(action.input.unlocked, true);
      assert.equal(Object.hasOwn(action.input, "vibe64User"), false,
        "the authenticated action context owns identity, never a body-supplied actor");
    });
  });
});
