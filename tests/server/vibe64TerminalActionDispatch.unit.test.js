import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { once } from "node:events";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import { registerRoutes } from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { findRegisteredRoute, routeProjectParams, testReply, testRouteApp, withLocalRequestBypass, withRouteProject } from "./vibe64RouteTestHelpers.js";

function catalogue(terminals, projectContext, { resolveUser, authorizeProject } = {}) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "terminals", domain: "terminals", actions: createTerminalActions({ terminals }).map((action) => ({
    channels: ["api", "automation"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, { projectContext,
    resolveUser: resolveUser || (async () => ({ username: "owner", role: "owner" })),
    authorizeProject: authorizeProject || (async () => {})
  });
  return actions;
}

test("terminal and output HTTP operations share validated actions and fresh authority with automation", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const owner = { username: "owner", role: "owner" };
    let allowed = true;
    const calls = [];
    const cases = [
      ["GET", "/codex-terminal", "global-terminal.status", "globalCodexTerminalState", {}],
      ["POST", "/codex-terminal", "global-terminal.start", "startGlobalCodexTerminal", {}],
      ["POST", "/agent-sessions/reconcile", "agent-sessions.reconcile", "reconcileOpenAgentSessions", {}],
      ["POST", "/project-runtime/open", "project-runtime.open", "openProjectRuntime", { reason: "project-open" }],
      ["POST", "/project-runtime/close", "project-runtime.close", "closeProjectRuntime", { reason: "user-request" }],
      ["GET", "/sessions/:sessionId/outputs", "outputs.read", "outputTargetStatus", {}],
      ["POST", "/sessions/:sessionId/output-runs", "output-target.start", "startOutputTargetTerminal", { outputTargetId: "web", outputParameters: { audience: "Preview" }, forceRestart: true }],
      ["POST", "/sessions/:sessionId/output-runs/open", "output-target.open", "openOutputTarget", {}],
      ["POST", "/sessions/:sessionId/output-runs/:terminalSessionId/stop", "output-target.stop", "stopOutputTargetTerminal", {}],
      ["POST", "/sessions/:sessionId/preview-identity", "preview-identity.select", "selectPreviewIdentity", { mode: "identity", identityName: "editor" }],
      ["POST", "/sessions/:sessionId/agent-terminal", "agent-terminal.start", "startAgentTerminal", { originId: "tab:owner", size: { cols: 80, rows: 24 } }],
      ["GET", "/sessions/:sessionId/agent-goal", "agent-goal.read", "readAgentGoal", {}],
      ["POST", "/sessions/:sessionId/agent-goal", "agent-goal.update", "updateAgentGoal", { action: "resume", threadId: "thread-1", createdAt: 123.456, objective: " Preserve exact whitespace. " }],
      ["GET", "/sessions/:sessionId/agent-plan-usage", "agent-plan-usage.read", "readAgentPlanUsage", {}],
      ["POST", "/sessions/:sessionId/agent-session", "agent-session.prepare", "ensureAgentSession", {}]
    ];
    for (const [prefix, suffix, read, close, write] of [
      ["output-terminal", "/sessions/:sessionId/output-runs/:terminalSessionId/terminal", "readOutputTargetTerminal", "closeOutputTargetTerminal"],
      ["agent-terminal", "/sessions/:sessionId/agent-terminal/:terminalSessionId", "readAgentTerminal", "closeAgentTerminal", "writeAgentTerminal"],
      ["global-terminal", "/codex-terminal/:terminalSessionId", "readGlobalCodexTerminal", "closeGlobalCodexTerminal", "writeGlobalCodexTerminal"]
    ]) {
      cases.push(["GET", suffix, `${prefix}.read`, read, {}], ["DELETE", suffix, `${prefix}.close`, close, {}]);
      if (write) cases.push(
        ["GET", `${suffix}/control/snapshot`, `${prefix}.control.snapshot`, read, {}],
        ["GET", `${suffix}/control/quiet`, `${prefix}.control.snapshot`, read, {}],
        ["POST", `${suffix}/control/check-text`, `${prefix}.control.check-text`, read, { text: "ready" }],
        ["POST", `${suffix}/control/text`, `${prefix}.control.text`, write, { text: " echo hello\r\n", attachmentIds: ["attachment-1"], originId: "tab:owner" }],
        ["POST", `${suffix}/control/key`, `${prefix}.control.key`, write, { key: "ctrl-c" }]
      );
    }
    const terminals = Object.fromEntries(cases.map(([, , , method]) => [method, async (...args) => {
      const context = currentProjectRequestContext();
      calls.push({ method, args, project: context.slug, actor: context.vibe64User });
      return { ok: true, id: "terminal-1", output: "ready", status: "running", lastOutputAt: new Date(0).toISOString() };
    }]));
    const actions = catalogue(terminals, projectContext, { resolveUser: async () => owner,
      async authorizeProject() { if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 }); }
    });
    const app = testRouteApp();
    registerRoutes(app.http, { fastify: { get() {} }, projectContext, routeRelativePath: "vibe64", routeSurface: "app", terminals, uploads: { readSingleMultipartFile() {} } });
    assert.equal(actions.listDefinitions().length, 42);
    for (const [method, suffix, operation, serviceMethod, data] of cases) {
      const actionId = `vibe64.terminals.${operation}`;
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64${suffix}` });
      assert.ok(route, suffix);
      let actionInput;
      const request = { headers: { host: "owner.example.test", "x-forwarded-proto": "https" },
        params: routeProjectParams({ sessionId: "session-1", terminalSessionId: "terminal-1" }),
        input: { [method === "GET" ? "query" : "body"]: data },
        executeAction({ actionId: actualId, input }) {
          assert.equal(actualId, actionId);
          assert.equal(Object.hasOwn(input, "vibe64User"), false);
          actionInput = input;
          return actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
        }
      };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload.ok, true, operation);
      const fromHttp = calls.at(-1);
      assert.equal(fromHttp.method, serviceMethod);
      assert.equal(fromHttp.actor, owner);
      assert.equal(fromHttp.project, slug);
      const execute = (input = { ...actionInput, projectSlug: slug }) => actions.execute({ actionId, input, context: { channel: "automation", surface: "app" } });
      await execute();
      assert.deepEqual(calls.at(-1), fromHttp, operation);
      if (operation.endsWith("control.text") || operation.endsWith("control.key")) {
        const [text, options] = fromHttp.args.slice(-2);
        assert.equal(text, operation.endsWith("control.text") ? data.text : "\u0003");
        assert.equal(options.trackGitActor, true);
        assert.equal(options.vibe64User, owner);
      }
      if (operation === "agent-goal.update") {
        assert.equal(fromHttp.args[1].objective, data.objective);
        assert.equal(fromHttp.args[1].createdAt, data.createdAt);
      }
      if (operation === "agent-terminal.start") {
        assert.deepEqual(fromHttp.args[1].size, { cols: 80, rows: 24 });
        assert.equal(fromHttp.args[2].vibe64User, owner);
      }
      assert.equal(actions.getDefinition(actionId).input.mode, "create");
      assert.equal(actions.getDefinition(actionId).extensions.assistant.exclude, true);
      const count = calls.length;
      allowed = false;
      await assert.rejects(route.handler(request, reply), { statusCode: 403 });
      await assert.rejects(execute(), { statusCode: 403 });
      allowed = true;
      await assert.rejects(execute({ ...actionInput, projectSlug: slug, vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
      assert.equal(calls.length, count);
    }
    const count = calls.length;
    for (const [operation, input] of [
      ["agent-goal.update", { sessionId: "session-1" }], ["agent-goal.update", { sessionId: "session-1", action: "complete" }],
      ["agent-goal.update", { sessionId: "session-1", action: "set", tokenBudget: 0 }],
      ["agent-terminal.start", { sessionId: "session-1", size: { command: "whoami" } }],
      ["agent-terminal.start", { sessionId: "session-1", size: { rows: -1 } }],
      ["agent-session.prepare", { sessionId: "session-1", runtime: {} }],
      ["agent-terminal.read", { terminalSessionId: "terminal-1" }],
      ["agent-terminal.read", { sessionId: "", terminalSessionId: "terminal-1" }],
      ["global-terminal.control.text", { terminalSessionId: "terminal-1" }],
      ["global-terminal.control.key", { terminalSessionId: "terminal-1", key: "rm -rf" }],
      ["global-terminal.control.text", { terminalSessionId: "terminal-1", text: "hi", trackGitActor: false }],
      ["output-target.start", { sessionId: "session-1" }]
    ]) await assert.rejects(actions.execute({ actionId: `vibe64.terminals.${operation}`, input: { ...input, projectSlug: slug }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" }, operation);
    assert.equal(calls.length, count);
    assert.equal(currentProjectRequestContext(), null);
  }));
});

test("output and attachment action downloads stream exact bytes and close their handles", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, apiBase, projectContext, slug }) => {
    const root = await mkdtemp(path.join(tmpdir(), "vibe64-terminal-download-"));
    const server = Fastify();
    let allowed = true;
    const handles = [];
    const bytes = Buffer.alloc(2 * 1024 * 1024, 171);
    const hash = createHash("sha256").update(bytes).digest("hex");
    const fileName = "résultat.bin";
    await writeFile(path.join(root, "content"), bytes);
    const read = async (sessionId, id) => {
      assert.equal(sessionId, "session-1");
      assert.equal(id, "result-1");
      assert.equal(currentProjectRequestContext().slug, slug);
      const fileHandle = await open(path.join(root, "content"), "r");
      handles.push({ fileHandle, closed: once(fileHandle, "close") });
      return { fileHandle, result: { sha256: hash, name: fileName, size: bytes.length, mediaType: "application/octet-stream" },
        attachment: { fileName, contentType: "application/octet-stream" } };
    };
    const terminals = { readOutputResult: read, readAgentAttachment: read };
    const actions = catalogue(terminals, projectContext, { async authorizeProject() {
      if (!allowed) throw Object.assign(new Error("Access revoked"), { statusCode: 403 });
    } });
    const app = testRouteApp();
    registerRoutes(app.http, { fastify: { get() {} }, projectContext, routeRelativePath: "vibe64", routeSurface: "app", terminals, uploads: { readSingleMultipartFile() {} } });
    server.addHook("onRequest", async (request) => {
      request.executeAction = ({ actionId, input }) => actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } });
    });
    for (const suffix of ["output-results/:resultId", "agent-attachments/:attachmentId"]) {
      const route = findRegisteredRoute(app, { method: "GET", path: `${apiRouteBase}/vibe64/sessions/:sessionId/${suffix}` });
      server.get(route.path, route.handler);
    }
    try {
      const origin = await server.listen({ host: "127.0.0.1", port: 0 });
      for (const suffix of ["output-results", "agent-attachments"]) {
        const url = `${origin}${apiBase}/vibe64/sessions/session-1/${suffix}/result-1`;
        const response = await fetch(url);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.equal(response.headers.get("x-content-type-options"), "nosniff");
        assert.match(response.headers.get("content-disposition"), /r%C3%A9sultat.bin/u);
        if (suffix === "output-results") assert.equal(response.headers.get("digest"), `sha-256=${Buffer.from(hash, "hex").toString("base64")}`);
        else assert.match(response.headers.get("content-security-policy"), /sandbox/u);
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes);
        await handles.at(-1).closed;
        assert.equal(handles.at(-1).fileHandle.fd, -1);
        const count = handles.length;
        allowed = false;
        const denied = await fetch(url);
        assert.equal(denied.status, 403);
        await denied.text();
        await assert.rejects(actions.execute({ actionId: `vibe64.terminals.${suffix === "output-results" ? "output-result" : "agent-attachment"}.read`,
          input: { projectSlug: slug, sessionId: "session-1", [suffix === "output-results" ? "resultId" : "attachmentId"]: "result-1" },
          context: { channel: "automation", surface: "app" } }), { statusCode: 403 });
        assert.equal(handles.length, count);
        allowed = true;
      }
    } finally {
      await server.close();
      await Promise.all(handles.map(({ fileHandle }) => fileHandle.close()));
      await rm(root, { recursive: true, force: true });
    }
  }));
});
