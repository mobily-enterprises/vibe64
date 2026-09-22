import assert from "node:assert/strict";
import test from "node:test";

import {
  ACTION_READ_ENGINEERING_SETTINGS,
  ACTION_READ_PROJECT_SETTINGS,
  ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
  ACTION_SAVE_COLLABORATION_SETTINGS,
  ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
  ACTION_SAVE_ENV_USER_VALUES,
  ACTION_SAVE_ENGINEERING_PROFILE,
  ACTION_SAVE_PROJECT_PROMPT_HINTS,
  ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES
} from "../../packages/vibe64-project/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-project/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

function routeHttp(app) {
  return app.http;
}

test("issue routes preserve repeated label filters and browser origin with the authenticated GitHub actor", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      let received;
      registerRoutes(routeHttp(app), {
        projectContext,
        project: { async githubIssues(input) { received = input; return { ok: true }; } },
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const route = findRegisteredRoute(app, {
        method: "POST", path: `${apiRouteBase}/vibe64/issues/:number/comments`
      });
      const user = { id: "viewer", role: "member" };
      const body = {
        body: "A comment", originId: "tab:writer", operation: "create",
        number: 99, repository: "another/project", vibe64User: { id: "forged" }
      };
      const reply = testReply();
      await route.handler({
        body, input: { body }, params: routeProjectParams({ number: "42" }), vibe64User: user
      }, reply);
      assert.equal(reply.statusCode, 200);
      assert.deepEqual(received, {
        body: "A comment", originId: "tab:writer", operation: "comment", number: "42", vibe64User: user
      });
      const list = findRegisteredRoute(app, {
        method: "GET", path: `${apiRouteBase}/vibe64/issues`
      });
      const query = {
        labels: ["bug", "help wanted"], state: "closed", cursor: "after-1000", search: "layout",
        operation: "set-labels", vibe64User: { id: "forged" }
      };
      await list.handler({ query, input: { query }, params: routeProjectParams(), vibe64User: user }, testReply());
      assert.deepEqual(received, { ...query, operation: "list", vibe64User: user });
      const createLabel = findRegisteredRoute(app, {
        method: "POST", path: `${apiRouteBase}/vibe64/issue-labels`
      });
      const labelBody = { name: "Ready", color: "0075ca", repository: "another/project", operation: "set-labels", vibe64User: { id: "forged" } };
      await createLabel.handler({ body: labelBody, input: { body: labelBody }, params: routeProjectParams(), vibe64User: user }, testReply());
      assert.deepEqual(received, { name: "Ready", color: "0075ca", operation: "create-label", vibe64User: user });
    });
  });
});

test("issue editing routes bind identifiers and credentials to the authorized request", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      let received;
      registerRoutes(routeHttp(app), {
        projectContext, routeRelativePath: "vibe64", routeSurface: "app",
        project: { async githubIssues(input) { received = input; return { ok: true }; } }
      });
      const user = { id: "viewer", role: "member" };
      for (const [method, path, body, expected] of [
        ["PUT", "/issues/:number", { title: "Revised", body: "Description" }, { operation: "edit", title: "Revised", body: "Description" }],
        ["PATCH", "/issues/:number/comments/:commentId", { body: "Revised comment" }, { operation: "edit-comment", commentId: "IC_actual", body: "Revised comment" }],
        ["PUT", "/issues/:number/labels", { labels: ["bug"], labelMode: "add" }, { operation: "set-labels", labels: ["bug"], labelMode: "add" }]
      ]) {
        const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${path}` });
        const payload = { ...body, number: 999, commentId: "forged", operation: "create", vibe64User: { id: "forged" } };
        const reply = testReply();
        await route.handler({ body: payload, input: { body: payload }, params: routeProjectParams({ number: "42", commentId: "IC_actual" }), vibe64User: user }, reply);
        assert.equal(reply.statusCode, 200);
        assert.deepEqual(received, { ...expected, number: "42", vibe64User: user });
      }
    });
  });
});

test("project settings routes own the development database choice outside Env", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const readRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/settings`
      });
      const saveRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/settings/development-database`
      });
      assert.ok(readRoute);
      assert.ok(saveRoute);
      assert.equal(findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/env/development-database`
      }), null);
      assert.deepEqual(saveRoute.options.body.schema.patch({ scope: "project" }), {
        errors: {},
        validatedObject: {
          scope: "project"
        }
      });
      const calls = [];
      const executeAction = async (action) => {
        calls.push(action);
        return { ok: true };
      };
      await readRoute.handler({
        input: {
          query: {}
        },
        params: routeProjectParams(),
        executeAction
      }, testReply());
      await saveRoute.handler({
        body: {
          scope: "project"
        },
        input: {
          body: {
            scope: "project"
          }
        },
        params: routeProjectParams(),
        executeAction
      }, testReply());
      assert.deepEqual(calls, [
        {
          actionId: ACTION_READ_PROJECT_SETTINGS,
          input: {}
        },
        {
          actionId: ACTION_SAVE_DEVELOPMENT_DATABASE_SCOPE,
          input: {
            scope: "project"
          }
        }
      ]);
    });
  });
});

test("engineering settings routes carry the profile and session source identity", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const readRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/settings/engineering`
      });
      const saveRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/settings/engineering`
      });
      assert.ok(readRoute);
      assert.ok(saveRoute);
      assert.deepEqual(readRoute.options.query.schema.patch({ sessionId: "session-a" }), {
        errors: {},
        validatedObject: { sessionId: "session-a" }
      });
      assert.deepEqual(saveRoute.options.body.schema.patch({
        profile: "durable.v1",
        sessionId: "session-a"
      }), {
        errors: {},
        validatedObject: {
          profile: "durable.v1",
          sessionId: "session-a"
        }
      });
      const calls = [];
      const executeAction = async (action) => {
        calls.push(action);
        return { ok: true };
      };
      await readRoute.handler({
        input: {
          query: { sessionId: "session-a" }
        },
        params: routeProjectParams(),
        query: { sessionId: "session-a" },
        executeAction
      }, testReply());
      await saveRoute.handler({
        body: {
          profile: "durable.v1",
          sessionId: "session-a"
        },
        input: {
          body: {
            profile: "durable.v1",
            sessionId: "session-a"
          }
        },
        params: routeProjectParams(),
        executeAction
      }, testReply());

      assert.deepEqual(calls, [
        {
          actionId: ACTION_READ_ENGINEERING_SETTINGS,
          input: { sessionId: "session-a" }
        },
        {
          actionId: ACTION_SAVE_ENGINEERING_PROFILE,
          input: {
            profile: "durable.v1",
            sessionId: "session-a"
          }
        }
      ]);
    });
  });
});

test("collaboration and prompt-hint settings use separate routes and actions", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const collaborationRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/settings/collaboration`
      });
      const promptHintsRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/settings/prompt-hints`
      });
      assert.ok(collaborationRoute);
      assert.ok(promptHintsRoute);
      const collaboration = {
        experience: "comfortable",
        explanationStyle: "concise",
        requirements: "Keep answers practical.",
        responseLength: "concise",
        tone: "encouraging"
      };
      assert.deepEqual(collaborationRoute.options.body.schema.patch(collaboration), {
        errors: {},
        validatedObject: collaboration
      });
      for (const length of [500, 501]) {
        const requirements = "🌱".repeat(length);
        assert.deepEqual(collaborationRoute.options.body.schema.patch({
          ...collaboration,
          requirements
        }), {
          errors: {},
          validatedObject: {
            ...collaboration,
            requirements
          }
        });
      }
      assert.deepEqual(collaborationRoute.options.body.schema.patch({
        ...collaboration,
        tone: "sarcastic"
      }), {
        errors: {},
        validatedObject: {
          ...collaboration,
          tone: "sarcastic"
        }
      });
      const vibe64User = {
        role: "owner",
        username: "ada"
      };
      let executedAction = null;
      const reply = testReply();
      await collaborationRoute.handler({
        body: collaboration,
        input: { body: collaboration },
        params: routeProjectParams(),
        vibe64User,
        async executeAction(action) {
          executedAction = action;
          return {
            collaboration,
            ok: true
          };
        }
      }, reply);

      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_COLLABORATION_SETTINGS,
        input: {
          ...collaboration,
          vibe64User
        }
      });
      assert.equal(reply.statusCode, 200);

      executedAction = null;
      await promptHintsRoute.handler({
        body: { promptHints: false },
        input: { body: { promptHints: false } },
        params: routeProjectParams(),
        vibe64User,
        async executeAction(action) {
          executedAction = action;
          return { ok: true, promptHints: { canEdit: true, enabled: false } };
        }
      }, testReply());
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_PROJECT_PROMPT_HINTS,
        input: {
          promptHints: false,
          vibe64User
        }
      });

      const deniedReply = testReply();
      const member = { role: "member", username: "grace" };
      const forgedOwnerInput = {
        ...collaboration,
        sessionId: "selected-session",
        vibe64User
      };
      await collaborationRoute.handler({
        body: forgedOwnerInput,
        input: { body: forgedOwnerInput },
        params: routeProjectParams(),
        vibe64User: member,
        async executeAction(action) {
          assert.deepEqual(action, {
            actionId: ACTION_SAVE_COLLABORATION_SETTINGS,
            input: { ...forgedOwnerInput, vibe64User: member }
          });
          return {
            code: "vibe64_owner_required",
            errors: [{
              code: "vibe64_owner_required",
              message: "Only the owner can change AI behaviour."
            }],
            ok: false
          };
        }
      }, deniedReply);
      assert.equal(deniedReply.statusCode, 403);
    });
  });
});

test("Env user value route returns 400 for read-only provider Env writes", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const route = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/env/user-values`
      });
      assert.ok(route);

      let executedAction = null;
      const reply = testReply();
      await route.handler({
        body: {
          environment: "dev",
          values: {
            AUTH_SUPABASE_URL: {
              secret: false,
              value: "https://override.supabase.co"
            }
          }
        },
        input: {
          body: {
            environment: "dev",
            values: {
              AUTH_SUPABASE_URL: {
                secret: false,
                value: "https://override.supabase.co"
              }
            }
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          executedAction = action;
          return {
            code: "vibe64_env_value_not_editable",
            error: "AUTH_SUPABASE_URL is not editable as a user Env value.",
            errors: [
              {
                code: "vibe64_env_value_not_editable",
                message: "AUTH_SUPABASE_URL is not editable as a user Env value."
              }
            ],
            ok: false
          };
        }
      }, reply);

      assert.equal(reply.statusCode, 400);
      assert.deepEqual(executedAction, {
        actionId: ACTION_SAVE_ENV_USER_VALUES,
        input: {
          environment: "dev",
          values: {
            AUTH_SUPABASE_URL: {
              secret: false,
              value: "https://override.supabase.co"
            }
          }
        }
      });
    });
  });
});

test("Env reveal returns one uncached secret through the project service", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        project: {
          async revealEnvSecret(input) {
            calls.push(input);
            return {
              key: input.key,
              ok: true,
              value: "private"
            };
          }
        },
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/env/reveal`
      });
      assert.ok(route);
      const headers = {};
      const reply = {
        ...testReply(),
        header(key, value) {
          headers[key] = value;
          return this;
        }
      };

      await route.handler({
        body: {
          environment: "dev",
          key: "DB_PASSWORD",
          sessionId: "session-1"
        },
        input: {
          body: {
            environment: "dev",
            key: "DB_PASSWORD",
            sessionId: "session-1"
          }
        },
        params: routeProjectParams(),
        vibe64User: {
          role: "owner",
          username: "owner"
        }
      }, reply);

      assert.deepEqual(calls, [{
        environment: "dev",
        key: "DB_PASSWORD",
        sessionId: "session-1",
        vibe64User: {
          role: "owner",
          username: "owner"
        }
      }]);
      assert.deepEqual(headers, {
        "cache-control": "no-store",
        pragma: "no-cache"
      });
      assert.equal(reply.statusCode, 200);
      assert.equal(reply.payload.value, "private");
    });
  });
});

test("managed app identity routes preserve the selected project source", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const identities = [{
        name: "admin",
        type: "email",
        value: "admin@example.test"
      }];
      const app = testRouteApp();
      registerRoutes(routeHttp(app), {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app"
      });

      const readRoute = findRegisteredRoute(app, {
        method: "GET",
        path: `${apiRouteBase}/vibe64/preview-identities`
      });
      const saveRoute = findRegisteredRoute(app, {
        method: "PUT",
        path: `${apiRouteBase}/vibe64/preview-identities`
      });
      assert.ok(readRoute);
      assert.ok(saveRoute);
      assert.deepEqual(readRoute.options.query.schema.patch({
        sessionId: "session-1"
      }), {
        errors: {},
        validatedObject: {
          sessionId: "session-1"
        }
      });
      assert.deepEqual(saveRoute.options.body.schema.patch({
        identities,
        sessionId: "session-1"
      }), {
        errors: {},
        validatedObject: {
          identities,
          sessionId: "session-1"
        }
      });

      const readReply = testReply();
      const saveReply = testReply();
      await readRoute.handler({
        input: {
          query: {
            sessionId: "session-1"
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          calls.push(action);
          return {
            identities,
            ok: true
          };
        }
      }, readReply);
      await saveRoute.handler({
        input: {
          body: {
            identities,
            sessionId: "session-1"
          }
        },
        params: routeProjectParams(),
        async executeAction(action) {
          calls.push(action);
          return {
            identities: action.input.identities,
            ok: true
          };
        }
      }, saveReply);

      assert.equal(readReply.statusCode, 200);
      assert.equal(saveReply.statusCode, 200);
      assert.deepEqual(calls, [
        {
          actionId: ACTION_READ_PREVIEW_APPLICATION_IDENTITIES,
          input: {
            sessionId: "session-1"
          }
        },
        {
          actionId: ACTION_SAVE_PREVIEW_APPLICATION_IDENTITIES,
          input: {
            identities,
            sessionId: "session-1"
          }
        }
      ]);
    });
  });
});
