import assert from "node:assert/strict";
import { test } from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

import { createUsageRecordingActions } from "../../packages/vibe64-usage-recording/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-usage-recording/src/server/registerRoutes.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

const RECORDING_ID = "rec_abcdefghijklmnopqrst";
// method, suffix, operation, service method, kind, request, expected service input
const ROUTES = [
  ["GET", "/targets", "targets.read", "readTargets", "query", {}, {}],
  ["POST", "", "start", "start", "command", { body: { targetId: "output:cli", parameters: { limit: "5" } } },
    { targetId: "output:cli", parameters: { limit: "5" } }],
  ["GET", "/current", "current.read", "readCurrent", "query", {}, {}],
  ["GET", "", "list", "list", "query", {}, {}],
  ["POST", "/:recordingId/stop", "stop", "stop", "command", {}, { recordingId: RECORDING_ID }],
  ["POST", "/:recordingId/dismiss", "dismiss", "dismiss", "command", {}, { recordingId: RECORDING_ID }],
  ["GET", "/:recordingId/requests", "requests.read", "readRequests", "query",
    { query: { cursor: "100", limit: "50", q: "sessions", includeEmpty: "true", order: "newest", requestId: "r_000004" } },
    { recordingId: RECORDING_ID, cursor: "100", limit: 50, q: "sessions", includeEmpty: true, order: "newest", requestId: "r_000004" }],
  ["GET", "/:recordingId/requests/:requestId/functions", "request-functions.read", "readRequestFunctions", "query",
    { params: { requestId: "r_000001" }, query: { limit: "1500" } }, { recordingId: RECORDING_ID, requestId: "r_000001", limit: 1500 }],
  ["POST", "/:recordingId/interactions", "interaction.record", "recordInteraction", "command",
    { body: { id: "i_0001", at: "2026-10-30T10:00:19.800Z", label: "button \"Add\"", componentFile: null } },
    { recordingId: RECORDING_ID, id: "i_0001", at: "2026-10-30T10:00:19.800Z", label: "button \"Add\"", componentFile: null }],
  ["DELETE", "/:recordingId", "delete", "delete", "command", {}, { recordingId: RECORDING_ID }]
];

test("usage recording routes run their actions with session authority; reads need only read access", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
      const user = { username: "member", role: "member" };
      const calls = [];
      let access = "control";
      let failure = null;
      const usageRecording = Object.fromEntries(ROUTES.map(([, , , method]) => [method, async (input) => {
        calls.push({ method, input, project: currentProjectRequestContext().slug });
        if (failure) throw failure;
        return { ok: true };
      }]));
      const app = testRouteApp();
      const actions = createActionCatalogue();
      actions.register({ contributorId: "usage", domain: "usage", actions: createUsageRecordingActions({ usageRecording })
        .map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
      registerVibe64ActionContext(actions, {
        projectContext,
        resolveUser: async () => user,
        async authorizeProject({ definition }) {
          if (access === "none" || (access === "read" && definition.kind !== "query")) {
            throw Object.assign(new Error("Access revoked"), { statusCode: 403 });
          }
        }
      });
      registerRoutes({ router: { register: (method, path, options, handler) => app.registeredRoutes.push({ handler, method, options, path }) } },
        { projectContext, routeRelativePath: "vibe64", routeSurface: "app" });
      assert.equal(app.registeredRoutes.length, ROUTES.length);

      for (const [method, suffix, operation, serviceMethod, kind, request, expected] of ROUTES) {
        const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/usage-recordings/sessions/:sessionId${suffix}` });
        assert.ok(route, `${method} ${suffix} was not registered`);
        const definition = actions.listDefinitions().find((action) => action.id === `vibe64.usage-recording.${operation}`);
        assert.equal(definition.kind, kind, operation);
        assert.equal(definition.extensions.assistant.exclude, true, operation);
        const httpRequest = {
          body: request.body,
          params: routeProjectParams({ sessionId: "session-1", ...(suffix.includes(":recordingId") ? { recordingId: RECORDING_ID } : {}), ...request.params }),
          query: request.query || {},
          executeAction({ actionId, input }) {
            assert.equal(actionId, `vibe64.usage-recording.${operation}`);
            return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: httpRequest } } });
          }
        };
        const run = async () => {
          const reply = testReply();
          await route.handler(httpRequest, reply);
          return reply;
        };

        access = "control";
        assert.equal((await run()).statusCode, 200, operation);
        assert.deepEqual(calls.at(-1), { method: serviceMethod, input: { sessionId: "session-1", ...expected, vibe64User: user }, project: slug });

        const count = calls.length;
        access = "read";
        if (kind === "query") assert.equal((await run()).statusCode, 200, operation);
        else await assert.rejects(run(), { statusCode: 403 }, operation);
        access = "none";
        await assert.rejects(run(), { statusCode: 403 }, operation);
        assert.equal(calls.length, count + (kind === "query" ? 1 : 0));
      }

      // The service's refusals keep their status, code and words.
      access = "control";
      const start = findRegisteredRoute(app, { method: "POST", path: `${apiRouteBase}/vibe64/usage-recordings/sessions/:sessionId` });
      const startRequest = (body) => ({
        body,
        params: routeProjectParams({ sessionId: "session-1" }),
        query: {},
        executeAction({ actionId, input }) {
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: this } } });
        }
      });
      for (const [status, code, message] of [
        [409, "vibe64_usage_recording_active", "A recording is already running in this session. Stop it first."],
        [503, "vibe64_usage_recording_refused", "The server is low on memory. Try again when other work finishes."]
      ]) {
        failure = new AppError(status, message, { code, details: { reason: message } });
        await assert.rejects(start.handler(startRequest({ targetId: "preview" }), testReply()), { statusCode: status, code, message });
      }
      failure = null;
      await assert.rejects(start.handler(startRequest({}), testReply()), { code: "ACTION_VALIDATION_FAILED" });
      await assert.rejects(start.handler(startRequest({ targetId: "preview", parameters: "x" }), testReply()), { code: "ACTION_VALIDATION_FAILED" });
    });
  });
});
