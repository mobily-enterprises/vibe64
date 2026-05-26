import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_CREATE_SESSION,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG
} from "../../packages/ai-studio-sessions/src/server/actions.js";
import {
  _testing as coreMaintenanceTesting
} from "@local/ai-studio-runtime/server/workflowModules/coreMaintenance";
import { registerRoutes } from "../../packages/ai-studio-sessions/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  testReply,
  testRouteApp,
  withLocalRequestBypass
} from "./aiStudioRouteTestHelpers.js";

const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;

test("session creation route forwards the selected workflow definition", async () => {
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
          workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
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
        workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
      }
    });
  });
});

test("session list route forwards the requested archive filter", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    registerRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home"
    });

    const route = findRegisteredRoute(app, {
      method: "GET",
      path: "/api/ai-studio/sessions"
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      input: {
        query: {
          archive: "abandoned"
        }
      },
      query: {
        archive: "abandoned"
      },
      async executeAction(action) {
        executedAction = action;
        return {
          ok: true,
          sessions: []
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(executedAction, {
      actionId: ACTION_LIST_SESSIONS,
      input: {
        archive: "abandoned"
      }
    });
  });
});

test("session conversation log route forwards the session id", async () => {
  await withLocalRequestBypass(async () => {
    const app = testRouteApp();
    registerRoutes(app, {
      routeRelativePath: "ai-studio",
      routeSurface: "home"
    });

    const route = findRegisteredRoute(app, {
      method: "GET",
      path: "/api/ai-studio/sessions/:sessionId/conversation-log"
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      params: {
        sessionId: "session-1"
      },
      async executeAction(action) {
        executedAction = action;
        return {
          conversationLog: [],
          ok: true
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(executedAction, {
      actionId: ACTION_READ_SESSION_CONVERSATION_LOG,
      input: {
        sessionId: "session-1"
      }
    });
  });
});
