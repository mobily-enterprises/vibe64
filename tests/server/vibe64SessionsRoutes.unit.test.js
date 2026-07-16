import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_ADVANCE_SESSION,
  ACTION_CREATE_SESSION,
  ACTION_INSPECT_SESSION,
  ACTION_LIST_SESSIONS,
  ACTION_READ_SESSION_CONVERSATION_LOG,
  ACTION_REWIND_SESSION,
  ACTION_RUN_SESSION_INTENT,
  ACTION_UPDATE_CURRENT_SESSION
} from "../../packages/vibe64-sessions/src/server/actions.js";
import {
  sessionInspectInputValidator,
  sessionIntentInputValidator,
  sessionRewindInputValidator
} from "../../packages/vibe64-sessions/src/server/inputSchemas.js";
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

test("session list route forwards the logged-in user for creation policy", async () => {
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
      let executedAction = null;
      const vibe64User = {
        username: "merc"
      };
      await route.handler({
        params: routeProjectParams(),
        query: {},
        vibe64User,
        async executeAction(action) {
          executedAction = action;
          return {
            ok: true,
            sessions: []
          };
        }
      }, testReply());

      assert.deepEqual(executedAction, {
        actionId: ACTION_LIST_SESSIONS,
        input: {
          archive: "",
          vibe64User
        }
      });
    });
  });
});

test("current session route forwards the selected session id", async () => {
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
        path: `${apiRouteBase}/vibe64/sessions/current`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        input: {
          body: {
            sessionId: "session-2"
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            ok: true,
            sessionId: "session-2"
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(executedAction, {
        actionId: ACTION_UPDATE_CURRENT_SESSION,
        input: {
          sessionId: "session-2"
        }
      });
    });
  });
});

test("session inspect route forwards composer menu and runtime enrichment requests", async () => {
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
      path: `${apiRouteBase}/vibe64/sessions/:sessionId`
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      input: {
        query: {
          includeComposerMenu: "1",
          includeRuntimeEnrichment: "1",
          projectSlug: "compas-next"
        }
      },
      params: routeProjectParams({
        sessionId: "session-1"
      }),
      query: {
        includeComposerMenu: "1",
        includeRuntimeEnrichment: "1",
        projectSlug: "compas-next"
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
      actionId: ACTION_INSPECT_SESSION,
      input: {
        includeComposerMenu: "1",
        includeRuntimeEnrichment: "1",
        originId: "",
        projectSlug: "compas-next",
        sessionId: "session-1"
      }
    });
    });
  });
});

test("session inspect input accepts project slug for UI sync hydration", () => {
  const result = sessionInspectInputValidator.schema.patch({
    projectSlug: "compas-next",
    sessionId: "session-1"
  });

  assert.deepEqual(result.errors, {});
  assert.equal(result.validatedObject.projectSlug, "compas-next");
  assert.equal(result.validatedObject.sessionId, "session-1");
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
        beforeTurnId: "",
        limit: "",
        originId: "",
        sessionId: "session-1"
      }
    });
    });
  });
});

test("session source-safety route reads repository state without dispatching workflow action", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = testRouteApp();
      const make = app.make.bind(app);
      app.make = (token) => token === "feature.vibe64-sessions.service"
        ? {
            async inspectSessionSourceSafety(sessionId) {
              calls.push(sessionId);
              return {
                ok: true,
                sessionId,
                unsafe: true
              };
            }
          }
        : make(token);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/source-safety`
      });
      assert.ok(route);

      const reply = testReply();
      await route.handler({
        params: routeProjectParams({
          sessionId: "session-1"
        })
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, ["session-1"]);
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

test("session rewind route forwards and validates the origin id", async () => {
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
      path: `${apiRouteBase}/vibe64/sessions/:sessionId/rewind`
    });
    assert.ok(route);

    let executedAction = null;
    const reply = testReply();
    await route.handler({
      input: {
        body: {
          originId: "tab-origin-1",
          stepId: "dependencies_installed"
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
      actionId: ACTION_REWIND_SESSION,
      input: {
        originId: "tab-origin-1",
        sessionId: "session-1",
        stepId: "dependencies_installed"
      }
    });

    const validation = sessionRewindInputValidator.schema.patch(executedAction.input);
    assert.deepEqual(validation.errors, {});
    assert.deepEqual(validation.validatedObject, executedAction.input);
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
        composerSubmissionId: "",
        displayFields: {},
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
    const validation = sessionIntentInputValidator.schema.patch(executedAction.input);
    assert.deepEqual(validation.errors, {});
    assert.deepEqual(validation.validatedObject, executedAction.input);
    });
  });
});

test("assistant message route belongs to sessions and rejects a spoofed Vibe64 user", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = testRouteApp();
      const make = app.make.bind(app);
      app.make = (token) => token === "feature.vibe64-sessions.service"
        ? {
            async sendAgentMessage(sessionId, input) {
              calls.push({
                input,
                sessionId
              });
              return {
                ok: true,
                queued: true
              };
            }
          }
        : make(token);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/agent-message`
      });
      assert.ok(route, "Expected sessions-owned assistant message route");
      const serverUser = {
        email: "owner@example.com"
      };
      const reply = testReply();
      await route.handler({
        input: {
          body: {
            afterSubmissionId: "initial-submission",
            composerSubmissionId: "follow-up-submission",
            message: "Please also inspect the tests.",
            vibe64User: {
              email: "spoof@example.com"
            }
          }
        },
        params: routeProjectParams({
          sessionId: "session-1"
        }),
        vibe64User: serverUser
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          input: {
            afterSubmissionId: "initial-submission",
            composerSubmissionId: "follow-up-submission",
            message: "Please also inspect the tests.",
            vibe64User: serverUser
          },
          sessionId: "session-1"
        }
      ]);
    });
  });
});

test("assistant message cancellation route belongs to sessions and uses the authenticated Vibe64 user", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = testRouteApp();
      const make = app.make.bind(app);
      app.make = (token) => token === "feature.vibe64-sessions.service"
        ? {
            async cancelAgentMessage(sessionId, messageId, input) {
              calls.push({
                input,
                messageId,
                sessionId
              });
              return {
                cancelled: true,
                ok: true
              };
            }
          }
        : make(token);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/agent-message/:messageId/cancel`
      });
      assert.ok(route, "Expected sessions-owned assistant message cancellation route");
      const serverUser = {
        email: "owner@example.com"
      };
      const reply = testReply();
      await route.handler({
        input: {
          body: {
            originId: "browser-1",
            vibe64User: {
              email: "spoof@example.com"
            }
          }
        },
        params: routeProjectParams({
          messageId: "message-1",
          sessionId: "session-1"
        }),
        vibe64User: serverUser
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, [{
        input: {
          originId: "browser-1",
          vibe64User: serverUser
        },
        messageId: "message-1",
        sessionId: "session-1"
      }]);
    });
  });
});

test("assistant interrupt route belongs to sessions and rejects a spoofed Vibe64 user", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = testRouteApp();
      const make = app.make.bind(app);
      app.make = (token) => token === "feature.vibe64-sessions.service"
        ? {
            async interruptAgentTurn(sessionId, input) {
              calls.push({
                input,
                sessionId
              });
              return {
                ok: true,
                queued: true
              };
            }
          }
        : make(token);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/agent-turn/interrupt`
      });
      assert.ok(route, "Expected sessions-owned assistant interrupt route");
      const serverUser = {
        email: "owner@example.com"
      };
      const reply = testReply();
      await route.handler({
        input: {
          body: {
            afterSubmissionId: "initial-submission",
            reason: "user_interrupt",
            vibe64User: {
              email: "spoof@example.com"
            }
          }
        },
        params: routeProjectParams({
          sessionId: "session-1"
        }),
        vibe64User: serverUser
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          input: {
            afterSubmissionId: "initial-submission",
            reason: "user_interrupt",
            vibe64User: serverUser
          },
          sessionId: "session-1"
        }
      ]);
    });
  });
});
