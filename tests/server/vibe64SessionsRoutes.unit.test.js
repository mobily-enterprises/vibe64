import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_ADVANCE_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_RUN_SESSION_INTENT
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  _testing as coreMaintenanceTesting
} from "@local/vibe64-runtime/server/workflowModules/coreMaintenance";
import { registerRoutes } from "../../packages/vibe64-sessions/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

const maintenanceWorkflowDefinitionIds = coreMaintenanceTesting.workflowDefinitionIds;

test("session creation route forwards the selected workflow definition", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

    const route = findRegisteredRoute(app, {
      method: "POST",
      path: `${apiRouteBase}/vibe64/sessions`
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
      actionId: ACTION_CREATE_SESSION,
      input: {
        workflowDefinition: maintenanceWorkflowDefinitionIds.NON_COMMIT_MAINTENANCE
      }
    });
    });
  });
});

test("session list route forwards the requested archive filter", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

    const route = findRegisteredRoute(app, {
      method: "GET",
      path: `${apiRouteBase}/vibe64/sessions`
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
      params: routeProjectParams(),
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
});

test("session conversation log route forwards the session id", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

    const route = findRegisteredRoute(app, {
      method: "GET",
      path: `${apiRouteBase}/vibe64/sessions/:sessionId/conversation-log`
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      params: routeProjectParams({
        sessionId: "session-1"
      }),
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
        originId: "",
        sessionId: "session-1"
      }
    });
    });
  });
});

test("session advance route forwards the expected step state", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

    const route = findRegisteredRoute(app, {
      method: "POST",
      path: `${apiRouteBase}/vibe64/sessions/:sessionId/advance`
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      input: {
        body: {
          stepId: "plan_and_execute",
          stepStatus: "done"
        }
      },
      params: routeProjectParams({
        sessionId: "session-1"
      }),
      async executeAction(action) {
        executedAction = action;
        return {
          ok: true
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(executedAction, {
      actionId: ACTION_ADVANCE_SESSION,
      input: {
        originId: "",
        sessionId: "session-1",
        stepId: "plan_and_execute",
        stepStatus: "done"
      }
    });
    });
  });
});

test("session intent route forwards the authenticated Vibe64 user", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

    const route = findRegisteredRoute(app, {
      method: "POST",
      path: `${apiRouteBase}/vibe64/sessions/:sessionId/intents/:intentId`
    });
    assert.ok(route);

    let executedAction = null;
    const vibe64User = {
      email: "owner@example.com"
    };
    const reply = testReply();
    await route.handler({
      input: {
        body: {
          fields: {
            accepted: true
          },
          stepId: "implementation_reviewed",
          stepStatus: "done"
        }
      },
      params: routeProjectParams({
        intentId: "accept_changes",
        sessionId: "session-1"
      }),
      vibe64User,
      async executeAction(action) {
        executedAction = action;
        return {
          ok: true
        };
      }
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(executedAction, {
      actionId: ACTION_RUN_SESSION_INTENT,
      input: {
        fields: {
          accepted: true
        },
        intentId: "accept_changes",
        originId: "",
        sessionId: "session-1",
        stepId: "implementation_reviewed",
        stepStatus: "done",
        vibe64User
      }
    });
    });
  });
});
