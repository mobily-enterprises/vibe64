import assert from "node:assert/strict";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

test("output tools share HTTP ownership and bounded state without grants, paths or commands", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const actor = { username: "owner", role: "owner" };
    let allowed = true;
    const calls = [];
    const target = { id: "app", label: "Preview", mode: "interactive", available: true, default: true,
      presentation: { kind: "web", directHref: "private-url" }, parameters: [{ id: "audience", label: "Audience", default: "x".repeat(4096), required: true }],
      argv: ["private-command"], source: "private-source" };
    const terminal = { ok: true, id: "terminal-1", status: "closing", exitCode: null, closeError: "", output: "log ".repeat(1500),
      commandPreview: "private-command", metadata: { outputTargetId: "app", outputTargetLabel: "Preview", outputMode: "interactive", outputPresentationKind: "web",
        sourceRoot: "/private/source", token: "private-token", targetUrl: "private-url" } };
    const run = { id: "run-1", outputTargetId: "app", terminalSessionId: "terminal-1", results: Array.from({ length: 23 }, (_, i) => ({
      id: `result-${i}`, downloadId: "archive", name: "Build.zip", size: 42, mediaType: "application/zip", storageName: "private.blob" })) };
    const status = { ok: true, activeTerminal: terminal, output: { state: "preparing", targetId: "app", mode: "interactive", presentationKind: "web", raw: "private-output" },
      outputTargets: Array.from({ length: 12 }, (_, i) => ({ ...target, id: `target-${i}` })),
      outputRuns: Array(8).fill(run), preview: { state: "starting", message: "Preparing preview.", terminalId: "terminal-1", href: "private-url", targetHref: "private-direct" },
      previewIdentity: { available: true, identities: [{ name: "Reviewer", value: "private-email", type: "email" }], grant: "private-grant" },
      lastOutputTarget: { id: "app", outputParameters: { audience: " exact value ", private: "private-value" } } };
    const cases = [
      ["GET", "/outputs", "outputs.read", "outputTargetStatus", { targetOffset: 0, runOffset: 0 }, status],
      ["POST", "/output-runs", "output-target.start", "startOutputTargetTerminal", { outputTargetId: "app", outputParameters: { audience: " literal $(text) {port} " }, forceRestart: true }, terminal],
      ["POST", "/output-runs/:terminalSessionId/stop", "output-target.stop", "stopOutputTargetTerminal", {}, terminal],
      ["GET", "/output-runs/:terminalSessionId/terminal", "output-terminal.read", "readOutputTargetTerminal", {}, terminal],
      ["DELETE", "/output-runs/:terminalSessionId/terminal", "output-terminal.close", "closeOutputTargetTerminal", {}, { ok: true, closed: true }]
    ];
    const terminals = Object.fromEntries(cases.map(([, , , method, , result]) => [method, async (...args) => {
      calls.push({ args, actor: currentProjectRequestContext().vibe64User, slug: currentProjectRequestContext().slug });
      if (method === "outputTargetStatus" && args[1].outputTargetId) return { ...status, outputTargets: [target], requestedOutputTargetId: "app" };
      return result;
    }]));
    const actions = createActionCatalogue();
    actions.register({ contributorId: "outputs", domain: "terminals", actions: createTerminalActions({ terminals }).map(action => ({
      channels: ["api", "automation"], surfaces: ["app"], ...action
    })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => actor,
      authorizeProject() { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); } });
    const catalog = createServiceToolCatalog(actions, { maxDirectTools: 100 });
    const context = { channel: "automation", surface: "app" };
    const toolSet = catalog.resolveToolSet(context);
    const app = testRouteApp();
    registerRoutes(app.http, { fastify: { get() {} }, projectContext, routeRelativePath: "vibe64", routeSurface: "app", terminals, uploads: { readSingleMultipartFile() {} } });
    for (const [method, suffix, operation, , data, native] of cases) {
      const actionId = `vibe64.terminals.${operation}`;
      const tool = toolSet.tools.find(tool => tool.actionId === actionId);
      assert.ok(tool, actionId);
      assert.equal(Object.hasOwn(catalog.toOpenAiToolSchema(tool).function.parameters.properties, "vibe64User"), false);
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/sessions/:sessionId${suffix}` });
      const request = { params: routeProjectParams({ sessionId: "session-1", terminalSessionId: "terminal-1" }),
        input: { [method === "GET" ? "query" : "body"]: data },
        executeAction({ actionId: actual, input }) {
          assert.equal(actual, actionId);
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        } };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload, native);
      const httpCall = calls.at(-1);
      const execute = (patch = {}) => catalog.executeToolCall({ toolName: tool.name, toolSet, context,
        argumentsText: JSON.stringify({ projectSlug: slug, sessionId: "session-1",
          ...(suffix.includes(":terminalSessionId") ? { terminalSessionId: "terminal-1" } : {}), ...data, ...patch }) });
      const result = await execute();
      assert.equal(result.ok, true, JSON.stringify(result));
      assert.deepEqual(calls.at(-1), httpCall);
      assert.equal(httpCall.actor, actor);
      assert.equal(httpCall.slug, slug);
      assert.equal(JSON.stringify(result).includes("private"), false);
      if (operation === "outputs.read") {
        assert.equal(result.result.outputTargets.length, 10);
        assert.equal(result.result.outputTargetCount, 12);
        assert.equal(result.result.nextTargetOffset, 10);
        assert.equal(result.result.outputRuns.length, 5);
        assert.equal(result.result.nextRunOffset, 5);
        assert.equal(result.result.outputRuns[0].results.length, 20);
        assert.equal(result.result.outputRuns[0].resultsTruncated, true);
        assert.equal(result.result.preview.state, "starting");
        assert.equal(result.result.activeTerminal.status, "closing");
        assert.equal(Object.hasOwn(result.result.outputTargets[0], "parameters"), false);
        const detail = await execute({ outputTargetId: "app" });
        assert.equal(detail.ok, true, JSON.stringify(detail));
        assert.equal(detail.result.outputTargets[0].parameters[0].default.length, 4096);
        assert.deepEqual(detail.result.outputTargets[0].currentParameters, { audience: " exact value " });
      } else if (operation === "output-terminal.read") {
        assert.equal(result.result.output.length, 4000);
        assert.equal(result.result.outputTruncated, true);
      } else assert.equal(Object.hasOwn(result.result, "output"), false);
      const count = calls.length;
      allowed = false;
      assert.equal((await execute()).ok, false);
      await assert.rejects(route.handler(request, reply), { statusCode: 403 });
      allowed = true;
      assert.equal((await execute({ vibe64User: { username: "invented" } })).ok, false);
      assert.equal((await execute({ sessionId: "" })).ok, false);
      if (operation === "outputs.read") assert.equal((await execute({ targetOffset: -1 })).ok, false);
      if (operation === "output-target.start") {
        assert.equal((await execute({ outputTargetId: "" })).ok, false);
        assert.equal((await execute({ command: "arbitrary executable" })).ok, false);
      }
      assert.equal(calls.length, count);
    }
    for (const id of ["preview-identity.select", "output-result.read", "agent-terminal.start", "global-terminal.start"])
      assert.equal(toolSet.tools.some(tool => tool.actionId === `vibe64.terminals.${id}`), false, id);
  }));
});

test("output definitions admit only the explicitly bound physical Learning scope", async () => {
  const calls = [];
  const terminals = { outputTargetStatus: (...args) => { calls.push(args); return { ok: true }; } };
  const definitions = createTerminalActions({ terminals });
  const attemptId = "12345678-1234-4234-8234-123456789abc";
  const expected = new Map([
    ["outputs.read", "observe"], ["output-terminal.read", "observe"], ["output-result.read", "observe"],
    ["output-target.start", "write"], ["output-target.open", "write"], ["preview-identity.select", "write"],
    ["output-target.stop", "control"], ["output-terminal.close", "control"]
  ]);
  for (const [suffix, access] of expected) {
    const action = definitions.find(item => item.id === `vibe64.terminals.${suffix}`);
    assert.ok(action, suffix);
    assert.equal(action.extensions.vibe64.learningAccess, access);
    for (const noExercise of [true, undefined]) {
      await assert.rejects(action.execute({ sessionId: "initial-session", learningAttemptId: attemptId }, {
        vibe64Action: { learning: { learningScope: { noExercise, attemptId } } }
      }), { code: "vibe64_learning_source_required", statusCode: 409 });
    }
  }
  let admissions = 0;
  const read = definitions.find(item => item.id === "vibe64.terminals.outputs.read");
  assert.deepEqual(await read.execute({ sessionId: "initial-session", learningAttemptId: attemptId }, {
    vibe64Action: { learning: { learningScope: { noExercise: false, attemptId },
      runLearningOperation(operation) { admissions += 1; return operation(); } } }
  }), { ok: true });
  assert.equal(admissions, 1);
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "initial-session");
  for (const suffix of ["agent-terminal.start", "global-terminal.start", "temporary-conversation.create"])
    assert.equal(Boolean(definitions.find(item => item.id === `vibe64.terminals.${suffix}`)?.extensions.vibe64.learningAccess), false);
});
