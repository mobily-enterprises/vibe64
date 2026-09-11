import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, readdir, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { promisify } from "node:util";
import Fastify from "fastify";
import multipart from "@fastify/multipart";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server";
import { currentProjectRequestContext, runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createService } from "../../packages/vibe64-source-editor/src/server/service.js";
import { registerRoutes } from "../../packages/vibe64-source-editor/src/server/registerRoutes.js";
import { testRouteApp } from "./vibe64RouteTestHelpers.js";

const exec = promisify(execFile);
async function fixture(t) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-file-areas-"));
  const stores = new Map();
  for (const slug of ["one", "two"]) {
    const projectRoot = path.join(root, slug);
    await mkdir(projectRoot);
    const store = createVibe64SessionStore({ projectContextRoot: projectRoot, projectRuntimeRoot: path.join(root, `${slug}-state`) });
    await store.createSession({ sessionId: "shared-id", runtimeKind: "genesis" });
    await store.createSession({ sessionId: `${slug}-only`, runtimeKind: "genesis" });
    await writeFile(path.join(store.paths("shared-id").sessionRoot, "private.txt"), `${slug} private`);
    await writeFile(path.join(store.paths("shared-id").dropZoneRoot, "shared.txt"), `${slug} exchange`);
    stores.set(slug, store);
  }
  const service = createService({ projectService: { async createRuntime() {
    const store = stores.get(currentProjectRequestContext().slug);
    return { store, getSession: store.readSession };
  } } });
  t.after(async () => { service.close(); await rm(root, { recursive: true, force: true }); });
  const call = (operation, input = {}, role = "owner", slug = "one", options) => runWithProjectRequestContext({
    slug, targetRoot: path.join(root, slug), vibe64User: { username: role, role }
  }, () => service.fileArea({ sessionId: "shared-id", area: "drop-zone", ...input }, operation, options));
  return { root, stores, service, call };
}

test("one Files boundary enforces project/session/area access for every operation", async (t) => {
  const { call, service } = await fixture(t);
  assert.equal((await service.fileArea({ sessionId: "shared-id" }, "areas")).statusCode, 403);
  assert.deepEqual((await call("areas", {}, "member")).areas, ["repo", "drop-zone"]);
  assert.deepEqual((await call("areas")).areas, ["repo", "drop-zone", "session"]);
  for (const operation of ["tree", "file", "download", "archive", "save", "upload", "rename", "delete", "mkdir"]) {
    const input = { area: "session", path: "private.txt", vibe64User: { role: "owner" }, root: "/", sourceRoot: "/" };
    assert.equal((await call(operation, input, "member")).statusCode, 403, operation);
  }
  for (const operation of ["save", "upload", "rename", "delete", "mkdir"]) {
    assert.equal((await call(operation, { area: "session", path: "drop-zone/shared.txt" })).statusCode, 403, operation);
  }
  assert.equal((await call("file", { area: "session", path: "private.txt" })).file.text, "one private");
  assert.equal((await call("file", { path: "shared.txt" }, "member", "two")).file.text, "two exchange");
  assert.equal((await call("tree", { sessionId: "two-only" }, "member")).ok, false);
  assert.equal((await call("tree", { sessionId: "../two-state" })).ok, false);
  assert.equal((await call("tree", { area: "/session" })).statusCode, 404);
  assert.equal((await call("save", { area: "repo" })).statusCode, 404);
});

test("Drop Zone navigation, uploads, edits and deletes cannot escape their root", async (t) => {
  const { root, stores, call } = await fixture(t);
  const zone = stores.get("one").paths("shared-id").dropZoneRoot;
  await symlink(path.dirname(zone), path.join(zone, "escape"));
  for (const target of ["../private.txt", "/etc/passwd", "escape/private.txt", "C:\\private.txt"]) {
    for (const operation of ["file", "download", "delete", "mkdir"]) {
      assert.equal((await call(operation, { path: target }, "member")).ok, false, `${operation}: ${target}`);
    }
  }
  assert.equal((await call("rename", { path: "shared.txt", destination: "../leaked.txt" }, "member")).ok, false);
  assert.equal((await call("mkdir", { path: "nested" }, "member")).ok, true);
  const bytes = Buffer.from([0, 255, 2, 3]);
  const readUpload = async function* () { yield { type: "file", fieldname: "file", file: Readable.from([bytes]) }; };
  assert.equal((await call("upload", { path: "nested/file.bin" }, "member", "one", { readUpload })).ok, true);
  const download = await call("download", { path: "nested/file.bin" }, "member");
  assert.deepEqual(await download.fileHandle.readFile(), bytes);
  await download.fileHandle.close();
  assert.equal((await call("upload", { path: "nested/file.bin" }, "member", "one", { readUpload })).ok, false);
  assert.equal((await call("rename", { path: "nested/file.bin", destination: "nested/renamed.bin" }, "member")).ok, true);
  const file = (await call("file", { path: "shared.txt" }, "member")).file;
  assert.equal((await call("save", { path: file.path, baseHash: file.hash, text: "changed" }, "member")).ok, true);
  assert.equal((await call("save", { path: file.path, baseHash: file.hash, text: "stale" }, "member")).ok, false);
  assert.equal((await call("delete", { path: "nested" }, "member")).ok, true);
  assert.equal((await call("delete", { path: "" }, "member")).ok, false);
  assert.equal(await readFile(path.join(root, "one-state/sessions/active/shared-id/private.txt"), "utf8"), "one private");
  assert.deepEqual((await readdir(zone)).sort(), ["escape", "shared.txt"]);
  await rm(zone, { recursive: true });
  await symlink(path.dirname(zone), zone);
  assert.equal((await call("file", { path: "private.txt" }, "member")).statusCode, 403);
});

test("archival preserves Drop Zone on failure, removes it on success, and keeps the archive clean", async (t) => {
  const { stores, call } = await fixture(t);
  const store = stores.get("one");
  const paths = store.paths("shared-id");
  await store.writeMetadataValue("shared-id", "session_closing_reason", "closing");
  assert.equal((await call("delete", { path: "shared.txt" }, "member")).statusCode, 409);
  assert.equal((await call("file", { path: "shared.txt" }, "member")).file.text, "one exchange");
  await store.writeStatus("shared-id", "archived");
  // A regular file where the staging directory must be makes publication fail.
  const archiveStage = path.join(paths.archivedSessionsRoot, ".staging");
  await mkdir(paths.archivedSessionsRoot, { recursive: true });
  await writeFile(archiveStage, "blocked");
  await assert.rejects(store.publishSessionArchive("shared-id"));
  const closingZone = path.join(paths.closingSessionsRoot, "shared-id/drop-zone");
  assert.equal(await readFile(path.join(closingZone, "shared.txt"), "utf8"), "one exchange");
  await rm(archiveStage);
  await store.publishSessionArchive("shared-id");
  await assert.rejects(readFile(path.join(closingZone, "shared.txt")), { code: "ENOENT" });
  const listing = (await exec("tar", ["-tzf", path.join(paths.archivedSessionsRoot, "shared-id.tar.gz")])).stdout;
  assert.ok(!listing.includes("drop-zone"));
  assert.ok(listing.includes("private.txt"));
  assert.equal((await call("tree", {}, "member")).expired, true);
  const archive = await call("archive", { area: "session" });
  assert.equal(archive.ok, true);
  assert.deepEqual(await archive.fileHandle.readFile(), await readFile(path.join(paths.archivedSessionsRoot, "shared-id.tar.gz")));
  await archive.fileHandle.close();
  assert.equal((await call("file", { area: "session", path: "private.txt" })).file.text, "one private");
  assert.deepEqual(await readdir(path.join(paths.sessionsRoot, ".archive-read")), []);
});

test("HTTP Files routes retain trusted identity and stream binary uploads/downloads", async (t) => {
  const { root, service } = await fixture(t);
  const server = Fastify();
  await server.register(multipart);
  server.addHook("preHandler", async (request) => {
    request.vibe64User = { username: "test", role: request.headers["x-test-role"] || "member" };
  });
  const app = testRouteApp();
  registerRoutes(app.http, { sourceEditor: service, routeRelativePath: "vibe64", projectContext: {
    projectsRoot: root,
    async readWorkspaceProject({ slug }) {
      if (!["one", "two"].includes(slug)) throw Object.assign(new Error("Missing project"), { code: "vibe64_project_route_unavailable" });
      return { project: { path: path.join(root, slug) } };
    }
  } });
  for (const route of app.registeredRoutes) server.route({ method: route.method, url: route.path, handler: route.handler, bodyLimit: route.options.bodyLimit });
  await server.listen({ host: "127.0.0.1", port: 0 });
  t.after(() => server.close());
  const base = `http://127.0.0.1:${server.server.address().port}/api/app/one/vibe64/sessions/shared-id/files`;
  assert.equal((await fetch(`${base}/session/file?path=private.txt&vibe64User[role]=owner`)).status, 403);
  assert.equal((await fetch(`${base}/session/file?path=private.txt`, { headers: { "x-test-role": "owner" } })).status, 200);
  const data = new FormData();
  const bytes = new Uint8Array([0, 251, 128, 10]);
  data.append("file", new Blob([bytes]), "file.bin");
  const uploaded = await fetch(`${base}/drop-zone/upload?path=file.bin`, { method: "POST", body: data });
  assert.equal(uploaded.status, 200, await uploaded.text());
  const downloaded = await fetch(`${base}/drop-zone/download?path=file.bin`);
  assert.equal(downloaded.headers.get("cache-control"), "private, no-store");
  assert.deepEqual(new Uint8Array(await downloaded.arrayBuffer()), bytes);
  const extra = new FormData();
  extra.append("file", new Blob([bytes]), "file.bin");
  extra.append("spoof", "owner");
  const rejected = await fetch(`${base}/drop-zone/upload?path=rejected.bin`, { method: "POST", body: extra });
  assert.ok(rejected.status >= 400);
  assert.ok((await fetch(`${base}/drop-zone/download?path=rejected.bin`)).status >= 400);
});

test("archival waits for an admitted upload and rejects writes queued after closing", async (t) => {
  const { stores, call } = await fixture(t);
  const store = stores.get("one");
  const started = Promise.withResolvers();
  const release = Promise.withResolvers();
  const readUpload = async function* () {
    yield { type: "file", fieldname: "file", file: Readable.from((async function* () {
      started.resolve();
      yield Buffer.from("first");
      await release.promise;
      yield Buffer.from("last");
    })()) };
  };
  const upload = call("upload", { path: "in-flight.txt" }, "member", "one", { readUpload });
  await started.promise;
  let closed = false;
  const closing = store.writeMetadataValue("shared-id", "session_closing_reason", "closing").then(() => { closed = true; });
  const next = call("delete", { path: "shared.txt" }, "member");
  assert.equal(closed, false);
  release.resolve();
  assert.equal((await upload).ok, true);
  await closing;
  assert.equal((await next).statusCode, 409);
  assert.equal(await readFile(path.join(store.paths("shared-id").dropZoneRoot, "in-flight.txt"), "utf8"), "firstlast");
});

test("renewal snapshots exclude the old Drop Zone and a successor starts empty", async (t) => {
  const { stores } = await fixture(t);
  const store = stores.get("one");
  const sourceSessionId = "shared-id";
  const successorSessionId = "successor";
  const renewalId = "renewal-files";
  await store.quiesceSessionForRenewal({ sourceSessionId, renewalId });
  await store.createRenewalPendingSession({ sessionId: successorSessionId, renewedFrom: sourceSessionId, renewalId, runtimeKind: "genesis", actorId: "owner", actorDisplayName: "Owner", confirmedAt: "2026-09-11T00:00:00.000Z" });
  assert.deepEqual(await readdir(store.paths(successorSessionId).dropZoneRoot), []);
  const prepared = await store.prepareRenewalSessionArchive({ sourceSessionId, successorSessionId, renewalId });
  const listing = (await exec("tar", ["-tzf", prepared.archivePath])).stdout;
  assert.ok(!listing.includes("drop-zone"));
  assert.equal(await readFile(path.join(store.paths(sourceSessionId).dropZoneRoot, "shared.txt"), "utf8"), "one exchange");
});
