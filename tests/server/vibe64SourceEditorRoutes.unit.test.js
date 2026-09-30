import assert from "node:assert/strict";
import test from "node:test";
import { Readable } from "node:stream";
import { once } from "node:events";
import { mkdtemp, open, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

import { registerRoutes as registerSourceRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import { createSourceEditorActions } from "../../packages/vibe64-source-editor/src/server/actions.js";
import {
  findRegisteredRoute,
  routeProjectParams,
  testReply,
  testRouteApp,
  withLocalRequestBypass,
  withRouteProject
} from "./vibe64RouteTestHelpers.js";

const localUser = { username: "local", role: "owner" };

function registerRoutes(http, options, authorizeProject = async () => {}) {
  const actions = createActionCatalogue();
  actions.register({ contributorId: "source", domain: "source", actions: createSourceEditorActions(options).map((action) => ({
    channels: ["api", "automation", "internal"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, {
    projectContext: options.projectContext,
    resolveUser: async ({ request }) => request?.vibe64User || localUser,
    authorizeProject
  });
  registerSourceRoutes({ router: {
    register(method, path, routeOptions, handler) {
      http.router.register(method, path, routeOptions, (request, reply) => {
        request.executeAction = ({ actionId, input, context }) => actions.execute({
          actionId, input, context: { ...context, channel: "api", surface: "app", requestMeta: { request } }
        });
        return handler(request, reply);
      });
    }
  } }, options);
  return actions;
}

test("source downloads deliver original file bytes over a real HTTP connection", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiBase, apiRouteBase, projectContext }) => {
    const root = await mkdtemp(path.join(tmpdir(), "vibe64-download-http-"));
    const server = Fastify();
    const handles = [];
    const closed = [];
    try {
      const files = new Map([
        ["staff guide.docx", Buffer.from([80, 75, 3, 4, 0, 255, 13, 10])],
        ["résumé.txt", Buffer.from("A saved text file.\n")],
        ["large.bin", Buffer.alloc(2 * 1024 * 1024, 0x82)],
        ["empty.txt", Buffer.alloc(0)]
      ]);
      for (const [name, bytes] of files) await writeFile(path.join(root, name), bytes);
      const app = testRouteApp();
      registerRoutes(app.http, {
        projectContext, routeRelativePath: "vibe64", routeSurface: "app",
        sourceEditor: {
          async readTree() { return { ok: true }; },
          async fileArea(input, operation) {
            assert.equal(operation, "download");
            assert.equal(Object.hasOwn(input, "offset"), false);
            return this.downloadFile(input);
          },
          async downloadFile({ path: name }) {
            assert.ok(files.has(name));
            const fileHandle = await open(path.join(root, name), "r");
            handles.push(fileHandle);
            closed.push(once(fileHandle, "close"));
            return { ok: true, fileHandle, name };
          }
        }
      });
      const route = findRegisteredRoute(app, {
        method: "GET", path: `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor/download`
      });
      server.get(route.path, route.handler);
      const areaRoute = findRegisteredRoute(app, { method: "GET", path: `${apiRouteBase}/vibe64/sessions/:sessionId/files/:area/download` });
      server.get(areaRoute.path, areaRoute.handler);
      const origin = await server.listen({ host: "127.0.0.1", port: 0 });
      for (const prefix of ["source-editor", "files/drop-zone"]) for (const [name, bytes] of files) {
        const response = await fetch(`${origin}${apiBase}/vibe64/sessions/session-1/${prefix}/download?path=${encodeURIComponent(name)}${prefix === "files/drop-zone" ? "&offset=0" : ""}`);
        assert.equal(response.status, 200);
        assert.equal(response.headers.get("content-type"), "application/octet-stream");
        assert.equal(response.headers.get("cache-control"), "private, no-store");
        assert.ok(response.headers.get("content-disposition").includes(encodeURIComponent(name)));
        assert.deepEqual(Buffer.from(await response.arrayBuffer()), bytes, name);
      }
      await Promise.all(closed);
      assert.ok(handles.every((handle) => handle.fd === -1));
    } finally {
      await server.close();
      await Promise.all(handles.map((handle) => handle.close()));
      await rm(root, { recursive: true, force: true });
    }
  }));
});

test("star routes accept only trusted identity and download responses are private attachments", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiRouteBase, projectContext }) => {
    const calls = [];
    const stream = Readable.from([Buffer.from([0, 255, 7])]);
    const app = testRouteApp();
    registerRoutes(app.http, {
      projectContext, routeRelativePath: "vibe64", routeSurface: "app",
      sourceEditor: {
        async readTree() { return { ok: true }; },
        async readStarredFiles(input) { calls.push(input); return { ok: true, files: [] }; },
        async setStarredFile(input) { calls.push(input); return { ok: true, paths: [input.path] }; },
        async downloadFile() { return { ok: true, name: "résumé (1).bin", fileHandle: {
          createReadStream(options) { assert.deepEqual(options, { autoClose: true }); return stream; }
        } }; }
      }
    });
    const base = `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor`;
    const actor = { username: "ada", uid: 1001 };
    const params = routeProjectParams({ sessionId: "session-1" });
    await findRegisteredRoute(app, { method: "POST", path: `${base}/stars` }).handler({
      params, vibe64User: actor, input: { body: { path: "src/app.js", starred: true, vibe64User: { username: "bob" } } }
    }, testReply());
    assert.deepEqual(calls[0], { sessionId: "session-1", path: "src/app.js", starred: true, vibe64User: actor });
    await findRegisteredRoute(app, { method: "GET", path: `${base}/stars` }).handler({ params, vibe64User: actor }, testReply());
    assert.deepEqual(calls[1], { sessionId: "session-1", vibe64User: actor });
    const reply = { ...testReply(), headers: {}, header(key, value) { this.headers[key] = value; return this; } };
    await findRegisteredRoute(app, { method: "GET", path: `${base}/download` }).handler({ params, input: { query: { path: "résumé (1).bin" } } }, reply);
    assert.equal(reply.payload, stream);
    assert.equal(reply.headers["Content-Disposition"], "attachment; filename*=UTF-8''r%C3%A9sum%C3%A9%20%281%29.bin");
    assert.equal(reply.headers["Content-Type"], "application/octet-stream");
    assert.equal(reply.headers["Cache-Control"], "private, no-store");
  }));
});

test("source explanation routes use the authenticated Vibe64 actor", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const sourceEditor = {
        async explainSelection(input) {
          calls.push(input);
          return { explanation: {}, ok: true };
        },
        async readTree() {
          return { ok: true, tree: [] };
        }
      };
      const app = testRouteApp();
      registerRoutes(app.http, {
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        sourceEditor
      });
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor/explanations`
      });
      assert.ok(route);
      const vibe64User = {
        email: "ada@example.com",
        username: "ada"
      };
      const body = {
        endColumn: 8,
        endLine: 3,
        path: "src/app.js",
        startColumn: 1,
        startLine: 2,
        vibe64User: {
          username: "spoofed"
        }
      };

      await route.handler({
        input: { body },
        params: routeProjectParams({ sessionId: "session-1" }),
        vibe64User
      }, testReply());

      assert.deepEqual(calls, [{
        endColumn: 8,
        endLine: 3,
        force: false,
        path: "src/app.js",
        sessionId: "session-1",
        startColumn: 1,
        startLine: 2,
        vibe64User
      }]);
    });
  });
});

test("source file creation publishes a created refresh after the durable write", async () => {
  await withLocalRequestBypass(async () => {
    await withRouteProject(async ({ apiRouteBase, projectContext }) => {
      const calls = [];
      const created = {
        file: { path: "src/new.js" },
        fileChange: {
          hash: "hash-1",
          originId: "tab-1",
          path: "src/new.js",
          projectSlug: "unit_project",
          sessionId: "session-1"
        },
        ok: true
      };
      const sourceEditor = {
        async createFile(input) {
          calls.push(["create", input]);
          return created;
        },
        async readTree() {
          return { ok: true, tree: [] };
        }
      };
      const app = testRouteApp();
      registerRoutes(app.http, {
        async publishFileChanged(result, options) {
          calls.push(["publish", result, options]);
        },
        projectContext,
        routeRelativePath: "vibe64",
        routeSurface: "app",
        sourceEditor
      });
      const route = findRegisteredRoute(app, {
        method: "POST",
        path: `${apiRouteBase}/vibe64/sessions/:sessionId/source-editor/file`
      });

      const reply = testReply();
      await route.handler({
        input: {
          body: {
            originId: "tab-1",
            path: "src/new.js",
            projectSlug: "unit_project"
          }
        },
        params: routeProjectParams({ sessionId: "session-1" })
      }, reply);

      assert.equal(reply.payload, created);
      assert.deepEqual(calls, [
        ["create", {
          originId: "tab-1",
          path: "src/new.js",
          projectSlug: "unit_project",
          sessionId: "session-1",
          vibe64User: localUser
        }],
        ["publish", created, { operation: "created" }]
      ]);
    });
  });
});

test("source operations share validated inputs and fresh project authority across HTTP and automation", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    const calls = [];
    const changes = [];
    let allowed = true;
    const cases = [
      ["GET", "/files", "file-areas.read", "fileArea", {}],
      ["GET", "/files/:area/tree", "file-area.tree", "fileArea", { offset: "next" }],
      ["GET", "/files/:area/file", "file-area.file", "fileArea", { path: "readme.txt", offset: "0" }],
      ["PUT", "/files/:area/file", "file-area.save", "fileArea", { path: "readme.txt", baseHash: "hash", text: "  keep whitespace\n" }],
      ["POST", "/files/:area/rename", "file-area.rename", "fileArea", { path: "old.txt", destination: "new.txt" }],
      ["POST", "/files/:area/directory", "file-area.mkdir", "fileArea", { path: "new" }],
      ["DELETE", "/files/:area/file", "file-area.delete", "fileArea", { path: "old.txt" }],
      ["GET", "/integrations", "integrations.read", "readIntegrations", {}],
      ["GET", "/integrations/providers", "integrations.providers.read", "readIntegrationProviders", { search: "email", offset: 20 }],
      ["POST", "/integrations/n8n/discovery", "integrations.n8n.discover", "discoverN8nIntegration", { serverUrl: "https://example.com" }],
      ["PUT", "/integrations", "integrations.save", "saveIntegrations", { baseHash: null, configuration: { schemaVersion: 1, integrations: {}, registrations: {} } }],
      ["POST", "/integrations/:integrationId/oauth-client", "integrations.oauth-client.register", "registerOAuthIntegration", { baseHash: "hash", configuration: {}, callbackUrl: "https://example.com/callback" }],
      ["POST", "/integrations/:integrationId/setup", "integrations.setup", "runIntegrationSetup", { operation: "status", after: null }],
      ["GET", "/source-editor/tree", "tree.read", "readTree", { path: "src", limit: "10", offset: "next" }],
      ["GET", "/source-editor/files", "files.find", "listFiles", { q: "app", limit: "10" }],
      ["GET", "/source-editor/search", "search", "search", { q: "", limit: "10" }],
      ["GET", "/source-editor/stars", "stars.read", "readStarredFiles", {}],
      ["POST", "/source-editor/stars", "star.set", "setStarredFile", { path: "src/app.js", starred: false }],
      ["POST", "/source-editor/resolve-path", "path.resolve", "resolvePath", { fromPath: "src/app.js", target: "./other.js" }],
      ["POST", "/source-editor/explanations", "explanation.create", "explainSelection", { path: "src/app.js", startLine: 1, endLine: 2 }],
      ["POST", "/source-editor/explanations/cleanup", "explanations.cleanup", "cleanupExplanations", { activeExplanationIds: ["keep"] }],
      ["DELETE", "/source-editor/explanations/:explanationId", "explanation.delete", "deleteExplanation", {}],
      ["POST", "/source-editor/explanations/:explanationId/stop", "explanation.stop", "stopExplanation", {}],
      ["POST", "/source-editor/explanations/:explanationId/followups", "explanation.followup", "addExplanationFollowup", { message: "Explain further" }],
      ["GET", "/source-editor/file", "file.read", "readFile", { path: "src/app.js" }],
      ["POST", "/source-editor/file", "file.create", "createFile", { path: "new.js", originId: "browser" }],
      ["PUT", "/source-editor/file", "file.save", "saveFile", { path: "new.js", baseHash: "hash", text: "  content\n" }]
    ];
    const sourceEditor = Object.fromEntries(cases.map(([, , , method]) => [method, async (...args) => {
      const context = currentProjectRequestContext();
      calls.push({ method, args, project: context.slug, actor: context.vibe64User });
      return { ok: true, method };
    }]));
    const app = testRouteApp();
    const actions = registerRoutes(app.http, {
      sourceEditor, projectContext, routeRelativePath: "vibe64", routeSurface: "app",
      async publishFileChanged(result, options) { changes.push({ result, options }); }
    }, async () => { if (!allowed) throw Object.assign(new Error("Project access revoked"), { statusCode: 403 }); });
    for (const [method, suffix, operation, serviceMethod, data] of cases) {
      const route = findRegisteredRoute(app, { method, path: `${apiRouteBase}/vibe64/sessions/:sessionId${suffix}` });
      const request = { params: routeProjectParams({ sessionId: "session-1", area: "drop-zone", integrationId: "calendar", explanationId: "explain-1" }), input: { [method === "GET" ? "query" : "body"]: data } };
      const reply = testReply();
      await route.handler(request, reply);
      assert.equal(reply.payload.method, serviceMethod, operation);
      const httpCall = calls.at(-1);
      assert.equal(httpCall.project, slug);
      assert.equal(httpCall.actor, localUser);
      const input = { ...data, sessionId: "session-1", projectSlug: slug };
      if (operation === "file-area.file") delete input.offset;
      if (suffix.includes(":area")) input.area = "drop-zone";
      if (suffix.includes(":integrationId")) input.integrationId = "calendar";
      if (suffix.includes(":explanationId")) input.explanationId = "explain-1";
      if (Object.hasOwn(input, "q")) { input.query = input.q; delete input.q; }
      const execute = (value = input) => actions.execute({ actionId: `vibe64.source-editor.${operation}`, input: value, context: { channel: "automation", surface: "app" } });
      await execute();
      assert.deepEqual(calls.at(-1), httpCall, operation);
      const count = calls.length;
      allowed = false;
      await assert.rejects(route.handler(request, testReply()), { statusCode: 403 });
      await assert.rejects(execute(), { statusCode: 403 });
      assert.equal(calls.length, count);
      allowed = true;
      await assert.rejects(execute({ ...input, vibe64User: { role: "owner" } }), { code: "ACTION_VALIDATION_FAILED" });
    }
    assert.deepEqual(changes.map(({ options }) => options.operation), ["created", "created", "saved", "saved", "created", "created", "saved", "saved"]);
    const count = calls.length;
    for (const input of [{ path: "new.js" }, { path: "new.js", baseHash: "hash", text: [] }]) {
      await assert.rejects(actions.execute({ actionId: "vibe64.source-editor.file.save", input: { ...input, sessionId: "session-1", projectSlug: slug }, context: { channel: "automation", surface: "app" } }), { code: "ACTION_VALIDATION_FAILED" });
    }
    assert.equal(calls.length, count);
    assert.equal(currentProjectRequestContext(), null);
  }));
});

test("multipart upload passes its bounded transport reader through the authorized action", async () => {
  await withLocalRequestBypass(() => withRouteProject(async ({ apiRouteBase, projectContext, slug }) => {
    let allowed = true;
    const calls = [];
    const parts = [{ filename: "note.txt", file: Readable.from(["note"]) }];
    const app = testRouteApp();
    const actions = registerRoutes(app.http, { projectContext, routeRelativePath: "vibe64", routeSurface: "app", sourceEditor: {
      readTree() {},
      async fileArea(input, operation, { readUpload }) { calls.push({ input, operation, parts: await readUpload() }); return { ok: true }; }
    } }, async () => { if (!allowed) throw Object.assign(new Error("Revoked"), { statusCode: 403 }); });
    const route = findRegisteredRoute(app, { method: "POST", path: `${apiRouteBase}/vibe64/sessions/:sessionId/files/:area/upload` });
    let readCount = 0;
    const request = { params: routeProjectParams({ sessionId: "session-1", area: "drop-zone" }), input: { query: { path: "notes" } },
      parts(options) { readCount++; assert.deepEqual(options, { throwFileSizeLimit: true, limits: { files: 1, fields: 0, parts: 1, fileSize: 100 * 1024 * 1024 } }); return parts; }
    };
    await route.handler(request, testReply());
    await actions.execute({ actionId: "vibe64.source-editor.file-area.upload", input: { sessionId: "session-1", projectSlug: slug, area: "drop-zone", path: "notes" },
      context: { channel: "automation", surface: "app", sourceEditorUpload: { readUpload: () => parts } } });
    assert.deepEqual(calls[0], calls[1]);
    assert.equal(calls[0].input.vibe64User, localUser);
    allowed = false;
    await assert.rejects(route.handler(request, testReply()), { statusCode: 403 });
    assert.equal(readCount, 1);
    assert.equal(calls.length, 2);
  }));
});


test("integration setup accepts selections only; executable, Env and session remain server-owned", async () => {
  await withLocalRequestBypass(async () => withRouteProject(async ({ apiRouteBase, projectContext }) => {
    const calls = [];
    const app = testRouteApp();
    registerRoutes(app.http, {
      projectContext, routeRelativePath: "vibe64", routeSurface: "app",
      sourceEditor: {
        async readTree() { return { ok: true }; },
        async runIntegrationSetup(input) { calls.push(input); return { ok: true, status: "disconnected" }; }
      }
    });
    const route = findRegisteredRoute(app, {
      method: "POST", path: `${apiRouteBase}/vibe64/sessions/:sessionId/integrations/:integrationId/setup`
    });
    const reply = testReply();
    const request = {
      vibe64User: { username: "trusted-owner" },
      params: routeProjectParams({ sessionId: "session-1", integrationId: "calendar" }),
      input: { body: {
        operation: "connect", verificationInput: { account: "fixture" },
        vibe64User: { username: "forged-owner" },
        setupRequest: { turnId: "000001", requestId: "a".repeat(64), configurationHash: "b".repeat(64) },
        sessionId: "other", integrationId: "other", environment: "production",
        command: "untrusted", env: { SECRET: "untrusted" }, sourceRoot: "/other"
      } }
    };
    await assert.rejects(route.handler(request, reply), { code: "ACTION_VALIDATION_FAILED" });
    assert.equal(calls.length, 0);
    for (const key of ["environment", "command", "env", "sourceRoot"]) delete request.input.body[key];
    await route.handler(request, reply);
    assert.deepEqual(calls, [{ sessionId: "session-1", integrationId: "calendar", environment: "development",
      operation: "connect", vibe64User: { username: "trusted-owner" },
      setupRequest: { turnId: "000001", requestId: "a".repeat(64), configurationHash: "b".repeat(64) },
      verificationInput: { account: "fixture" } }]);
    assert.deepEqual(reply.payload, { ok: true, status: "disconnected" });
  }));
});
