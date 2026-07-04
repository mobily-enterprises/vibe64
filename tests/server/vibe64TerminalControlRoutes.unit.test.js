import assert from "node:assert/strict";
import test from "node:test";

import {
  registerRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import {
  ACTION_RUN_PROJECT_TOOL,
  ACTION_START_COMMAND_TERMINAL
} from "../../packages/vibe64-terminals/src/server/actions.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function terminalControlRouteApp(service) {
  const registeredRoutes = [];
  const websocketRoutes = [];
  return {
    registeredRoutes,
    websocketRoutes,
    make(token) {
      if (token === "jskit.http.router") {
        return {
          register(method, path, options, handler) {
            registeredRoutes.push({
              handler,
              method,
              options,
              path
            });
          }
        };
      }
      if (token === "jskit.fastify") {
        return {
          get(path, options, handler) {
            websocketRoutes.push({
              handler,
              options,
              path
            });
          }
        };
      }
      if (token === "feature.vibe64-terminals.service") {
        return service;
      }
      throw new Error(`Unexpected app token: ${token}`);
    }
  };
}

async function runRoute(app, {
  body = {},
  method = "GET",
  path,
  params = {}
} = {}) {
  const route = findRegisteredRoute(app, {
    method,
    path
  });
  assert.ok(route, `Expected route ${method} ${path}`);
  const reply = testReply();
  await route.handler({
    input: {
      body
    },
    params
  }, reply);
  return reply;
}

test("terminal control routes expose snapshot, text checks, exact text, and narrow keys", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const writes = [];
      let output = "ready prompt";
      const createdAt = new Date(Date.now() - 4000).toISOString();
      const service = {
        closeCodexTerminal() {
          return {
            closed: true,
            ok: true
          };
        },
        async readCodexTerminal(_sessionId, terminalSessionId) {
          return {
            commandPreview: "codex",
            createdAt,
            id: terminalSessionId,
            inputVersion: writes.length,
            lastInputAt: "",
            lastOutputAt: createdAt,
            ok: true,
            output,
            outputVersion: 1,
            status: "running"
          };
        },
        async writeCodexTerminal(_sessionId, terminalSessionId, data) {
          writes.push({
            data,
            terminalSessionId
          });
          output += data;
          return this.readCodexTerminal(_sessionId, terminalSessionId);
        }
      };
      const app = terminalControlRouteApp(service);
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      assert.equal(findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/command-terminal/:terminalSessionId/control/text`
      }), null);
      const path = `${apiRouteBase}/vibe64/sessions/:sessionId/codex-terminal/:terminalSessionId`;
      const params = routeProjectParams({
        sessionId: "session-1",
        terminalSessionId: "terminal-1"
      });

    const quiet = await runRoute(app, {
      method: "GET",
      params,
      path: `${path}/control/quiet`
    });
    assert.equal(quiet.statusCode, 200);
    assert.equal(quiet.payload.quiet, true);
    assert.equal(quiet.payload.quietThresholdMs, 3000);

    const check = await runRoute(app, {
      body: {
        text: "ready prompt"
      },
      method: "POST",
      params,
      path: `${path}/control/check-text`
    });
    assert.equal(check.statusCode, 200);
    assert.equal(check.payload.containsText, true);
    assert.equal(check.payload.checkedTextLength, "ready prompt".length);

    const text = await runRoute(app, {
      body: {
        text: "echo hi\n"
      },
      method: "POST",
      params,
      path: `${path}/control/text`
    });
    assert.equal(text.statusCode, 200);
    assert.deepEqual(writes.at(-1), {
      data: "echo hi\n",
      terminalSessionId: "terminal-1"
    });

    const key = await runRoute(app, {
      body: {
        key: "escape"
      },
      method: "POST",
      params,
      path: `${path}/control/key`
    });
    assert.equal(key.statusCode, 200);
    assert.deepEqual(writes.at(-1), {
      data: "\u001b",
      terminalSessionId: "terminal-1"
    });
    });
  });
});

test("terminal action routes use the server Vibe64 user instead of body spoofing", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = terminalControlRouteApp({});
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const serverUser = {
        email: "owner@example.com"
      };
      const spoofedUser = {
        email: "spoof@example.com"
      };
      const cases = [
        {
          actionId: ACTION_START_COMMAND_TERMINAL,
          body: {
            actionId: "unit-command",
            vibe64User: spoofedUser
          },
          expectedInput: {
            actionId: "unit-command",
            sessionId: "session-1",
            vibe64User: serverUser
          },
          params: routeProjectParams({
            sessionId: "session-1"
          }),
          path: `${apiRouteBase}/vibe64/sessions/:sessionId/command-terminal`
        },
        {
          actionId: ACTION_RUN_PROJECT_TOOL,
          body: {
            input: {
              ok: true
            },
            sessionId: "source-session",
            sourcePath: "/runtime/projects/catalog/sessions/active/source-session/source",
            vibe64User: spoofedUser
          },
          expectedInput: {
            input: {
              ok: true
            },
            sessionId: "source-session",
            sourcePath: "/runtime/projects/catalog/sessions/active/source-session/source",
            toolId: "unit-tool",
            vibe64User: serverUser
          },
          params: routeProjectParams({
            toolId: "unit-tool"
          }),
          path: `${apiRouteBase}/vibe64/tools/:toolId/run`
        }
      ];

      for (const entry of cases) {
        const route = findRegisteredRoute(app, {
          method: "POST",
          path: entry.path
        });
        assert.ok(route, `Expected route POST ${entry.path}`);

        let executedAction = null;
        const reply = testReply();
        await route.handler({
          input: {
            body: entry.body
          },
          params: entry.params,
          vibe64User: serverUser,
          async executeAction(action) {
            executedAction = action;
            return {
              ok: true
            };
          }
        }, reply);

        assert.equal(reply.statusCode, 200);
        assert.equal(executedAction.actionId, entry.actionId);
        assert.deepEqual(executedAction.input, entry.expectedInput);
      }
    });
  });
});

test("Codex steer route uses the server Vibe64 user instead of body spoofing", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = terminalControlRouteApp({
        async steerCodexTurn(sessionId, input) {
          calls.push({
            input,
            sessionId
          });
          return {
            ok: true,
            steered: true
          };
        }
      });
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const serverUser = {
        email: "owner@example.com"
      };
      const spoofedUser = {
        email: "spoof@example.com"
      };
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/codex-turn/steer`
      });
      assert.ok(route, "Expected Codex steer route");
      const reply = testReply();

      await route.handler({
        input: {
          body: {
            message: "Please commit and push.",
            vibe64User: spoofedUser
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
            message: "Please commit and push.",
            vibe64User: serverUser
          },
          sessionId: "session-1"
        }
      ]);
    });
  });
});

test("Codex terminal control text uses the server Vibe64 user instead of body spoofing", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = terminalControlRouteApp({
        async writeCodexTerminal(sessionId, terminalSessionId, data, input) {
          calls.push({
            data,
            input,
            sessionId,
            terminalSessionId
          });
          return {
            id: terminalSessionId,
            ok: true,
            output: data,
            status: "running"
          };
        }
      });
      registerRoutes(app, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const serverUser = {
        email: "owner@example.com"
      };
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/codex-terminal/:terminalSessionId/control/text`
      });
      assert.ok(route, "Expected Codex terminal text route");
      const reply = testReply();

      await route.handler({
        input: {
          body: {
            originId: "tab:owner",
            text: "Please push.\r",
            vibe64User: {
              email: "spoof@example.com"
            }
          }
        },
        params: routeProjectParams({
          sessionId: "session-1",
          terminalSessionId: "terminal-1"
        }),
        vibe64User: serverUser
      }, reply);

      assert.equal(reply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          data: "Please push.\r",
          input: {
            originId: "tab:owner",
            sessionId: "session-1",
            terminalSessionId: "terminal-1",
            vibe64User: serverUser
          },
          sessionId: "session-1",
          terminalSessionId: "terminal-1"
        }
      ]);
    });
  });
});
