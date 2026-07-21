import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import { LOCALHOST_CHECK_BYPASS_ENV } from "@local/vibe64-core/server/localhostCheckBypass";

const TEST_PROJECT_SLUG = "unit_project";

function testRouteApp() {
  const registeredRoutes = [];
  return {
    registeredRoutes,
    make(token) {
      if (token === "jskit.fastify") {
        return {
          get(path, options, handler) {
            registeredRoutes.push({
              handler,
              method: "GET",
              options,
              path
            });
          }
        };
      }
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

async function withRouteProject(operation) {
  const projectsRoot = await mkdtemp(path.join(tmpdir(), "vibe64-route-projects-"));
  await mkdir(path.join(projectsRoot, TEST_PROJECT_SLUG), {
    recursive: true
  });
  try {
    await operation({
      apiBase: `/api/app/${TEST_PROJECT_SLUG}`,
      apiRouteBase: "/api/app/:slug",
      projectContext: {
        projectsRoot,
        async readWorkspaceProject({ slug } = {}) {
          return {
            project: {
              path: path.join(projectsRoot, slug)
            },
            projectsRoot
          };
        }
      },
      slug: TEST_PROJECT_SLUG
    });
  } finally {
    await rm(projectsRoot, {
      force: true,
      recursive: true
    });
  }
}

function routeProjectParams(params = {}) {
  return {
    slug: TEST_PROJECT_SLUG,
    ...params
  };
}

export {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
};
