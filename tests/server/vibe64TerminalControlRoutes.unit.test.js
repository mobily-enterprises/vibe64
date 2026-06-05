import assert from "node:assert/strict";
import test from "node:test";

import {
  registerRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeWorkspaceParams,
  testReply,
  withLocalRequestBypass,
  withRouteWorkspace
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
    await withRouteWorkspace(async ({ apiRouteBase, projectContext }) => {
      const writes = [];
      let output = "ready prompt";
      const createdAt = new Date(Date.now() - 4000).toISOString();
      const service = {
        closeShellTerminal() {
          return {
            closed: true,
            ok: true
          };
        },
        async readShellTerminal(_sessionId, terminalSessionId) {
          return {
            commandPreview: "bash",
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
        async writeShellTerminal(_sessionId, terminalSessionId, data) {
          writes.push({
            data,
            terminalSessionId
          });
          output += data;
          return this.readShellTerminal(_sessionId, terminalSessionId);
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
      const path = `${apiRouteBase}/vibe64/sessions/:sessionId/shell-terminal/:terminalSessionId`;
      const params = routeWorkspaceParams({
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
