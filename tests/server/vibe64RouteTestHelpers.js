import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

const TEST_PROJECT_SLUG = "unit_project";

function testRouteApp() {
  const registeredRoutes = [];
  const router = {
    register(method, path, options, handler) {
      registeredRoutes.push({
        handler,
        method,
        options,
        path
      });
    }
  };
  return {
    fastify: {
      get(path, options, handler) {
        registeredRoutes.push({
          handler,
          method: "GET",
          options,
          path
        });
      }
    },
    http: { router },
    registeredRoutes,
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
        currentPracticeProjectScope() {
          return null;
        },
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
  withRouteProject
};
