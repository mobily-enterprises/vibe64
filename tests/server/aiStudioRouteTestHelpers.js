import assert from "node:assert/strict";

import { LOCALHOST_CHECK_BYPASS_ENV } from "@local/ai-studio-core/server/localhostCheckBypass";

function testRouteApp() {
  const registeredRoutes = [];
  return {
    registeredRoutes,
    make(token) {
      assert.equal(token, "jskit.http.router");
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
  };
}

function findRegisteredRoute(app, {
  method = "",
  path = ""
} = {}) {
  return app.registeredRoutes.find((registeredRoute) => {
    return registeredRoute.method === method && registeredRoute.path === path;
  }) || null;
}

function testReply() {
  return {
    payload: null,
    statusCode: null,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(payload) {
      this.payload = payload;
      return this;
    }
  };
}

async function withLocalRequestBypass(operation) {
  const previousValue = process.env[LOCALHOST_CHECK_BYPASS_ENV];
  process.env[LOCALHOST_CHECK_BYPASS_ENV] = "1";
  try {
    await operation();
  } finally {
    if (previousValue == null) {
      delete process.env[LOCALHOST_CHECK_BYPASS_ENV];
    } else {
      process.env[LOCALHOST_CHECK_BYPASS_ENV] = previousValue;
    }
  }
}

export {
  findRegisteredRoute,
  testReply,
  testRouteApp,
  withLocalRequestBypass
};
