import assert from "node:assert/strict";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, symlink, writeFile } from "node:fs/promises";
import { createHash } from "node:crypto";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { createVibe64ActionPolicy, registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createPagesActions } from "../../packages/vibe64-pages/src/server/pagesActions.js";
import { registerRoutes } from "../../packages/vibe64-pages/src/server/registerRoutes.js";
import { createPagesService } from "../../packages/vibe64-pages/src/server/service.js";
import { pageContentSecurityPolicy, requestOrigin } from "../../packages/vibe64-pages/src/server/pageSandbox.js";
import { pageAppPath, pageLinksInText } from "../../packages/vibe64-pages/src/shared/pageLinks.js";
import { findRegisteredRoute, testRouteApp } from "./vibe64RouteTestHelpers.js";

const SLUG = "unit_project";
const alice = { id: "alice", name: "Alice" };
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };
const files = (html, extra = {}) => [
  { path: "index.html", base64: Buffer.from(html).toString("base64") },
  ...Object.entries(extra).map(([filePath, content]) => ({ path: filePath, base64: Buffer.from(content).toString("base64") }))
];

async function withPages(operation, { clock } = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-pages-"));
  const projectRuntimeRoot = path.join(root, "state", "projects", SLUG);
  await mkdir(projectRuntimeRoot, { recursive: true });
  let tick = 0;
  const inProject = (run) => runWithProjectRequestContext({ projectRuntimeRoot, slug: SLUG }, run);
  // A project with no saved version: these tests never run a refresh's script.
  const project = {
    runInProjectContext: (_slug, run) => inProject(run),
    listProjects: async () => ({ projects: [{ slug: SLUG }] }),
    readCurrentProject: async () => ({ slug: SLUG })
  };
  const pages = createPagesService({
    now: () => new Date(Date.UTC(2026, 10, 6, 9, 0, tick++)).toISOString(),
    clock: clock || Date.now,
    project,
    logger: quietLogger
  });
  try {
    await operation({ pages, inProject, projectRuntimeRoot, root });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

function captureReply() {
  return {
    statusCode: 200, sent: {}, payload: undefined,
    code(status) { this.statusCode = status; return this; },
    headers(values) { Object.assign(this.sent, values); return this; },
    send(payload) { this.payload = payload; return this; }
  };
}

test("pages live in project state with their maker, session and last ten versions, never in the repository", async () => {
  await withPages(async ({ pages, inProject, projectRuntimeRoot }) => {
    const published = await inProject(() => pages.publishPage({
      files: files("<!doctype html><title>Test results</title><p>All green</p>", { "data.json": "{\"passed\":3}" }),
      by: alice,
      sessionId: "session-1"
    }));
    const page = published.page;
    assert.match(page.id, /^test-results-[0-9a-f]{6}$/u);
    assert.equal(page.title, "Test results", "the page's own <title> names it");
    assert.deepEqual(page.createdBy, alice);
    assert.equal(page.sessionId, "session-1");
    assert.equal(page.link, pageAppPath(SLUG, page.id));
    assert.equal(page.archived, false);
    const folder = path.join(projectRuntimeRoot, "pages", page.id);
    assert.equal(await readFile(path.join(folder, "versions", "1", "data.json"), "utf8"), "{\"passed\":3}");
    const record = JSON.parse(await readFile(path.join(folder, "page.json"), "utf8"));
    assert.equal(record.contract, "vibe64.page.v1");
    assert.equal(record.createdAt, "2026-11-06T09:00:00.000Z");

    for (let version = 2; version <= 12; version += 1) {
      const retitle = version === 12 ? { title: "Test results, run 12" } : {};
      await inProject(() => pages.updatePage({ pageId: page.id, ...retitle, files: files(`<p>Run ${version}</p>`), by: { id: "bob", name: "Bob" }, sessionId: "session-2" }));
    }
    const updated = (await inProject(() => pages.readPage({ pageId: page.id }))).page;
    assert.equal(updated.version, 12);
    assert.equal(updated.versions.at(-2).title, "Test results", "an update without a title keeps the page's");
    assert.equal(updated.title, "Test results, run 12");
    assert.deepEqual(updated.versions.map((version) => version.number), [3, 4, 5, 6, 7, 8, 9, 10, 11, 12]);
    assert.deepEqual(updated.updatedBy, { id: "bob", name: "Bob" });
    assert.deepEqual((await readdir(path.join(folder, "versions"))).sort((a, b) => a - b), ["3", "4", "5", "6", "7", "8", "9", "10", "11", "12"]);

    const restored = (await inProject(() => pages.restorePageVersion({ pageId: page.id, version: 4, by: alice }))).page;
    assert.equal(restored.version, 13);
    assert.equal(restored.versions.at(-1).restoredFrom, 4);
    assert.equal(restored.title, "Test results", "a version brought back brings back its title");
    assert.equal(await readFile(path.join(folder, "versions", "13", "index.html"), "utf8"), "<p>Run 4</p>");
    await assert.rejects(inProject(() => pages.restorePageVersion({ pageId: page.id, version: 1, by: alice })), { code: "vibe64_pages_version_not_found" });

    const second = (await inProject(() => pages.publishPage({ title: "Plan", files: files("<p>Plan</p>"), by: alice, sessionId: "session-1" }))).page;
    const listed = (await inProject(() => pages.listPages())).pages;
    assert.deepEqual(listed.map((entry) => entry.id), [second.id, page.id], "newest update first");
  });
});

test("archiving guards a page: no updates while archived, and deletion only after archiving", async () => {
  await withPages(async ({ pages, inProject, projectRuntimeRoot }) => {
    const { page } = await inProject(() => pages.publishPage({ fallbackTitle: "status board", files: files("<p>Status</p>"), by: alice, sessionId: "s" }));
    assert.equal(page.title, "status board", "without a title or <title>, the file or folder name names it");
    await assert.rejects(inProject(() => pages.deletePage({ pageId: page.id })), { code: "vibe64_pages_delete_requires_archive", status: 409 });
    const archived = (await inProject(() => pages.archivePage({ pageId: page.id }))).page;
    assert.equal(archived.archived, true);
    assert.ok(archived.archivedAt);
    await assert.rejects(inProject(() => pages.updatePage({ pageId: page.id, files: files("<p>x</p>"), by: alice, sessionId: "s" })), { code: "vibe64_pages_archived" });
    assert.equal((await inProject(() => pages.restorePage({ pageId: page.id }))).page.archived, false);
    await inProject(() => pages.archivePage({ pageId: page.id }));
    const { viewPath } = await inProject(() => pages.openPageView({ pageId: page.id }));
    assert.deepEqual(await inProject(() => pages.deletePage({ pageId: page.id })), { ok: true, pageId: page.id });
    assert.deepEqual(await readdir(path.join(projectRuntimeRoot, "pages")), []);
    assert.equal(await pages.viewedPage(viewPath.split("/").at(-1)), null, "deleting a page ends its viewing links");
    await assert.rejects(inProject(() => pages.readPage({ pageId: page.id })), { code: "vibe64_pages_not_found", status: 404 });
    await assert.rejects(inProject(() => pages.readPage({ pageId: "../escape" })), { code: "vibe64_pages_not_found" });
  });
});

test("a page's files must stay inside it, within its limits, and leave Vibe64's folder alone", async () => {
  await withPages(async ({ pages, inProject }) => {
    const publish = (pageFiles) => inProject(() => pages.publishPage({ title: "Bad", files: pageFiles, by: alice, sessionId: "s" }));
    for (const badPath of ["../escape.html", "/abs.html", ".hidden/x.js", "a/../b.js", "a\\b.js", "_vibe64/page.css", "a//b.js", "x\u0000.js"]) {
      await assert.rejects(publish(files("<p>x</p>", { [badPath]: "x" })), { code: "vibe64_pages_files_invalid" }, badPath);
    }
    await assert.rejects(publish([{ path: "about.html", base64: "eA==" }]), { code: "vibe64_pages_files_invalid" }, "index.html is required");
    await assert.rejects(publish(files("<p>x</p>", { "a": "file", "a/b.js": "nested" })), { code: "vibe64_pages_files_invalid" });
    await assert.rejects(publish(files("<p>x</p>", Object.fromEntries(Array.from({ length: 500 }, (_, index) => [`f${index}.txt`, "x"])))), { code: "vibe64_pages_files_invalid" });
    await assert.rejects(inProject(() => pages.publishPage({ title: "x".repeat(121), files: files("<p>x</p>"), by: alice, sessionId: "s" })), { code: "vibe64_pages_title_too_long" });
  });
});

const ada = { username: "ada" };
const ben = { username: "ben" };
const starredIds = async (pages, inProject, user) => (await inProject(() => pages.starredPages({ vibe64User: user }))).pages.map((page) => page.id);

test("a starred page is one person's, in one project, kept with its pages and shown in every session", async () => {
  await withPages(async ({ pages, inProject, projectRuntimeRoot, root }) => {
    const publish = (title, sessionId) => inProject(() => pages.publishPage({ title, files: files(`<p>${title}</p>`), by: alice, sessionId }));
    const plan = (await publish("Plan", "session-1")).page;
    const status = (await publish("Status", "session-2")).page;
    assert.deepEqual(await starredIds(pages, inProject, ada), [], "nothing is starred at first");
    const starred = await inProject(() => pages.setPageStar({ pageId: status.id, starred: true, vibe64User: ada }));
    assert.deepEqual(starred.pages.map((page) => page.id), [status.id], "a star answers with the starred pages");
    assert.equal(starred.pages[0].title, "Status");
    await inProject(() => pages.setPageStar({ pageId: plan.id, starred: true, vibe64User: ada }));
    assert.deepEqual(await starredIds(pages, inProject, ada), [status.id, plan.id], "in the order they were starred");
    assert.deepEqual(await starredIds(pages, inProject, ben), [], "another person's stars are their own");

    const record = path.join(projectRuntimeRoot, "pages", ".stars", `${createHash("sha256").update("ada").digest("hex")}.json`);
    assert.deepEqual(JSON.parse(await readFile(record, "utf8")), { pageIds: [status.id, plan.id] });
    assert.equal((await stat(record)).mode & 0o777, 0o600, "only Vibe64 reads a person's stars");
    assert.deepEqual((await inProject(() => pages.listPages())).pages.map((page) => page.id).sort(), [plan.id, status.id].sort(),
      "the stars folder is not a page");

    const otherProject = path.join(root, "state", "projects", "other_project");
    await mkdir(otherProject, { recursive: true });
    const inOther = (run) => runWithProjectRequestContext({ projectRuntimeRoot: otherProject, slug: "other_project" }, run);
    assert.deepEqual(await starredIds(pages, inOther, ada), [], "stars stay in their project");

    await inProject(() => pages.setPageStar({ pageId: status.id, starred: false, vibe64User: ada }));
    assert.deepEqual(await starredIds(pages, inProject, ada), [plan.id]);
    await assert.rejects(inProject(() => pages.setPageStar({ pageId: "missing-page-123abc", starred: true, vibe64User: ada })),
      { code: "vibe64_pages_not_found" }, "a star needs a page to name");
    assert.deepEqual((await inProject(() => pages.setPageStar({ pageId: "missing-page-123abc", starred: false, vibe64User: ada }))).pages
      .map((page) => page.id), [plan.id], "unstarring what is not starred changes nothing");
  });
});

test("an archived page leaves the starred pages until it is restored, and a deleted page loses its stars", async () => {
  await withPages(async ({ pages, inProject }) => {
    const publish = (title) => inProject(() => pages.publishPage({ title, files: files(`<p>${title}</p>`), by: alice, sessionId: "s" }));
    const first = (await publish("First")).page;
    const second = (await publish("Second")).page;
    for (const user of [ada, ben]) {
      for (const page of [first, second]) await inProject(() => pages.setPageStar({ pageId: page.id, starred: true, vibe64User: user }));
    }
    await inProject(() => pages.archivePage({ pageId: first.id }));
    assert.deepEqual(await starredIds(pages, inProject, ada), [second.id], "an archived page drops out");
    await inProject(() => pages.restorePage({ pageId: first.id }));
    assert.deepEqual(await starredIds(pages, inProject, ada), [first.id, second.id], "a restored page comes back in its place");

    await inProject(() => pages.archivePage({ pageId: first.id }));
    await inProject(() => pages.deletePage({ pageId: first.id }));
    for (const user of [ada, ben]) {
      assert.deepEqual(await starredIds(pages, inProject, user), [second.id]);
    }
    const again = (await publish("First")).page;
    await inProject(() => pages.setPageStar({ pageId: again.id, starred: true, vibe64User: ada }));
    assert.deepEqual(await starredIds(pages, inProject, ada), [second.id, again.id], "the deleted page left no star behind");
  });
});

test("stars made at once are all kept, and a star past the limit is refused with the saved stars kept", async () => {
  await withPages(async ({ pages, inProject, projectRuntimeRoot }) => {
    const made = [];
    for (let index = 0; index < 5; index += 1) {
      made.push((await inProject(() => pages.publishPage({ title: `Page ${index}`, files: files("<p>x</p>"), by: alice, sessionId: "s" }))).page.id);
    }
    await Promise.all(made.map((pageId) => inProject(() => pages.setPageStar({ pageId, starred: true, vibe64User: ada }))));
    assert.deepEqual((await starredIds(pages, inProject, ada)).sort(), [...made].sort());

    const record = path.join(projectRuntimeRoot, "pages", ".stars", `${createHash("sha256").update("ben").digest("hex")}.json`);
    const full = Array.from({ length: 100 }, (_, index) => `page-${index}-abcdef`);
    await writeFile(record, JSON.stringify({ pageIds: full }));
    await assert.rejects(inProject(() => pages.setPageStar({ pageId: made[0], starred: true, vibe64User: ben })),
      { code: "vibe64_pages_star_limit", status: 400, message: "You can star up to 100 pages per project." });
    assert.deepEqual(JSON.parse(await readFile(record, "utf8")).pageIds, full);
  });
});

test("page links are the app path of the page, found in chat text on this origin only", () => {
  const origin = "http://127.0.0.1:4173";
  const link = pageAppPath("demo", "status-0a1b2c");
  assert.equal(link, "/app/project/demo/dashboard/pages/status-0a1b2c");
  assert.deepEqual(pageLinksInText(`See [Status](${link}) and ${origin}${link} and https://elsewhere.test${pageAppPath("demo", "other-000000")}.`, { origin }), [
    { projectSlug: "demo", pageId: "status-0a1b2c", path: link }
  ]);
  assert.deepEqual(pageLinksInText(`${origin}${pageAppPath("demo", "other-000000")}`, { origin }).map((entry) => entry.pageId), ["other-000000"]);
  assert.deepEqual(pageLinksInText("/app/project/demo/dashboard/pages/Not_A_Page"), []);
});

test("project members' page routes run their actions behind the project access check, never as AI tools", async () => {
  await withPages(async ({ pages, inProject, projectRuntimeRoot, root }) => {
    const { page } = await inProject(() => pages.publishPage({ title: "Routes", files: files("<p>Routes</p>"), by: alice, sessionId: "s" }));
    await inProject(() => pages.updatePage({ pageId: page.id, files: files("<p>Routes 2</p>"), by: alice, sessionId: "s" }));
    const projectContext = {
      projectsRoot: path.join(root, "projects"),
      currentPracticeProjectScope: () => null,
      readWorkspaceProject: async ({ slug }) => ({ project: { path: path.join(root, "projects", slug), projectRuntimeRoot }, projectsRoot: path.join(root, "projects") })
    };
    await mkdir(path.join(root, "projects", SLUG), { recursive: true });
    let allowed = true;
    const member = { username: "carol", displayName: "Carol", role: "member" };
    const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: false }) });
    actions.register({ contributorId: "pages", domain: "pages", actions: createPagesActions({ pages })
      .map((action) => ({ channels: ["api", "automation"], surfaces: ["app"], ...action })) });
    registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => member,
      authorizeProject: async () => { if (!allowed) throw Object.assign(new Error("Revoked"), { statusCode: 403 }); } });
    assert.deepEqual(createServiceToolCatalog(actions).resolveToolSet({ surface: "app" }).tools.map(({ actionId }) => actionId), []);
    const app = testRouteApp();
    registerRoutes(app.http, { localhostCheckBypassed: true, projectContext, pages });
    const call = async (method, suffix, params = {}, body = {}) => {
      const route = findRegisteredRoute(app, { method, path: `/api/app/:slug/vibe64${suffix}` });
      assert.ok(route, `${method} ${suffix}`);
      const request = {
        params: { slug: SLUG, ...params },
        input: { body },
        body,
        vibe64User: member,
        executeAction: ({ actionId, input }) => actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request } } })
      };
      const reply = captureReply();
      await route.handler(request, reply);
      return reply;
    };
    assert.deepEqual((await call("GET", "/pages")).payload.pages.map((entry) => entry.id), [page.id]);
    assert.equal((await call("GET", "/pages/:pageId", { pageId: page.id })).payload.page.version, 2);
    const view = (await call("POST", "/pages/:pageId/view", { pageId: page.id }, { theme: "dark" })).payload;
    assert.match(view.viewPath, /^\/api\/vibe64\/pages\/view\/[A-Za-z0-9_-]{43}$/u);
    const brought = (await call("POST", "/pages/:pageId/versions/:version/restore", { pageId: page.id, version: "1" })).payload.page;
    assert.equal(brought.version, 3);
    assert.deepEqual(brought.updatedBy, { id: "carol", name: "Carol" }, "a member's own action is theirs");
    const starred = (await call("POST", "/pages/:pageId/star", { pageId: page.id }, { starred: true })).payload;
    assert.deepEqual(starred.pages.map((entry) => entry.id), [page.id]);
    assert.deepEqual((await call("GET", "/pages/stars")).payload.pages.map((entry) => entry.id), [page.id], "the member's own stars");
    assert.deepEqual((await inProject(() => pages.starredPages({ vibe64User: { username: "dan" } }))).pages, []);
    // A refresh the session's AI set: members pause, resume, run and cancel it, and read its log.
    await inProject(() => pages.setPageRefresh({ pageId: page.id, kind: "prompt", every: "2h", prompt: "Recount the files", by: alice, sessionId: "s" }));
    const paused = (await call("POST", "/pages/:pageId/refresh/pause", { pageId: page.id })).payload.page.refresh;
    assert.deepEqual([paused.paused, paused.pausedReason], [true, "Paused by Carol."]);
    const resumed = (await call("POST", "/pages/:pageId/refresh/resume", { pageId: page.id })).payload.page.refresh;
    assert.deepEqual([resumed.paused, resumed.scheduledBy], [false, { id: "carol", name: "Carol" }], "it runs as the member who resumed it");
    assert.ok((await call("POST", "/pages/:pageId/refresh/run", { pageId: page.id })).payload.page.refresh.running);
    await call("POST", "/pages/:pageId/refresh/cancel", { pageId: page.id });
    let runs = [];
    for (let attempt = 0; attempt < 200 && !runs.length; attempt += 1) {
      runs = (await call("GET", "/pages/:pageId/refresh/runs", { pageId: page.id })).payload.runs;
      if (!runs.length) await new Promise((resolve) => setTimeout(resolve, 10));
    }
    assert.equal(runs.length, 1);
    assert.equal(runs[0].message, "AI refreshes are unavailable here.", "without the AI task window an AI refresh fails and says so");
    // The shared schema reads "yes", "on" and 1 as true; anything else, or nothing, is refused.
    for (const body of [{ starred: "perhaps" }, {}]) {
      await assert.rejects(call("POST", "/pages/:pageId/star", { pageId: page.id }, body), { statusCode: 400, code: "ACTION_VALIDATION_FAILED" });
    }
    assert.equal((await call("POST", "/pages/:pageId/archive", { pageId: page.id })).payload.page.archived, true);
    assert.equal((await call("POST", "/pages/:pageId/restore", { pageId: page.id })).payload.page.archived, false);
    await assert.rejects(call("DELETE", "/pages/:pageId", { pageId: page.id }), { code: "vibe64_pages_delete_requires_archive" });
    allowed = false;
    await assert.rejects(call("GET", "/pages"), { statusCode: 403 });
    await assert.rejects(call("POST", "/pages/:pageId/view", { pageId: page.id }), { statusCode: 403 });
    allowed = true;
    await call("POST", "/pages/:pageId/archive", { pageId: page.id });
    assert.equal((await call("DELETE", "/pages/:pageId", { pageId: page.id })).payload.pageId, page.id);
  });
});

test("a viewing link serves only its page's files, sandboxed to them, and nothing once it ends", async () => {
  let now = Date.UTC(2026, 10, 6, 9);
  await withPages(async ({ pages, inProject, projectRuntimeRoot, root }) => {
    const { page } = await inProject(() => pages.publishPage({ title: "Chart <&>", files: files("<p>Chart</p>", { "js/app.js": "console.log(1)", "data.json": "[1]" }), by: alice, sessionId: "s" }));
    const other = (await inProject(() => pages.publishPage({ title: "Other", files: files("<p>Other secret</p>"), by: alice, sessionId: "s" }))).page;
    await symlink(path.join(projectRuntimeRoot, "pages", other.id, "versions", "1", "index.html"),
      path.join(projectRuntimeRoot, "pages", page.id, "versions", "1", "linked.html"));
    const app = testRouteApp();
    registerRoutes(app.http, { localhostCheckBypassed: true, projectContext: { projectsRoot: root, currentPracticeProjectScope: () => null }, pages });
    const frameRoute = findRegisteredRoute(app, { method: "GET", path: "/api/vibe64/pages/view/:token" });
    const filesRoute = findRegisteredRoute(app, { method: "GET", path: "/api/vibe64/pages/files/:token/*" });
    const token = (await inProject(() => pages.openPageView({ pageId: page.id, theme: "dark" }))).viewPath.split("/").at(-1);
    const headers = { host: "127.0.0.1:4173" };
    const get = async (route, params, requestHeaders = headers) => {
      const reply = captureReply();
      // Sandboxed requests carry no cookie and no user: the token is all they have.
      await route.handler({ params, headers: requestHeaders, protocol: "http" }, reply);
      return reply;
    };
    const filesBase = `http://127.0.0.1:4173/api/vibe64/pages/files/${token}/`;

    const frame = await get(frameRoute, { token });
    assert.equal(frame.statusCode, 200);
    assert.match(frame.sent["content-security-policy"], new RegExp(`^default-src 'none'; style-src 'unsafe-inline'; frame-src ${filesBase.replaceAll(".", "\\.")}; form-action 'none'; base-uri 'none'; sandbox allow-scripts allow-forms allow-modals$`, "u"));
    assert.equal(frame.sent["cache-control"], "no-store");
    assert.equal(frame.sent["referrer-policy"], "no-referrer");
    assert.match(frame.payload, /<title>Chart &lt;&amp;&gt;<\/title>/u);
    assert.match(frame.payload, new RegExp(`<iframe src="/api/vibe64/pages/files/${token}/index.html" sandbox="allow-scripts allow-forms allow-modals"`, "u"));
    assert.doesNotMatch(frame.payload, /<script/u);

    const index = await get(filesRoute, { token, "*": "index.html" });
    assert.equal(index.payload.toString(), "<p>Chart</p>");
    assert.equal(index.sent["content-type"], "text/html; charset=utf-8");
    assert.equal(index.sent["content-security-policy"], pageContentSecurityPolicy(filesBase));
    assert.match(index.sent["content-security-policy"], /connect-src http:\/\/127\.0\.0\.1:4173\/api\/vibe64\/pages\/files\/[^/]+\/;/u);
    assert.match(index.sent["content-security-policy"], /sandbox allow-scripts allow-forms allow-modals$/u);
    assert.equal(index.sent["access-control-allow-origin"], "*");
    assert.equal((await get(filesRoute, { token, "*": "" })).payload.toString(), "<p>Chart</p>", "a folder serves its index.html");
    assert.equal((await get(filesRoute, { token, "*": "js/app.js" })).sent["content-type"], "text/javascript; charset=utf-8");
    const stylesheet = await get(filesRoute, { token, "*": "_vibe64/page.css" });
    assert.match(String(stylesheet.payload), /--v64-background: #111318;/u, "the dark viewer gets the dark stylesheet");
    for (const escape of ["../index.html", `../${other.id}/versions/1/index.html`, "linked.html", ".hidden", "%2e%2e/index.html", "missing.html"]) {
      const refused = await get(filesRoute, { token, "*": escape });
      assert.equal(refused.statusCode, 404, escape);
      assert.doesNotMatch(String(refused.payload), /secret/u, escape);
    }
    assert.equal((await get(filesRoute, { token: "x".repeat(43), "*": "index.html" })).statusCode, 404);
    assert.equal((await get(filesRoute, { token, "*": "index.html" }, {})).statusCode, 400, "no Host, no origin to confine it to");
    assert.equal(requestOrigin({ headers: { host: "evil.test/x" } }), "");
    assert.equal(requestOrigin({ headers: { host: "vibe64.example", "x-forwarded-proto": "https" } }), "https://vibe64.example");

    now += 16 * 60 * 1000;
    const lapsed = await get(filesRoute, { token, "*": "index.html" });
    assert.equal(lapsed.statusCode, 404, "a link lapses after 15 idle minutes");
    assert.match(String(lapsed.payload), /link has ended/u);
  }, { clock: () => now });
});
