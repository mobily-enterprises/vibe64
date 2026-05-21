import assert from "node:assert/strict";
import test from "node:test";

import { AI_STUDIO_WORKFLOW_PROFILE_IDS } from "../../server/lib/aiStudio/index.js";
import { ACTION_CREATE_SESSION } from "../../packages/ai-studio-sessions/src/server/actions.js";
import { registerRoutes } from "../../packages/ai-studio-sessions/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./aiStudioRouteTestHelpers.js";

test("session creation route forwards the selected workflow profile", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    registerRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home"
    });

    const route = findRegisteredRoute(app, {
      method: "POST",
      path: "/api/ai-studio/sessions"
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      input: {
        body: {
          workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
        }
      },
      async executeAction(action) {
        executedAction = action;
        return {
          ok: true
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(executedAction, {
      actionId: ACTION_CREATE_SESSION,
      input: {
        workflowProfile: AI_STUDIO_WORKFLOW_PROFILE_IDS.NON_COMMIT_MAINTENANCE
      }
    });
  });
});
