import assert from "node:assert/strict";
import {
  mkdtemp,
  rm
} from "node:fs/promises";
import {
  tmpdir
} from "node:os";
import path from "node:path";
import {
  setTimeout as delay
} from "node:timers/promises";
import test from "node:test";

import {
  LOCALHOST_CHECK_BYPASS_ENV
} from "@local/vibe64-core/server/localhostCheckBypass";
import {
  registerServiceOwnedTerminalRoutes
} from "@local/vibe64-core/server/serviceOwnedTerminalRoutes";
import {
  createStudioProjectContext
} from "@local/vibe64-core/server/studioProjectContext";

const SERVICE_ID = "feature.unit-terminal.service";
const SERVICE_UNAVAILABLE = "Unit terminal service is unavailable.";
const METHODS = {
  close: "closePublishTerminal",
  read: "readPublishTerminal",
  resize: "resizePublishTerminal",
  start: "startPublishTerminal",
  subscribe: "subscribePublishTerminal",
  write: "writePublishTerminal"
};

function createRoutes({
  requestBody = (request) => request.body || {},
  routeBase = "/api/app/:slug/vibe64/deployments"
} = {}) {
  const registered = [];
  const routes = {
    routeBase,
    serviceRoute(method, routePath, options, handler) {
      registered.push({
        handler,
        method,
        options,
        path: routePath
      });
    }
  };
  if (requestBody) {
    routes.requestBody = requestBody;
  }
  return {
    registered,
    routes
  };
}

function createFastify() {
  return {
    registered: null,
    get(routePath, options, handler) {
      this.registered = {
        handler,
        options,
        path: routePath
      };
    }
  };
}

function createApp({
  fastify = createFastify(),
  service = {}
} = {}) {
  return {
    fastify,
    make(token) {
      if (token === "jskit.fastify") {
        return fastify;
      }
      if (token === SERVICE_ID) {
        return service;
      }
      throw new Error(`Unknown token ${token}.`);
    }
  };
}

function validOptions(overrides = {}) {
  return {
    basePath: "/publish-terminal",
    methods: METHODS,
    serviceId: SERVICE_ID,
    serviceUnavailableMessage: SERVICE_UNAVAILABLE,
    ...overrides
  };
}

function testSocket() {
  const handlers = {};
  const sent = [];
  return {
    closed: null,
    handlers,
    readyState: 1,
    sent,
    close(code, reason) {
      this.closed = {
        code,
        reason
      };
    },
    on(event, handler) {
      handlers[event] = handler;
    },
    send(payload) {
      sent.push(JSON.parse(payload));
    }
  };
}

async function waitForSocketMessages(socket, count) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    if (socket.sent.length >= count) {
      return;
    }
    await delay(5);
  }
}

async function withProjectRequestContext(callback) {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-service-terminal-routes-"));
  const slug = "alpha_1";
  const projectContext = createStudioProjectContext({
    explicitProjectsRoot: projectsRoot,
    env: {},
    home: projectsRoot
  });
  await projectContext.createWorkspaceProjectRecord({ slug });
  try {
    return await callback({
      projectContext,
      slug
    });
  } finally {
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
}

test("service-owned terminal route helper registers the standard route family", () => {
  const body = {
    type: "object"
  };
  const { registered, routes } = createRoutes();
  const app = createApp();

  registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    body,
    summaries: {
      close: "Close publish terminal.",
      read: "Read publish terminal.",
      start: "Start publish terminal."
    }
  }));

  assert.deepEqual(registered.map((route) => ({
    method: route.method,
    options: route.options,
    path: route.path
  })), [
    {
      method: "POST",
      options: {
        body,
        summary: "Start publish terminal."
      },
      path: "/publish-terminal"
    },
    {
      method: "GET",
      options: {
        statusCode: 200,
        summary: "Read publish terminal."
      },
      path: "/publish-terminal/:terminalSessionId"
    },
    {
      method: "DELETE",
      options: {
        statusCode: 200,
        summary: "Close publish terminal."
      },
      path: "/publish-terminal/:terminalSessionId"
    }
  ]);
  assert.deepEqual(app.fastify.registered, {
    handler: app.fastify.registered.handler,
    options: {
      websocket: true
    },
    path: "/api/app/:slug/vibe64/deployments/publish-terminal/:terminalSessionId/ws"
  });
});

test("service-owned terminal route helper delegates HTTP handlers to configured service methods", async () => {
  const calls = [];
  const service = {
    startPublishTerminal(input) {
      calls.push(["start", input]);
      return {
        ok: true,
        terminalSessionId: "terminal-1"
      };
    },
    readPublishTerminal(terminalSessionId, input) {
      calls.push(["read", terminalSessionId, input]);
      return {
        ok: true,
        terminalSessionId
      };
    },
    closePublishTerminal(terminalSessionId, input) {
      calls.push(["close", terminalSessionId, input]);
      return {
        closed: true,
        ok: true,
        terminalSessionId
      };
    }
  };
  const { registered, routes } = createRoutes();
  const app = createApp();

  registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    buildAccessInput(request) {
      return {
        source: "access",
        user: request.vibe64User?.email || ""
      };
    },
    buildStartInput(request) {
      return {
        body: request.body,
        source: "start",
        user: request.vibe64User?.email || ""
      };
    },
    getService(request) {
      calls.push(["getService", request.params?.terminalSessionId || ""]);
      return service;
    }
  }));

  const request = {
    body: {
      target: "production"
    },
    params: {
      terminalSessionId: "terminal-1"
    },
    vibe64User: {
      email: "owner@example.com"
    }
  };

  assert.deepEqual(await registered[0].handler(request), {
    ok: true,
    terminalSessionId: "terminal-1"
  });
  assert.deepEqual(await registered[1].handler(request), {
    ok: true,
    terminalSessionId: "terminal-1"
  });
  assert.deepEqual(await registered[2].handler(request), {
    closed: true,
    ok: true,
    terminalSessionId: "terminal-1"
  });
  assert.deepEqual(calls, [
    ["getService", "terminal-1"],
    ["start", {
      body: {
        target: "production"
      },
      source: "start",
      user: "owner@example.com"
    }],
    ["getService", "terminal-1"],
    ["read", "terminal-1", {
      source: "access",
      user: "owner@example.com"
    }],
    ["getService", "terminal-1"],
    ["close", "terminal-1", {
      source: "access",
      user: "owner@example.com"
    }]
  ]);
});

test("service-owned terminal route helper defaults start input to routes.requestBody", async () => {
  const { registered, routes } = createRoutes({
    requestBody(request) {
      return {
        normalized: request.body
      };
    }
  });
  const app = createApp({
    service: {
      startPublishTerminal(input) {
        return input;
      }
    }
  });

  registerServiceOwnedTerminalRoutes(app, routes, validOptions());

  assert.deepEqual(await registered[0].handler({
    body: {
      ok: true
    }
  }), {
    normalized: {
      ok: true
    }
  });
});

test("service-owned terminal route helper delegates websocket handlers through app.make", async () => {
  const previousBypass = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  process.env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
  try {
    const calls = [];
    const service = {
      subscribePublishTerminal(terminalSessionId, subscriber, input) {
        calls.push(["subscribe", terminalSessionId, input]);
        subscriber({
          line: "ready",
          type: "terminal.output"
        });
        return {
          terminalSessionId,
          unsubscribe() {
            calls.push(["unsubscribe"]);
          }
        };
      },
      resizePublishTerminal(terminalSessionId, size, input) {
        calls.push(["resize", terminalSessionId, size, input]);
        return {
          ok: true
        };
      },
      writePublishTerminal(terminalSessionId, data, input) {
        calls.push(["write", terminalSessionId, data, input]);
        return {
          ok: true
        };
      }
    };
    const { routes } = createRoutes();
    const app = createApp({
      service
    });

    await withProjectRequestContext(async ({ projectContext, slug }) => {
      registerServiceOwnedTerminalRoutes(app, routes, validOptions({
        buildAccessInput(request) {
          return {
            source: "ws",
            user: request.vibe64User?.email || ""
          };
        },
        getService() {
          throw new Error("HTTP-only getService should not be used for websocket routes.");
        },
        projectContext
      }));

      const socket = testSocket();
      app.fastify.registered.handler(socket, {
        headers: {},
        ip: "10.0.0.8",
        params: {
          slug,
          terminalSessionId: "terminal-1"
        },
        vibe64User: {
          email: "owner@example.com"
        }
      });
      await waitForSocketMessages(socket, 2);

      await socket.handlers.message(Buffer.from(JSON.stringify({
        data: "hello",
        type: "input"
      })));
      await socket.handlers.message(Buffer.from(JSON.stringify({
        cols: 120,
        rows: 40,
        type: "resize"
      })));
      socket.handlers.close();

      assert.deepEqual(socket.sent, [
        {
          line: "ready",
          type: "terminal.output"
        },
        {
          session: {
            terminalSessionId: "terminal-1"
          },
          type: "snapshot"
        }
      ]);
      assert.deepEqual(calls, [
        ["subscribe", "terminal-1", {
          source: "ws",
          user: "owner@example.com"
        }],
        ["write", "terminal-1", "hello", {
          source: "ws",
          user: "owner@example.com"
        }],
        ["resize", "terminal-1", {
          cols: 120,
          rows: 40
        }, {
          source: "ws",
          user: "owner@example.com"
        }],
        ["unsubscribe"]
      ]);
    });
  } finally {
    if (previousBypass == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousBypass;
    }
  }
});

test("service-owned terminal route helper validates registration options", () => {
  const app = createApp();
  const { routes } = createRoutes();

  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    basePath: ""
  })), /requires a basePath/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    basePath: "publish-terminal"
  })), /basePath must start/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    methods: {
      ...METHODS,
      start: ""
    }
  })), /requires methods.start/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    buildAccessInput: null
  })), /buildAccessInput must be a function/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    buildStartInput: "not-a-function"
  })), /buildStartInput must be a function/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    getService: "not-a-function"
  })), /getService must be a function/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    serviceId: ""
  })), /requires a serviceId/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, routes, validOptions({
    serviceUnavailableMessage: ""
  })), /requires a serviceUnavailableMessage/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, {
    routeBase: routes.routeBase
  }, validOptions()), /requires routes.serviceRoute/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, {
    requestBody: routes.requestBody,
    serviceRoute: routes.serviceRoute
  }, validOptions()), /requires routes.routeBase/);
  assert.throws(() => registerServiceOwnedTerminalRoutes(app, createRoutes({
    requestBody: null
  }).routes, validOptions()), /requires routes.requestBody/);
  assert.doesNotThrow(() => registerServiceOwnedTerminalRoutes(app, createRoutes({
    requestBody: null
  }).routes, validOptions({
    buildStartInput: () => ({})
  })));
});

test("service-owned terminal route helper fails clearly when a service method is missing", () => {
  const { registered, routes } = createRoutes();
  const app = createApp({
    service: {}
  });

  registerServiceOwnedTerminalRoutes(app, routes, validOptions());

  assert.throws(() => registered[0].handler({
    body: {}
  }), /Service-owned terminal method "startPublishTerminal" is unavailable/);
});
