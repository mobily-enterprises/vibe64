import { denseErdSchema } from "../fixtures/denseErdSchema.js";
import { createServer } from "node:http";
import { once } from "node:events";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { createCapabilityRuntime, defineProvider } from "@jskit-ai/kernel/shared/capabilities";
import { EventProvider } from "@jskit-ai/kernel/server/runtime";
import { RealtimeProvider } from "@jskit-ai/realtime/server/RealtimeProvider";
import { createService } from "../../packages/vibe64-database-tools/src/server/service.js";
import { createService as createSourceEditor } from "../../packages/vibe64-source-editor/src/server/service.js";
import { bookingOverview, dataOverviewSchema } from "../fixtures/dataOverviewSchema.js";
import { createDatabaseLayoutChangedPublisher } from "../../packages/vibe64-database-tools/src/server/events.js";
import { saveErdLayout } from "../../packages/vibe64-database-tools/src/server/sessionState.js";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import { DASHBOARD_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

// Real database service, shared artifact operations, event provider and sockets.
// Only the schema/SQL data and unrelated Studio shell are controlled fixtures.
async function sharedDiagramServer(frontend: string, { largeTable = false, schemaOverride = null, savedLayout = null, overviewDefinition = null, provider = "codex" } = {}) {
  const temporaryRoot = await mkdtemp(path.join(tmpdir(), "vibe64-overview-browser-"));
  const sourceRoot = (sessionId: string) => path.join(temporaryRoot, "sessions/active", sessionId, "source");
  for (const id of [directChatSessionId, "2026-09-10_00-00-01"]) await mkdir(sourceRoot(id), { recursive: true });
  const setOverview = async (definition, sessionId = directChatSessionId) => writeFile(path.join(sourceRoot(sessionId), "data-overview.json"), typeof definition === "string" ? definition : JSON.stringify(definition));
  if (overviewDefinition) await setOverview(overviewDefinition);
  const schema = schemaOverride || {
    engine: "postgresql", database: "erd_test", refreshedAt: "2026-09-07T00:00:00Z",
    schemas: [{ name: "public" }], relationships: largeTable ? [{
      id: "orders_jobs", constraintName: "orders_jobs_fk", columns: ["job_id"],
      referencedColumns: ["id"], referencedTable: "public.Jobs", sourceTable: "public.orders"
    }] : [],
    tables: ["customers", "orders", ...(largeTable ? ["Jobs"] : [])].map((name) => ({
      name, schema: "public", qualifiedName: `public.${name}`, kind: "table",
      columns: [
        { name: "id", nativeType: "integer", nullable: false },
        ...(name === "Jobs" ? Array.from({ length: 314 }, (_, index) => ({ name: `field_${index + 1}`, nativeType: "text", nullable: true })) : []),
        ...(largeTable && name === "orders" ? [{ name: "job_id", nativeType: "integer", nullable: false }] : [])
      ],
      keys: [{ name: `${name}_pkey`, columns: ["id"], primary: true }]
    }))
  };
  const artifacts = new Map();
  const store = {
    readSession: async (sessionId: string) => ({ sessionId, projectSlug: "example-target-app", metadata: { agent_identity_provider: provider, source_kind: "session_clone", source_path: sourceRoot(sessionId), source_path_authority: "managed_session_source" } }),
    readArtifact: async (sessionId: string, path: string) => path === "database/schema.json"
      ? JSON.stringify(schema) : artifacts.get(`${sessionId}:${path}`) || "",
    writeJsonArtifact: async (sessionId: string, path: string, value: unknown) => {
      artifacts.set(`${sessionId}:${path}`, JSON.stringify(value));
    }
  };
  await saveErdLayout(store, directChatSessionId, savedLayout || {
    nodes: [
      { table: "public.customers", x: 50, y: largeTable ? 350 : 50 }, { table: "public.orders", x: 450, y: 50 },
      ...(largeTable ? [{ table: "public.Jobs", x: 50, y: 50 }] : [])
    ],
    viewport: { x: 20, y: 20, zoom: 0.7 }
  });
  let service;
  const saves: { actor: string; layout: unknown }[] = [];
  const reads: string[] = [];
  const http = createServer(async (request, response) => {
    try {
      const url = new URL(request.url!, frontend);
      const match = url.pathname.match(/\/database\/sessions\/([^/]+)(.*)$/u);
      if (match) {
        const actor = String(request.headers["x-erd-user"] || "alice");
        const input = { sessionId: match[1], vibe64User: { username: actor, role: "owner" } };
        const chunks = [];
        for await (const chunk of request) chunks.push(chunk);
        const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString()) : {};
        let result;
        if (request.method === "PUT" && match[2] === "/layout") {
          result = await service.saveLayout({ ...input, ...body });
          saves.push({ actor, layout: result.layout });
        } else if (request.method === "PUT" && match[2] === "/overview") {
          result = await service.saveOverview({ ...input, ...body });
        } else if (request.method === "GET" && !match[2]) {
          reads.push(actor);
          result = await service.readState(input);
        } else if (match[2] === "/queries") {
          result = { ok: true, kind: "result-set", columns: [], rows: [], cellMeta: [], durationMs: 0 };
        } else {
          throw new Error(`Unexpected database request: ${request.method} ${url.pathname}`);
        }
        response.writeHead(result.ok === false ? 400 : 200, { "content-type": "application/json" });
        response.end(JSON.stringify(result));
        return;
      }
      const upstream = await fetch(url);
      response.writeHead(upstream.status, { "content-type": upstream.headers.get("content-type") || "text/plain" });
      response.end(Buffer.from(await upstream.arrayBuffer()));
    } catch (error) {
      response.writeHead(500, { "content-type": "application/json" });
      response.end(JSON.stringify({ ok: false, error: String(error) }));
    }
  });
  let realtime;
  let sourceEditor;
  const runtime = createCapabilityRuntime({
    inputs: {
      "runtime.config": {}, "runtime.env": {}, "runtime.fastify": { server: http },
      "runtime.logger": { debug() {}, warn() {}, info() {}, error() {} }
    },
    providers: [EventProvider, RealtimeProvider, defineProvider({
      id: "test.database", requires: { events: "runtime.events", realtime: "runtime.realtime" },
      setup(values) {
        realtime = values.realtime;
        const projectService = {
            createSessionStore: async () => store,
            createRuntime: async () => ({ getSession: store.readSession, store: { runSessionExclusive: async (_id, _lock, operation) => ({ acquired: true, value: await operation() }) } }),
            sessionDatabaseEnvironment: async () => ({ databaseToolEnvironment: {
              contract: "vibe64.database-tool-environment.v1", kind: schema.engine,
              read: { host: "127.0.0.1", port: 5432, database: schema.database, username: "reader" },
              write: { host: "127.0.0.1", port: 5432, database: schema.database, username: "writer" }
            } })
          };
        sourceEditor = createSourceEditor({ projectService, temporaryRoot });
        service = createService({
          projectService,
          sourceEditor,
          publishLayoutChanged: createDatabaseLayoutChangedPublisher(values.events),
          withKnex: () => { throw new Error("Layout synchronization must not execute SQL"); }
        });
        return {};
      }
    })]
  });
  await runtime.start();
  http.listen(0, "127.0.0.1");
  await once(http, "listening");
  const address = http.address() as { port: number };
  return {
    url: `http://127.0.0.1:${address.port}`, saves, reads,
    clients: () => realtime.diagnostics().connectedClients,
    setOverview,
    readOverviewFile: () => readFile(path.join(sourceRoot(directChatSessionId), "data-overview.json"), "utf8"),
    schema,
    close: async () => { await runtime.shutdown(); sourceEditor.close(); await rm(temporaryRoot, { force: true, recursive: true }); }
  };
}

async function openDiagram(page: Page, url: string, { waitForReady = true, view = "ERD", sessionId = directChatSessionId, provider = "codex" } = {}) {
  await mockDirectChatSession(page);
  const sourcePath = `/workspace/managed/example-target-app/sessions/active/${sessionId}/source`;
  const session = { ...directChatSessionPayload, sessionId, sourcePath, agentSession: { ...directChatSessionPayload.agentSession, providerId: provider }, metadata: {
    agent_identity_provider: provider,
    source_kind: "session_clone", source_path: sourcePath,
    source_path_authority: "managed_session_source"
  } };
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}`, (route) => fulfillJson(route, session));
  await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, { ok: true, sessions: [session] }));
  await routeApiEndpoint(page, "/vibe64/sessions/current", (route) => fulfillJson(route, { ok: true, sessionId }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/agent-session`, (route) => fulfillJson(route, { ok: true, ...session.agentSession }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/conversation-log`, (route) => fulfillJson(route, { ok: true, sessionId, conversationLog: [], pagination: { count: 0, hasMoreBefore: false, limit: 20, totalTurnCount: 0 } }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/work`, (route) => fulfillJson(route, { ok: true, sessionId, work: { active: false } }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/updates/check`, (route) => fulfillJson(route, { ok: true, sessionId, available: false }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/assistant-access`, (route) => fulfillJson(route, { ok: true, available: true, canUse: true, canRequestMessage: false, ownerOnly: false }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/source-editor/stars`, (route) => fulfillJson(route, { ok: true, files: [] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/message-suggestions`, (route) => fulfillJson(route, { ok: true, suggestions: [] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${sessionId}/renewal`, (route) => fulfillJson(route, { ok: true, renewal: null }));
  await routeApiEndpoint(page, "/vibe64/settings", (route) => fulfillJson(route, { ok: true, promptHints: { enabled: false, canEdit: true } }));
  await page.goto(`${url}${DASHBOARD_PATH}/database?sessionId=${sessionId}`);
  if (sessionId !== directChatSessionId) await page.getByRole("link", { name: "Database", exact: true }).click();
  if (view) await page.getByRole("button", { name: view, exact: true }).click({ timeout: 15_000 });
  if (view === "Overview") {
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(() => requestAnimationFrame(resolve)))));
  }
  if (!waitForReady) return;
  await expect(page.locator('.vue-flow__node[data-id="public.customers"]')).toBeVisible();
  await expect(page.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
}

async function overviewAction(page: Page, name: string) {
  const options = page.getByRole("button", { name: "Overview options", exact: true });
  const panel = page.locator(".database-overview__options");
  if (!await panel.isVisible()) await options.click();
  await panel.getByRole("button", { name, exact: true }).click();
  if (!await page.getByRole("dialog").isVisible()) {
    if (await options.getAttribute("aria-expanded") === "true") await options.click();
    await expect(panel).toBeHidden();
  }
}

async function diagramAction(page: Page, name: string) {
  const options = page.getByRole("button", { name: "Diagram options", exact: true });
  const panel = page.locator(".database-erd__options");
  if (await options.getAttribute("aria-expanded") !== "true") {
    await expect(panel).toBeHidden();
    await options.click();
  }
  await panel.getByRole("button", { name, exact: true }).click();
  if (!await page.getByRole("dialog").isVisible()) {
    if (await options.getAttribute("aria-expanded") === "true") await options.click();
    await expect(panel).toBeHidden();
  }
}

async function dragTable(page: Page, name: string, dx: number, dy: number) {
  const card = page.locator(`.vue-flow__node[data-id="public.${name}"]`);
  const box = (await card.boundingBox())!;
  await page.mouse.move(box.x + 80, box.y + 18);
  await page.mouse.down();
  await page.mouse.move(box.x + 80 + dx, box.y + 18 + dy, { steps: 8 });
  await page.mouse.up();
}

async function waitForDiagramViewport(page: Page) {
  await page.locator(".database-erd .vue-flow__transformationpane").evaluate(element => new Promise<void>(resolve => {
    let previous = "";
    let stableFrames = 0;
    const sample = () => {
      const current = element.getAttribute("style") || "";
      stableFrames = current === previous ? stableFrames + 1 : 0;
      previous = current;
      if (stableFrames === 3) resolve(); else requestAnimationFrame(sample);
    };
    requestAnimationFrame(sample);
  }));
}

async function controlRoutingWorker(page: Page, kind = "routes") {
  await page.addInitScript((kind) => {
    const NativeWorker = window.Worker;
    const queued: (() => void)[] = [];
    const control = { held: false, pending: () => queued.length, release: () => queued.shift()?.() };
    (window as any).erdRoutingControl = control;
    window.Worker = class extends NativeWorker {
      postMessage(message: any, ...args: any[]) {
        if (message?.kind === kind && control.held) {
          queued.push(() => super.postMessage(message, ...args));
        } else {
          super.postMessage(message, ...args);
        }
      }
    };
  }, kind);
  return {
    hold: () => page.evaluate(() => { (window as any).erdRoutingControl.held = true; }),
    pending: () => page.evaluate(() => (window as any).erdRoutingControl.pending()),
    release: () => page.evaluate(() => (window as any).erdRoutingControl.release())
  };
}

for (const width of [390, 1600]) {
  test(`@data-overview multi-hop expansion, relationship inspection and collapse at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", (error) => errors.push(error.message));
      await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
      await expect(page.getByText("7 / 8 tables classified")).toBeVisible();
      await expect(page.getByText("Arranging actors…")).toHaveCount(0);
      await expect(page.locator(".database-overview .vue-flow__node")).toHaveCount(4);
      const map = page.locator(".database-overview__map");
      const camera = map.locator(".vue-flow__transformationpane");
      const before = await camera.getAttribute("style");
      await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
      const details = page.getByRole("region", { name: "ERD for Bookings" });
      await expect(details.locator(".vue-flow__node-table")).toHaveCount(4);
      await expect(details.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
      await expect(map).toHaveCSS("opacity", "0.12");
      await expect(details.locator(".database-erd__canvas")).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(page.getByRole("button", { name: "Close expanded actor", exact: true })).toHaveCSS("background-color", "rgba(0, 0, 0, 0)");
      await expect(camera).toHaveAttribute("style", before!);
      await expect(details.locator('.vue-flow__node[data-id="public.addresses"]')).toHaveCount(0);
      const tables = details.getByRole("complementary", { name: "Actor tables and fields" });
      await tables.getByRole("button", { name: "checklists table", exact: false }).click();
      await expect(tables.locator(".database-workspace__table-detail")).toContainText("notes");
      await tables.locator(".database-workspace__table-detail").getByRole("button", { name: "notes text", exact: true }).click();
      await expect(details.locator('[data-id="public.checklists"]')).toContainText("notes");
      await page.screenshot({ path: testInfo.outputPath(`overview-expanded-${width}.png`) });
      await details.getByRole("button", { name: "Close details", exact: true }).click();
      await expect(details).toHaveCount(0);
      await expect(camera).toHaveAttribute("style", before!);
      await expect(map).toHaveCSS("opacity", "1");
      await expect(page.locator(".database-overview .vue-flow__node-actor")).toHaveCount(4);
      await page.getByRole("button", { name: "Explore Other tables", exact: true }).click();
      await expect(page.locator('.database-overview [data-id="public.audit_log"]')).toBeVisible();
      await page.getByRole("button", { name: "Close expanded actor", exact: true }).click({ position: { x: 3, y: 3 } });
      await expect(page.locator(".database-overview__detail")).toHaveCount(0);
      await page.screenshot({ path: testInfo.outputPath(`overview-collapsed-${width}.png`) });
      expect(errors).toEqual([]);
    } finally { await context.close(); await server.close(); }
  });
}

test("@data-overview smaller booking boundaries expose the actual invoice-group relation", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview({ split: true }) });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    const relationship = page.locator(".database-overview .vue-flow__edge").filter({ has: page.locator('path.vue-flow__edge-interaction') });
    await expect(relationship).toHaveCount(5);
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    // Stable graph order follows the real schema: invoice_groups -> checklists is the fourth boundary.
    await relationship.nth(3).locator(".vue-flow__edge-textbg").click({ timeout: 5000 });
    await expect(page.getByRole("complementary", { name: "Overview details" }).getByText("public.invoice_groups (1) → public.checklists (0..N)")).toBeVisible();
    await expect(page.getByRole("complementary", { name: "Overview details" })).toContainText("On delete: CASCADE · On update: NO ACTION");
    await page.getByRole("button", { name: "Close overview details" }).click();
    await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
    await expect(page.locator('.database-overview .vue-flow__node[data-id="public.invoice_groups"]')).toBeVisible();
    await expect(page.locator('.database-overview .vue-flow__node[data-id="public.checklists"]')).toHaveCount(0);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview edits persist in real source, reject stale forms and leave another session untouched", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const first = await context.newPage();
    const second = await context.newPage();
    await openDiagram(first, server.url, { view: "Overview", waitForReady: false });
    await openDiagram(second, server.url, { view: "Overview", waitForReady: false });
    for (const page of [first, second]) await overviewAction(page, "Edit actors");
    await first.getByRole("textbox", { name: "Name", exact: true }).fill("People");
    await first.getByRole("button", { name: "Save actors", exact: true }).click();
    await expect(first.getByRole("dialog")).toHaveCount(0);
    expect(JSON.parse(await server.readOverviewFile()).actors[0].name).toBe("People");
    await second.getByRole("textbox", { name: "Name", exact: true }).fill("Stale change");
    await second.getByRole("button", { name: "Save actors", exact: true }).click();
    await expect(second.getByRole("dialog").locator("p[role=alert]")).toContainText("changed");
    await expect(second.getByRole("textbox", { name: "Name", exact: true })).toHaveValue("Stale change");
    expect(JSON.parse(await server.readOverviewFile()).actors[0].name).toBe("People");
    await second.getByRole("button", { name: "Cancel", exact: true }).click();
    await first.reload();
    await first.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(first.getByRole("button", { name: "Explore People", exact: true })).toBeVisible();
    await openDiagram(second, server.url, { view: "Overview", waitForReady: false, sessionId: "2026-09-10_00-00-01" });
    await expect(second.getByText("0 / 8 tables classified")).toBeVisible();
    await expect(second.getByRole("button", { name: "Explore People", exact: true })).toHaveCount(0);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview schema drift and malformed source preserve complete table access", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    server.schema.tables = server.schema.tables.filter((table) => table.name !== "invoice_groups");
    server.schema.refreshedAt = new Date().toISOString();
    await overviewAction(page, "Reload overview");
    await expect(page.getByRole("alert").filter({ hasText: "Missing from" })).toContainText("public.invoice_groups");
    await server.setOverview("invalid JSON");
    await overviewAction(page, "Reload overview");
    await expect(page.getByRole("alert").filter({ hasText: "Repair data-overview.json" })).toBeVisible();
    await expect(page.getByText("0 / 7 tables classified")).toBeVisible();
    await page.getByRole("button", { name: "Explore Other tables", exact: true }).click();
    await expect(page.locator(".database-overview .vue-flow__node-table")).toHaveCount(7);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview 130-table schema stays collapsed and typing remains responsive during expansion", async ({ browser, baseURL }) => {
  const schema = denseErdSchema();
  const definition = { version: 1, actors: Array.from({ length: 13 }, (_, index) => ({ name: `Actor ${index}`, table: `public.table_${index * 10}`, description: "Supporting tables", tables: schema.tables.slice(index * 10, index * 10 + 10).map((table) => table.qualifiedName) })) };
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, overviewDefinition: definition });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await expect(page.locator(".database-overview .vue-flow__node")).toHaveCount(13);
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    for (let index = 0; index < 3; index += 1) {
      await page.getByRole("button", { name: `Explore Actor ${index}`, exact: true }).click();
      await expect(page.locator(".database-overview .vue-flow__node-table")).toHaveCount(10);
      const search = page.getByLabel("Message AI assistant");
      await search.fill(`typing ${index}`, { timeout: 2000 });
      await expect(search).toHaveValue(`typing ${index}`);
      await page.getByRole("button", { name: "Close details", exact: true }).click();
      await expect(page.locator(".database-overview .vue-flow__node-table")).toHaveCount(0);
    }
    expect(server.saves).toHaveLength(0);
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview a stale expansion cannot replace a newer collapse", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const worker = await controlRoutingWorker(page, "routes");
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await worker.hold();
    await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
    await expect.poll(worker.pending).toBe(1);
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await worker.release();
    await expect(page.locator(".database-overview .vue-flow__node-table")).toHaveCount(0);
    await expect(page.locator(".database-overview .vue-flow__node-actor")).toHaveCount(4);
    expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview unchanged refresh preserves zoom without another worker request", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const worker = await controlRoutingWorker(page, "overview");
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    const viewport = page.locator(".database-overview .vue-flow__transformationpane");
    const initial = await viewport.getAttribute("style");
    await overviewAction(page, "Zoom in");
    await expect(viewport).not.toHaveAttribute("style", initial!);
    const zoomed = await viewport.getAttribute("style");
    await worker.hold();
    const reloaded = page.waitForResponse((response) => response.url().endsWith(`/database/sessions/${directChatSessionId}`));
    await overviewAction(page, "Reload overview");
    await reloaded;
    await page.evaluate(() => new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await worker.pending()).toBe(0);
    await expect(viewport).toHaveAttribute("style", zoomed!);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview manual creation includes its main table and removal returns it to Other tables", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema() });
  const context = await browser.newContext({ viewport: { width: 390, height: 1000 } });
  try {
    const page = await context.newPage();
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await overviewAction(page, "Edit actors");
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("button", { name: "Add actor", exact: true }).click();
    await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Bookings");
    await dialog.getByRole("combobox", { name: "Main table", exact: true }).fill("public.bookings");
    await page.getByRole("option", { name: "public.bookings", exact: true }).click();
    await dialog.getByRole("textbox", { name: "What this actor contains", exact: true }).fill("Booking information");
    await dialog.getByRole("button", { name: "Save actors", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("1 / 8 tables classified")).toBeVisible();
    expect(JSON.parse(await server.readOverviewFile()).actors[0].tables).toEqual(["public.bookings"]);
    await overviewAction(page, "Edit actors");
    await dialog.getByRole("button", { name: "Remove actor", exact: true }).click();
    await dialog.getByRole("button", { name: "Save actors", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(page.getByText("0 / 8 tables classified")).toBeVisible();
    expect(JSON.parse(await server.readOverviewFile()).actors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

for (const width of [390, 1600]) {
  test(`@data-overview promote an internal table and merge it back at ${width}px`, async ({ browser, baseURL }) => {
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: { ...bookingOverview(), rings: [["public.contacts", "public.bookings"], ["public.dogs"]] } });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
      await page.locator('[data-id="actor:public.bookings"] strong').click();
      const details = page.locator(".database-overview__detail");
      await expect(details.locator(".vue-flow__node-table")).toHaveCount(4);
      await expect(details.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
      await details.getByRole("complementary", { name: "Actor tables and fields" }).getByRole("button", { name: "invoice_groups table", exact: false }).click();
      await diagramAction(page, "Make main actor");
      const dialog = page.getByRole("dialog");
      await dialog.getByRole("textbox", { name: "Name", exact: true }).fill("Invoice groups");
      await dialog.getByRole("button", { name: "Save actors", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      let saved = JSON.parse(await server.readOverviewFile());
      expect(saved.actors.find((actor) => actor.table === "public.invoice_groups").tables).toEqual(["public.invoice_groups"]);
      expect(saved.actors.find((actor) => actor.table === "public.bookings").tables).not.toContain("public.invoice_groups");
      await expect(page.getByText("Arranging actors…")).toHaveCount(0);
      await page.getByRole("button", { name: "Close details", exact: true }).click();
      await page.getByRole("button", { name: "Fit", exact: true }).click();
      await page.locator('[data-id="actor:public.invoice_groups"] strong').click();
      await diagramAction(page, "Edit or merge actor");
      await dialog.getByRole("combobox", { name: "Merge into another actor", exact: true }).locator("..").click();
      await page.getByRole("option", { name: "Bookings", exact: true }).click();
      await dialog.getByRole("button", { name: "Merge actor and its tables", exact: true }).click();
      await dialog.getByRole("button", { name: "Save actors", exact: true }).click();
      await expect(dialog).toHaveCount(0);
      saved = JSON.parse(await server.readOverviewFile());
      expect(saved.actors.some((actor) => actor.table === "public.invoice_groups")).toBe(false);
      expect(saved.actors.find((actor) => actor.table === "public.bookings").tables).toContain("public.invoice_groups");
      expect(saved.rings.flat().sort()).toEqual(saved.actors.map((actor) => actor.table).sort());
      expect(new Set(saved.reviewedTables).size).toBe(7);
      expect(new Set(saved.actors.flatMap((actor) => actor.tables)).size).toBe(7);
      await expect(page.getByText("7 / 8 tables classified")).toBeVisible();
    } finally { await context.close(); await server.close(); }
  });
}

test("@data-overview generation levels and new-only scope preserve reviewed Other tables", async ({ browser, baseURL }) => {
  const schema = dataOverviewSchema();
  const definition = { ...bookingOverview(), abstraction: "high", reviewedTables: schema.tables.map((table) => table.qualifiedName) };
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, overviewDefinition: definition });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    page.setDefaultTimeout(7000);
    const turns = [];
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await page.getByRole("button", { name: "Overview options", exact: true }).click();
    await expect(page.getByText("Not yet reviewed: 0", { exact: true })).toBeVisible();
    await overviewAction(page, "Review with AI");
    let dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Process new tables only (0)", exact: true })).toBeDisabled();
    await expect(dialog.getByRole("combobox", { name: "Abstraction", exact: true })).toHaveValue("Very abstract");
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expect(dialog).toBeHidden();
    schema.tables.push({ ...schema.tables[0], name: "new_table", qualifiedName: "public.new_table" });
    schema.refreshedAt = "2026-09-11T00:00:00Z";
    await overviewAction(page, "Reload overview");
    await page.getByRole("button", { name: "Overview options", exact: true }).click();
    await expect(page.getByText("Not yet reviewed: 1", { exact: true })).toBeVisible();
    const endpoint = `/vibe64/sessions/${directChatSessionId}/temporary-conversations`;
    await routeApiEndpoint(page, endpoint, (route) => fulfillJson(route, { ok: true, conversationId: "overview-scope" }));
    await routeApiEndpoint(page, `${endpoint}/overview-scope/turns`, (route) => { turns.push(route.request().postDataJSON()); return fulfillJson(route, { ok: true, runId: "scope-turn", status: "inProgress" }); });
    await routeApiEndpoint(page, `${endpoint}/overview-scope`, (route) => fulfillJson(route, { ok: true, message: "Finished.", outcome: { kind: "complete" }, runId: "scope-turn", status: "completed" }));
    await overviewAction(page, "Review with AI");
    dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("radio", { name: "Process new tables only (1)", exact: true })).toBeChecked();
    await dialog.getByRole("combobox", { name: "Abstraction", exact: true }).locator("..").click();
    for (const label of ["Not abstract", "Balanced", "Very abstract"]) await expect(page.getByRole("option", { name: label, exact: true })).toBeVisible();
    await page.getByRole("option", { name: "Not abstract", exact: true }).click();
    await dialog.getByRole("button", { name: "Generate overview", exact: true }).click();
    await expect.poll(() => turns.length).toBe(1);
    expect(turns[0].message).toContain("Process only coverage.unreviewed");
    expect(turns[0].message).toContain("Preserve existing actors, names, descriptions, memberships and manual choices");
    expect(turns[0].message).toContain("Not abstract (none)");
    expect(turns[0].message).toContain("including those deliberately left under Other tables");
    expect(JSON.parse(await server.readOverviewFile())).toEqual(definition);
  } finally { await context.close(); await server.close(); }
});

for (const provider of ["codex", "opencode"]) {
  test(`@data-overview ${provider} receives the same source-write authoring task`, async ({ browser, baseURL }) => {
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), provider });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const page = await context.newPage();
      const created = [];
      const turns = [];
      await openDiagram(page, server.url, { view: "Overview", waitForReady: false, provider });
      const endpoint = `/vibe64/sessions/${directChatSessionId}/temporary-conversations`;
      await routeApiEndpoint(page, endpoint, async (route) => { created.push(route.request().postDataJSON()); await fulfillJson(route, { ok: true, conversationId: "overview-ai" }); });
      await routeApiEndpoint(page, `${endpoint}/overview-ai/turns`, async (route) => {
        turns.push(route.request().postDataJSON());
        await server.setOverview(bookingOverview());
        await fulfillJson(route, { ok: true, runId: "overview-turn", status: "inProgress" });
      });
      await routeApiEndpoint(page, `${endpoint}/overview-ai`, (route) => fulfillJson(route, { ok: true, message: "Overview created.", outcome: { kind: "complete" }, runId: "overview-turn", status: "completed" }));
      await page.getByRole("button", { name: "Create with AI", exact: true }).click();
      await page.getByRole("button", { name: "Generate overview", exact: true }).click();
      await expect.poll(() => created.length).toBe(1);
      await expect.poll(() => turns.length).toBe(1);
      expect(created[0].policy).toBe("workspace_write");
      expect(turns[0].policy).toBe("workspace_write");
      expect(turns[0].message).toContain("vibe64-database overview --json");
      expect(turns[0].message).toContain("data-overview.json");
      expect(turns[0].message).toContain("several relationships away");
      expect(turns[0].message).toContain("do not change database records");
      await expect(page.getByRole("region", { name: "Temporary AI workspace" })).toContainText("Overview created.");
      await overviewAction(page, "Reload overview");
      await expect(page.getByText("7 / 8 tables classified")).toBeVisible();
      await page.getByRole("button", { name: "Overview options", exact: true }).click();
      await expect(page.getByRole("button", { name: "Review with AI", exact: true })).toBeEnabled();
    } finally { await context.close(); await server.close(); }
  });
}

test("@data-overview actual local database schema and authored grouping remain completely explorable", async ({ browser, baseURL }, testInfo) => {
  // Visit every actor, including the 31-actor WHS2 acceptance fixture.
  test.setTimeout(300_000);
  test.skip(!process.env.VIBE64_OVERVIEW_SCHEMA || !process.env.VIBE64_OVERVIEW_DEFINITION, "Provide read-only local schema and authored overview JSON paths for acceptance.");
  const schema = JSON.parse(await readFile(process.env.VIBE64_OVERVIEW_SCHEMA!, "utf8"));
  const definition = JSON.parse(await readFile(process.env.VIBE64_OVERVIEW_DEFINITION!, "utf8"));
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, overviewDefinition: definition });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    await expect(page.locator(".database-overview [role=alert]")).toHaveCount(0);
    const assigned = new Set(definition.actors.flatMap((actor) => actor.tables));
    const hasOthers = schema.tables.some((table) => !assigned.has(table.qualifiedName));
    await expect(page.locator(".database-overview .vue-flow__node-actor")).toHaveCount(definition.actors.length + Number(hasOthers));
    await page.screenshot({ path: testInfo.outputPath("local-database-overview.png") });
    const map = page.locator(".database-overview__map");
    const camera = map.locator(".vue-flow__transformationpane");
    const viewport = await camera.getAttribute("style");
    const rendered = [];
    const actors = [...definition.actors];
    if (hasOthers) actors.push({ name: "Other tables", tables: schema.tables.filter(table => !assigned.has(table.qualifiedName)).map(table => table.qualifiedName) });
    for (const actor of actors) {
      const started = Date.now();
      await page.getByRole("button", { name: `Explore ${actor.name}`, exact: true }).click();
      const details = page.locator(".database-overview__detail");
      await expect(details.locator(".vue-flow__node-table")).toHaveCount(actor.tables.length);
      await expect(details.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
      const ids = await details.locator(".vue-flow__node-table").evaluateAll(elements => elements.map(element => element.getAttribute("data-id")).sort());
      expect(ids).toEqual([...actor.tables].sort());
      rendered.push(...ids);
      await expect(camera).toHaveAttribute("style", viewport!);
      if (actor === actors[0]) await page.screenshot({ path: testInfo.outputPath("local-database-actor-erd.png") });
      await testInfo.attach(`actor-${actor.name}-timing`, { body: JSON.stringify({ tables: ids.length, milliseconds: Date.now() - started }), contentType: "application/json" });
      await page.getByRole("button", { name: "Close details", exact: true }).click();
    }
    expect(rendered.sort()).toEqual(schema.tables.map(table => table.qualifiedName).sort());
    expect(server.saves).toHaveLength(0);
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole("button", { name: "Show project", exact: true }).click();
    await page.getByRole("button", { name: "Fit", exact: true }).click();
    await expect(page.getByRole("button", { name: "Overview options", exact: true })).toBeInViewport();
    await page.screenshot({ path: testInfo.outputPath("local-database-mobile.png") });
    expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

for (const view of ["Overview", "ERD"] as const) {
  for (const interaction of ["crossing relationships", "zooming"]) test(`@erd-performance ${view} remains responsive while ${interaction} in the actual local schema`, async ({ browser, baseURL }, testInfo) => {
    test.setTimeout(180_000);
    test.skip(!process.env.VIBE64_OVERVIEW_SCHEMA || !process.env.VIBE64_OVERVIEW_DEFINITION, "Provide the read-only local schema and overview fixtures.");
    const schema = JSON.parse(await readFile(process.env.VIBE64_OVERVIEW_SCHEMA!, "utf8"));
    const definition = JSON.parse(await readFile(process.env.VIBE64_OVERVIEW_DEFINITION!, "utf8"));
    const actor = [...definition.actors].sort((a, b) => b.tables.length - a.tables.length)[0];
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, overviewDefinition: definition });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await openDiagram(page, server.url, { view, waitForReady: false });
      if (view === "Overview") await page.getByRole("button", { name: `Explore ${actor.name}`, exact: true }).click();
      const diagram = page.locator(".database-erd");
      try {
        await expect(diagram.locator(".database-erd-node")).toHaveCount(view === "Overview" ? actor.tables.length : schema.tables.length, { timeout: 30_000 });
      } catch (error) {
        console.error("ERD load diagnostic", await diagram.innerText().catch(() => "No diagram mounted"), errors);
        await page.screenshot({ path: testInfo.outputPath("load-failure.png") });
        throw error;
      }
      await expect(diagram.getByText("Arranging tables…", { exact: true })).toHaveCount(0, { timeout: 60_000 });
      await diagram.getByRole("button", { name: "Fit", exact: true }).click();
      await waitForDiagramViewport(page);
      const points = await diagram.locator(".vue-flow__edge-interaction").evaluateAll((paths: SVGPathElement[]) => {
        const points = [];
        for (const path of paths) {
          for (const fraction of [.3, .5, .7]) {
            const point = path.getPointAtLength(path.getTotalLength() * fraction);
            const screen = new DOMPoint(point.x, point.y).matrixTransform(path.getScreenCTM()!);
            if (document.elementFromPoint(screen.x, screen.y)?.closest(".vue-flow__edge") === path.closest(".vue-flow__edge")) {
              points.push({ x: screen.x, y: screen.y });
              break;
            }
          }
          if (points.length === 12) break;
        }
        return points;
      });
      expect(points).toHaveLength(12);
      const profiler = await context.newCDPSession(page);
      await profiler.send("Profiler.enable");
      await profiler.send("Profiler.start");
      const latencies = [];
      if (interaction === "crossing relationships") for (const point of points) {
        const start = await page.evaluate(() => performance.now());
        await page.mouse.move(point.x, point.y);
        const end = await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
        latencies.push(end - start);
        await expect(diagram.locator(".vue-flow__edge-text")).not.toHaveCount(0);
      }
      if (interaction === "zooming") {
        const camera = diagram.locator(".vue-flow__transformationpane");
        const savesBeforeZoom = server.saves.length;
        const box = (await diagram.locator(".vue-flow__pane").boundingBox())!;
        await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
        const positions = await diagram.locator(".vue-flow__node-table").evaluateAll(nodes => nodes.map((node: HTMLElement) => node.style.transform));
        let previous = await camera.getAttribute("style");
        // Real wheel input must change the diagram, not scroll the page. Sample
        // both directions and include paint time, not just event dispatch.
        for (const delta of [...Array(18).fill(-70), ...Array(18).fill(70)]) {
          const start = await page.evaluate(() => performance.now());
          await page.mouse.wheel(0, delta);
          const end = await page.evaluate(() => new Promise<number>(resolve => requestAnimationFrame(() => requestAnimationFrame(() => resolve(performance.now())))));
          latencies.push(end - start);
          const current = await camera.getAttribute("style");
          expect(current).not.toBe(previous);
          previous = current;
        }
        expect(await diagram.locator(".vue-flow__node-table").evaluateAll(nodes => nodes.map((node: HTMLElement) => node.style.transform))).toEqual(positions);
        await expect(diagram.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
        if (view === "ERD") {
          const finalZoom = Number(previous!.match(/scale\(([^)]+)\)/)![1]);
          await expect.poll(() => (server.saves.at(-1)?.layout as { viewport: { zoom: number } } | undefined)?.viewport.zoom).toBeCloseTo(finalZoom, 5);
          // The final camera is saved, without a write/reload for every tick.
          expect(server.saves.length - savesBeforeZoom).toBeLessThanOrEqual(2);
        } else expect(server.saves).toHaveLength(0);
      }
      const { profile } = await profiler.send("Profiler.stop");
      await writeFile(testInfo.outputPath(`${interaction}.cpuprofile`), JSON.stringify(profile));
      await profiler.detach();
      const timingPath = testInfo.outputPath(`${interaction}-frame-latencies.json`);
      await writeFile(timingPath, JSON.stringify({ view, interaction, tables: schema.tables.length, latencies }));
      await testInfo.attach(`${interaction}-frame-latencies`, { path: timingPath, contentType: "application/json" });
      // Broad enough for local scheduling noise; rejects repeated half-second
      // main-thread freezes when a hover rebuilds the entire graph.
      const median = [...latencies].sort((a, b) => a - b)[Math.floor(latencies.length / 2)];
      expect(median).toBeLessThan(250);
      expect(Math.max(...latencies)).toBeLessThan(750);
      expect(errors).toEqual([]);
    } finally { await context.close(); await server.close(); }
  });
}

for (const pendingAction of ["remote move", "local column change"]) {
  test(`@erd-routing-race a newer shared layout retires a pending ${pendingAction}`, async ({ browser, baseURL }, testInfo) => {
    const server = await sharedDiagramServer(baseURL!);
    const alice = await browser.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { "x-erd-user": "alice" } });
    const bob = await browser.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { "x-erd-user": "bob" } });
    try {
      const first = await alice.newPage();
      const second = await bob.newPage();
      const errors: string[] = [];
      for (const page of [first, second]) page.on("pageerror", error => errors.push(error.message));
      const routing = await controlRoutingWorker(second);
      await openDiagram(first, server.url);
      await openDiagram(second, server.url);
      await expect.poll(server.clients).toBe(2);
      const reset = second.getByRole("button", { name: "Fit", exact: true });
      const orders = '.vue-flow__node[data-id="public.orders"]';
      const position = (page: Page) => page.locator(orders).evaluate((node: HTMLElement) => node.style.transform);
      const initialPosition = await position(second);
      const camera = second.locator(".vue-flow__transformationpane");
      const initialCamera = await camera.getAttribute("style");
      const initialSaves = server.saves.length;
      await routing.hold();
      if (pendingAction === "remote move") {
        await dragTable(first, "customers", 80, 60);
      } else {
        await diagramAction(second, "All columns");
      }
      await expect.poll(routing.pending).toBe(1);
      await dragTable(first, "orders", -70, 130);
      const expectedSaves = initialSaves + (pendingAction === "remote move" ? 2 : 1);
      await expect.poll(() => server.saves.length).toBe(expectedSaves);
      await expect.poll(() => position(second)).not.toBe(initialPosition);
      await expect(reset).toBeDisabled();

      // Finish only the older route. The latest real-worker request is still
      // held, so the stale operation must neither unlock controls nor save.
      await routing.release();
      await expect.poll(routing.pending).toBe(1);
      await second.screenshot({ path: testInfo.outputPath("newer-layout-still-routing.png") });
      expect.soft(server.saves).toHaveLength(expectedSaves);
      await expect.soft(reset).toBeDisabled();
      await routing.release();
      await expect(reset).toBeEnabled();
      await expect.poll(() => position(second)).toBe(await position(first));
      expect(await camera.getAttribute("style")).toBe(initialCamera);
      expect(server.saves).toHaveLength(expectedSaves);
      expect(errors).toEqual([]);
    } finally {
      await Promise.allSettled([alice.close(), bob.close()]);
      await server.close();
    }
  });
}

test("shared ERD moves reach another browser without reloads or echo saves", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!);
  const alice = await browser.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { "x-erd-user": "alice" } });
  const bob = await browser.newContext({ viewport: { width: 1600, height: 1000 }, extraHTTPHeaders: { "x-erd-user": "bob" } });
  try {
    const first = await alice.newPage();
    const second = await bob.newPage();
    await openDiagram(first, server.url);
    await openDiagram(second, server.url);
    await expect.poll(server.clients).toBe(2);
    const customers = '.vue-flow__node[data-id="public.customers"]';
    const orders = '.vue-flow__node[data-id="public.orders"]';
    const position = (page: Page, selector: string) => page.locator(selector).evaluate((node: HTMLElement) => node.style.transform);
    const original = await position(second, customers);
    const camera = await second.locator(".vue-flow__transformationpane").getAttribute("style");
    const startSaves = server.saves.length;
    await dragTable(first, "customers", 100, 90);
    await expect.poll(() => server.saves.length).toBe(startSaves + 1);
    await expect.poll(() => position(second, customers)).not.toBe(original);
    await expect.poll(() => position(second, customers)).toBe(await position(first, customers));
    expect(await second.locator(".vue-flow__transformationpane").getAttribute("style")).toBe(camera);
    expect(server.saves.at(-1)!.actor).toBe("alice");

    await dragTable(second, "orders", -70, 130);
    await expect.poll(() => server.saves.length).toBe(startSaves + 2);
    await expect.poll(() => position(first, orders)).toBe(await position(second, orders));
    expect(server.saves.at(-1)!.actor).toBe("bob");
    const saved = await position(first, orders);
    await second.reload();
    await second.getByRole("button", { name: "ERD", exact: true }).click();
    await expect.poll(() => position(second, orders)).toBe(saved);
    expect(server.saves).toHaveLength(startSaves + 2);

    await first.getByRole("tab", { name: "Preview", exact: true }).click();
    const hiddenReads = server.reads.filter((actor) => actor === "alice").length;
    await dragTable(second, "customers", 40, 35);
    await expect.poll(() => server.saves.length).toBe(startSaves + 3);
    expect(server.reads.filter((actor) => actor === "alice")).toHaveLength(hiddenReads);
    await first.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await expect.poll(() => position(first, customers)).toBe(await position(second, customers));
    expect(server.saves).toHaveLength(startSaves + 3);

    await diagramAction(second, "Reset positions");
    await expect.poll(() => server.saves.length).toBe(startSaves + 4);
    await expect.poll(() => position(first, customers)).toBe(await position(second, customers));
    await expect.poll(() => position(first, orders)).toBe(await position(second, orders));
    const card = (await first.locator(customers).boundingBox())!;
    await first.mouse.move(card.x + 80, card.y + 18);
    await first.mouse.down();
    await first.mouse.move(card.x + 120, card.y + 65, { steps: 6 });
    const remoteRead = first.waitForResponse((response) => response.request().method() === "GET" &&
      response.url().endsWith(`/database/sessions/${directChatSessionId}`), { timeout: 10_000 });
    await dragTable(second, "orders", 60, 25);
    await (await remoteRead).json();
    await first.evaluate(() => new Promise(requestAnimationFrame));
    await first.mouse.up();
    await expect.poll(() => server.saves.length).toBe(startSaves + 6);
    await expect.poll(() => position(first, orders)).toBe(await position(second, orders));
    await expect.poll(() => position(second, customers)).toBe(await position(first, customers));
  } finally {
    await Promise.allSettled([alice.close(), bob.close()]);
    await server.close();
  }
});

for (const width of [390, 960, 1600]) {
  test(`showing 315 fields preserves every table position and the camera at ${width}px`, async ({ browser, baseURL }) => {
    const server = await sharedDiagramServer(baseURL!, { largeTable: true });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await openDiagram(page, server.url);
      const jobs = page.locator('.vue-flow__node[data-id="public.Jobs"]');
      const positions = () => page.locator(".vue-flow__node").evaluateAll((nodes: HTMLElement[]) =>
        nodes.map((node) => ({ id: node.dataset.id, position: node.style.transform })));
      const initialPositions = await positions();
      const camera = page.locator(".vue-flow__transformationpane");
      const initialCamera = await camera.getAttribute("style");
      const initialSaves = server.saves.length;
      await expect(jobs.locator("[data-column]")).toHaveCount(1);

      await diagramAction(page, "All columns");
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
      await expect.poll(() => server.saves.length).toBe(initialSaves + 1);
      expect(await positions()).toEqual(initialPositions);
      expect(await camera.getAttribute("style")).toBe(initialCamera);

      await diagramAction(page, "Keys only");
      await expect(jobs.locator("[data-column]")).toHaveCount(1);
      await jobs.getByRole("button", { name: "Show all 315", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
      await expect.poll(() => server.saves.length).toBe(initialSaves + 3);
      expect(await positions()).toEqual(initialPositions);
      expect(await camera.getAttribute("style")).toBe(initialCamera);

      await jobs.getByRole("button", { name: "Collapse table", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(0);
      await jobs.getByRole("button", { name: "Expand table", exact: true }).click();
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
      await expect.poll(() => server.saves.length).toBe(initialSaves + 5);
      expect(await positions()).toEqual(initialPositions);
      expect(await camera.getAttribute("style")).toBe(initialCamera);

      await diagramAction(page, "Reset positions");
      await expect.poll(() => server.saves.length).toBe(initialSaves + 6);
      expect(await positions()).not.toEqual(initialPositions);
      await expect(jobs.locator("[data-column]")).toHaveCount(315);
    } finally {
      await context.close();
      await server.close();
    }
  });
}


for (const saved of [false, true]) {
  test(`@erd-dense 130 tables and 479 links remain usable with ${saved ? "saved" : "new"} positions`, async ({ browser, baseURL }) => {
    const schema = denseErdSchema();
    const savedNodes = saved ? schema.tables.slice(0, 126).map((table, index) => ({
      table: table.qualifiedName, x: index % 10 * 420, y: Math.floor(index / 10) * 360
    })) : [];
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, savedLayout: {
      nodes: savedNodes, viewport: { x: 20, y: 20, zoom: 0.3 }
    } });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await page.addInitScript(() => {
        const NativeWorker = window.Worker;
        (window as any).erdRoutingRequests = 0;
        window.Worker = class extends NativeWorker {
          postMessage(message: any, ...args: any[]) {
            if (message?.kind === "routes") (window as any).erdRoutingRequests += 1;
            super.postMessage(message, ...args);
          }
        };
      });
      await openDiagram(page, server.url, { waitForReady: false });
      await expect.poll(() => page.evaluate(() => (window as any).erdRoutingRequests)).toBeGreaterThan(0);
      const started = Date.now();
      const search = page.getByRole("combobox", { name: "Find table or column" });
      await search.fill("table_1");
      expect(Date.now() - started).toBeLessThan(1500);
      await search.press("Escape");
      await expect(page.locator(".vue-flow__node")).toHaveCount(130, { timeout: 15_000 });
      await expect(page.locator(".vue-flow__edge")).toHaveCount(479, { timeout: 15_000 });
      const reset = page.getByRole("button", { name: "Fit", exact: true });
      await expect(reset).toBeEnabled({ timeout: 15_000 });
      await expect.poll(() => server.saves.length).toBe(1);
      const positions = () => page.locator(".vue-flow__node").evaluateAll((nodes: HTMLElement[]) => nodes.map(node => ({ id: node.dataset.id, position: node.style.transform })));
      const initial = await positions();
      if (saved) {
        const persisted = new Map((server.saves[0].layout as any).nodes.map(node => [node.table, node]));
        for (const node of savedNodes) expect(persisted.get(node.table)).toMatchObject({ x: node.x, y: node.y });
      }
      await diagramAction(page, "All columns");
      await expect.poll(() => server.saves.length).toBe(2);
      expect(await positions()).toEqual(initial);
      await expect(page.locator(".vue-flow__edge")).toHaveCount(479);
      await diagramAction(page, "Keys only");
      await expect.poll(() => server.saves.length).toBe(3);
      await diagramAction(page, "Reset positions");
      // Leave while the worker is active, then return using the warm workspace.
      await page.getByRole("button", { name: "Data", exact: true }).click();
      await page.getByRole("button", { name: "ERD", exact: true }).click();
      await expect(reset).toBeEnabled({ timeout: 15_000 });
      await expect(page.locator(".vue-flow__edge")).toHaveCount(479);
      expect(errors).toEqual([]);
    } finally {
      await context.close();
      await server.close();
    }
  });
}

test("@erd-dense routing worker errors leave an actionable retry and recover", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await page.addInitScript(() => {
      const NativeWorker = window.Worker;
      let failed = false;
      window.Worker = class extends NativeWorker {
        postMessage(message: any, ...args: any[]) {
          if (message?.kind === "routes" && !failed) {
            failed = true;
            setTimeout(() => this.dispatchEvent(new MessageEvent("message", { data: { id: message.id, ok: false, error: "Routing worker unavailable" } })), 30);
            return;
          }
          super.postMessage(message, ...args);
        }
      };
    });
    await openDiagram(page, server.url, { waitForReady: false });
    await expect(page.locator('.database-erd__notice[role="alert"]')).toContainText("Routing worker unavailable");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(page.locator('.database-erd__notice[role="alert"]')).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Fit", exact: true })).toBeEnabled();
    await expect(page.locator(".vue-flow__node")).toHaveCount(2);
    expect(errors).toEqual([]);
  } finally {
    await context.close();
    await server.close();
  }
});

for (const width of [1500, 1250, 1000, 820, 390]) {
  test(`@data-overview uses the whole project pane across sidebar breakpoints at ${width}px`, async ({ browser, baseURL }) => {
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
      const widths = () => page.evaluate(() => {
        const body = document.querySelector(".database-workspace__body")!.getBoundingClientRect();
        const overview = document.querySelector(".database-overview")!.getBoundingClientRect();
        return { body: body.width, overview: overview.width };
      });
      await expect.poll(async () => { const size = await widths(); return size.overview / size.body; }).toBeGreaterThan(0.98);
      const toggle = page.getByRole("button", { name: "Collapse chat", exact: true });
      if (await toggle.isVisible()) {
        await toggle.click();
        await expect.poll(async () => { const size = await widths(); return size.overview / size.body; }).toBeGreaterThan(0.98);
        await page.getByRole("button", { name: "Show chat", exact: true }).click();
        await expect.poll(async () => { const size = await widths(); return size.overview / size.body; }).toBeGreaterThan(0.98);
      }
      if ((await widths()).body <= 1180) {
        await page.getByRole("button", { name: "Copilot", exact: true }).click();
        await expect.poll(async () => { const size = await widths(); return size.overview / size.body; }).toBeGreaterThan(0.98);
      }
    } finally { await context.close(); await server.close(); }
  });
}

test("@data-overview defaults to Overview without SQL and keeps the AI-selected centre through expansion", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: { ...bookingOverview(), rings: [["public.contacts"], ["public.bookings", "public.dogs"]] } });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const queries = [];
    page.on("request", (request) => { if (request.url().endsWith("/queries")) queries.push(request); });
    await openDiagram(page, server.url, { view: null, waitForReady: false });
    await expect(page.locator(".database-overview")).toBeVisible();
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    expect(queries).toHaveLength(0);
    const tabs = page.locator(".database-workspace__header .v-btn-toggle .v-btn__content");
    await expect(tabs).toHaveText(["Overview", "ERD", "Data"]);
    const boxes = async () => page.locator(".database-overview .vue-flow__node-actor").evaluateAll((elements) => elements.map((element) => {
      const box = element.getBoundingClientRect();
      return { id: element.getAttribute("data-id"), x: box.x + box.width / 2, y: box.y + box.height / 2, width: box.width, height: box.height };
    }));
    let actors = await boxes();
    const centre = actors.find((node) => node.id === "actor:public.contacts")!;
    const others = actors.filter((node) => node !== centre);
    const distances = others.map((node) => Math.hypot(node.x - centre.x, node.y - centre.y));
    expect(Math.max(...distances) - Math.min(...distances)).toBeLessThan(2);
    expect(Math.min(...distances)).toBeGreaterThan(centre.width);
    const bookings = actors.find((node) => node.id === "actor:public.bookings")!;
    const dogs = actors.find((node) => node.id === "actor:public.dogs")!;
    expect(bookings.width * bookings.height).toBeGreaterThan(dogs.width * dogs.height);
    expect(bookings.width * bookings.height / (dogs.width * dogs.height)).toBeLessThanOrEqual(2.01);
    await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    actors = await boxes();
    const expandedCentre = actors.find((node) => node.id === "actor:public.contacts")!;
    const expandedDistances = actors.filter((node) => node !== expandedCentre).map((node) => Math.hypot(node.x - expandedCentre.x, node.y - expandedCentre.y));
    expect(Math.max(...expandedDistances) - Math.min(...expandedDistances)).toBeLessThan(2);
    expect(queries).toHaveLength(0);
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await page.getByRole("button", { name: "Data", exact: true }).click();
    await expect.poll(() => queries.length).toBe(1);
  } finally { await context.close(); await server.close(); }
});

test("@data-overview scoped ERD centres the main table, shares selection, and prevents dragging only in the scoped view", async ({ browser, baseURL }, testInfo) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    const camera = page.locator(".database-overview__map .vue-flow__transformationpane");
    const before = await camera.getAttribute("style");
    await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
    const details = page.getByRole("region", { name: "ERD for Bookings" });
    await expect(details.locator(".vue-flow__node-table")).toHaveCount(4);
    await expect(details.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
    const positions = await details.locator(".vue-flow__node-table").evaluateAll(elements => elements.map(element => {
      const box = element.getBoundingClientRect();
      return { id: element.getAttribute("data-id"), x: box.x + box.width / 2, y: box.y + box.height / 2 };
    }));
    const main = positions.find(node => node.id === "public.bookings")!;
    const supporting = positions.filter(node => node !== main);
    expect(Math.abs(supporting.reduce((sum, node) => sum + node.x, 0) / supporting.length - main.x)).toBeLessThan(2);
    expect(Math.abs(supporting.reduce((sum, node) => sum + node.y, 0) / supporting.length - main.y)).toBeLessThan(2);
    await page.screenshot({ path: testInfo.outputPath("overview-centred-erd.png") });
    const mainCard = details.locator('[data-id="public.bookings"]');
    const positionBefore = await mainCard.getAttribute("style");
    await dragTable(page, "bookings", 90, 50);
    await expect(mainCard).toHaveAttribute("style", positionBefore!);
    await expect(details.locator('.vue-flow__node-table.draggable')).toHaveCount(0);
    await details.getByRole("button", { name: "Fit", exact: true }).click();
    await details.locator('[data-id="public.checklists"] strong').first().click({ timeout: 5000 });
    await expect(details.locator(".database-workspace__table-detail header")).toContainText("checklists");
    await diagramAction(page, "All columns");
    await expect(details.locator('[data-id="public.checklists"]')).toContainText("notes");
    await expect(camera).toHaveAttribute("style", before!);
    await page.keyboard.press("Escape");
    await expect(details).toHaveCount(0);
    await expect(page.getByRole("button", { name: "Explore Bookings", exact: true })).toBeFocused();
    expect(server.saves).toHaveLength(0);
    await page.getByRole("button", { name: "ERD", exact: true }).click();
    await expect(page.locator('.database-erd [data-id="public.bookings"]')).toBeVisible();
    await expect(page.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
    const fullCard = page.locator('.database-erd [data-id="public.bookings"]');
    const fullPosition = await fullCard.getAttribute("style");
    await dragTable(page, "bookings", 90, 50);
    await expect(fullCard).not.toHaveAttribute("style", fullPosition!);
    expect(errors).toEqual([]);
  } finally { await context.close(); await server.close(); }
});

for (const view of ["Overview", "ERD"] as const) {
  test(`@erd-selection-opacity ${view} dims unrelated tables only after selection, never on hover`, async ({ browser, baseURL }, testInfo) => {
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
    const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await openDiagram(page, server.url, { view, waitForReady: false });
      if (view === "Overview") await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
      const diagram = page.locator(".database-erd");
      const cards = diagram.locator(".database-erd-node");
      await expect(cards).toHaveCount(view === "Overview" ? 4 : 8);
      await expect(diagram.getByText("Arranging tables…", { exact: true })).toHaveCount(0);
      await diagram.getByRole("button", { name: "Fit", exact: true }).click();
      await waitForDiagramViewport(page);
      const solidTables = () => cards.evaluateAll(elements => elements.filter(element => getComputedStyle(element).opacity === "1").map(element => element.querySelector("strong")!.textContent).sort());
      const allTables = (await cards.locator("strong").allTextContents()).sort();
      await expect.poll(solidTables).toEqual(allTables);
      for (const card of await cards.all()) await expect(card).toHaveCSS("background-color", "rgb(255, 255, 255)");

      // Move the real pointer onto a visible section of an unrelated connection.
      const edge = diagram.getByRole("group", { name: /transactions_invoice_groups_fk$/ });
      const hoverEdge = async () => {
        const point = await edge.locator(".vue-flow__edge-interaction").evaluate((path: SVGPathElement) => {
          for (let fraction = 0.1; fraction < 0.95; fraction += 0.05) {
            const local = path.getPointAtLength(path.getTotalLength() * fraction);
            const point = new DOMPoint(local.x, local.y).matrixTransform(path.getScreenCTM()!);
            if (document.elementFromPoint(point.x, point.y)?.closest(".vue-flow__edge") === path.closest(".vue-flow__edge")) return { x: point.x, y: point.y };
          }
          throw new Error("No visible section of the relationship to hover");
        });
        await page.mouse.move(point.x, point.y);
        await expect(edge.locator(".vue-flow__edge-text")).toHaveCount(2);
      };
      await hoverEdge();
      await expect.poll(solidTables).toEqual(allTables);
      await diagram.locator('[data-id="public.checklists"] strong').click();
      await expect.poll(solidTables).toEqual(["checklists", "invoice_groups"]);
      for (const card of await diagram.locator(".database-erd-node--dimmed").all()) await expect(card).toHaveCSS("opacity", "0.35");
      await hoverEdge();
      await expect.poll(solidTables).toEqual(["checklists", "invoice_groups"]);
      await page.screenshot({ path: testInfo.outputPath(`${view}-selected-neighbours.png`) });
      await diagram.getByRole("button", { name: "Close diagram details", exact: true }).click();
      await expect.poll(solidTables).toEqual(allTables);
      await hoverEdge();
      await page.mouse.down();
      await page.mouse.up();
      await expect(diagram.locator(".database-erd__inspector")).toContainText("Relationship");
      await expect.poll(solidTables).toEqual(["invoice_groups", "transactions"]);
      await diagram.getByRole("button", { name: "Close diagram details", exact: true }).click();
      await expect.poll(solidTables).toEqual(allTables);
      if (view === "Overview") {
        await expect(page.locator(".database-overview__map")).toHaveCSS("opacity", "0.12");
        await diagram.locator('[data-id="public.checklists"] strong').click();
        await page.getByRole("button", { name: "Close details", exact: true }).click();
        await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
        await expect.poll(solidTables).toEqual(allTables);
        expect(server.saves).toHaveLength(0);
      }
      expect(errors).toEqual([]);
    } finally { await context.close(); await server.close(); }
  });
}

test("@data-overview main connections reduce clutter while all connections and physical details remain available", async ({ browser, baseURL }) => {
  const schema = dataOverviewSchema();
  const definition = { ...bookingOverview(), mainRelationships: ["contacts_bookings"] };
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: schema, overviewDefinition: definition });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    const lines = page.locator(".database-overview__map .vue-flow__edge");
    await expect(lines).toHaveCount(1);
    const camera = page.locator(".database-overview__map .vue-flow__transformationpane");
    const before = await camera.getAttribute("style");
    await page.getByRole("button", { name: "Overview options", exact: true }).click();
    await page.getByRole("checkbox", { name: "All connections", exact: true }).check();
    await expect(lines).toHaveCount(3);
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    await expect(camera).toHaveAttribute("style", before!);
    await page.getByRole("checkbox", { name: "All connections", exact: true }).uncheck();
    await expect(lines).toHaveCount(1);
    await page.getByRole("button", { name: "Overview options", exact: true }).click();
    await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
    const details = page.locator(".database-overview__detail");
    await expect(details.locator(".vue-flow__edge")).toHaveCount(3);
    await expect(details.locator(".vue-flow__node-table")).toHaveCount(4);
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await server.setOverview({ ...definition, mainRelationships: ["removed_fk"] });
    await overviewAction(page, "Reload overview");
    await expect(page.getByRole("alert").filter({ hasText: "main connections are missing" })).toBeVisible();
    await expect(lines).toHaveCount(0);
    await page.getByRole("button", { name: "Overview options", exact: true }).click();
    await page.getByRole("checkbox", { name: "All connections", exact: true }).check();
    await expect(lines).toHaveCount(3);
  } finally { await context.close(); await server.close(); }
});


for (const width of [390, 1600]) {
  test(`@data-overview compact controls leave the diagram prominent at ${width}px`, async ({ browser, baseURL }, testInfo) => {
    const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
    const context = await browser.newContext({ viewport: { width, height: 1000 } });
    try {
      const page = await context.newPage();
      const errors: string[] = [];
      page.on("pageerror", error => errors.push(error.message));
      await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
      const overviewToolbar = page.getByLabel("Data overview controls");
      await expect(overviewToolbar.getByRole("button")).toHaveCount(2);
      await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
      await expect(overviewToolbar).toBeHidden();
      const details = page.getByRole("region", { name: "ERD for Bookings" });
      const toolbar = details.getByLabel("ERD controls");
      await expect(toolbar.getByRole("button")).toHaveCount(2);
      expect((await toolbar.boundingBox())!.height).toBeLessThan(70);
      await expect(details.locator(".database-erd__filters")).toHaveCount(0);
      const detailBox = (await details.boundingBox())!;
      const canvasBox = (await details.locator(".database-erd__canvas").boundingBox())!;
      expect(canvasBox.height / detailBox.height).toBeGreaterThan(0.7);
      await details.getByRole("button", { name: "Diagram options", exact: true }).click();
      const options = page.locator(".database-erd__options");
      await expect(options.getByRole("button", { name: "Reset positions", exact: true })).toBeVisible();
      await expect(options.getByRole("button", { name: "Saved views", exact: true })).toBeVisible();
      await expect(options.getByRole("button", { name: "Edit table groups", exact: true })).toBeVisible();
      await options.locator(".v-select").click({ timeout: 5000 });
      await expect(page.getByRole("option", { name: "All tables with relationships", exact: true })).toBeVisible();
      await expect(page.getByRole("option", { name: "Related tables", exact: true })).toHaveCount(0);
      await page.getByRole("option", { name: "All tables", exact: true }).click();
      await diagramAction(page, "All columns");
      await expect(details.locator('[data-id="public.checklists"]')).toContainText("notes");
      await page.screenshot({ path: testInfo.outputPath(`simplified-${width}.png`) });
      await page.getByRole("button", { name: "Close details", exact: true }).click();
      await expect(overviewToolbar).toBeVisible();
      expect(errors).toEqual([]);
    } finally { await context.close().catch(() => {}); await server.close(); }
  });
}

test("@data-overview dragging actors persists positions, reroutes connections and preserves scoped ERD isolation", async ({ browser, baseURL }) => {
  const definition = { ...bookingOverview(), mainRelationships: ["contacts_bookings"] };
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: definition });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    const second = await context.newPage();
    await openDiagram(second, server.url, { view: "Overview", waitForReady: false });
    const actor = page.locator('[data-id="actor:public.bookings"]');
    const position = () => actor.evaluate((node: HTMLElement) => node.style.transform);
    const before = await position();
    const path = page.locator(".database-overview__map .vue-flow__edge-path").first();
    const oldRoute = await path.getAttribute("d");
    const box = (await actor.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 110, box.y + 95, { steps: 8 });
    await expect(path).not.toHaveAttribute("d", oldRoute!);
    await page.mouse.up();
    await expect.poll(async () => JSON.parse(await server.readOverviewFile()).positions?.["public.bookings"]).toBeTruthy();
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    await expect.poll(position).not.toBe(before);
    await expect(page.locator(".database-overview__detail")).toHaveCount(0);
    const moved = await position();
    await expect.poll(() => second.locator('[data-id="actor:public.bookings"]').evaluate((node: HTMLElement) => node.style.transform)).toBe(moved);
    await page.getByRole("button", { name: "Explore Bookings", exact: true }).click();
    await expect(page.locator(".database-overview__detail .vue-flow__node-table")).toHaveCount(4);
    await expect(page.locator(".database-overview__detail .vue-flow__node-table.draggable")).toHaveCount(0);
    await page.getByRole("button", { name: "Close details", exact: true }).click();
    await expect.poll(position).toBe(moved);
    await page.getByRole("button", { name: "Overview options", exact: true }).click();
    await page.getByRole("checkbox", { name: "All connections", exact: true }).check();
    await expect(page.locator(".database-overview__map .vue-flow__edge")).toHaveCount(3);
    await expect.poll(position).toBe(moved);
    await page.reload();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    await expect.poll(position).toBe(moved);
    expect(server.saves).toHaveLength(0);
    await overviewAction(page, "Reset actor positions");
    await expect.poll(async () => JSON.parse(await server.readOverviewFile()).positions).toEqual({});
    await expect.poll(position).toBe(before);
    expect(errors).toEqual([]);
  } finally { await context.close().catch(() => {}); await server.close(); }
});


test("@overview-drag-stability drops stay still and repeated drags work while routing and saving are delayed", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let releaseSave = () => {};
  const saved = new Promise<void>(resolve => { releaseSave = resolve; });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const worker = await controlRoutingWorker(page, "overview");
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    const actor = page.locator('[data-id="actor:public.bookings"]');
    const map = page.locator(".database-overview__map");
    const positions = () => map.locator(".vue-flow__node-actor").evaluateAll(nodes => Object.fromEntries(nodes.map((node: HTMLElement) => [node.dataset.id, node.style.transform])));
    const camera = map.locator(".vue-flow__transformationpane");
    const initialCamera = await camera.getAttribute("style");
    const requests: any[] = [];
    await page.route("**/database/sessions/*/overview", async route => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) await saved;
      await route.continue();
    });
    await worker.hold();
    const before = await positions();
    const box = (await actor.boundingBox())!;
    await page.mouse.move(box.x + 20, box.y + 15);
    await page.mouse.down();
    await page.mouse.move(box.x + 90, box.y + 65, { steps: 8 });
    const dropped = await positions();
    await page.mouse.up();
    await expect.poll(() => requests.length).toBe(1);
    expect(dropped).not.toEqual(before);
    expect(await positions()).toEqual(dropped);
    await expect(actor).toHaveClass(/draggable/);

    // Drag from the description this time, before either the worker or save
    // finishes. A third drop supersedes the second queued save.
    for (const [dx, dy] of [[60, -30], [-30, 50]]) {
      const current = (await actor.boundingBox())!;
      await page.mouse.move(current.x + 25, current.y + current.height / 2);
      await page.mouse.down();
      await page.mouse.move(current.x + 25 + dx, current.y + current.height / 2 + dy, { steps: 8 });
      await page.mouse.up();
    }
    const latest = await positions();
    expect(latest["actor:public.bookings"]).not.toBe(dropped["actor:public.bookings"]);
    expect(Object.fromEntries(Object.entries(latest).filter(([id]) => id !== "actor:public.bookings")))
      .toEqual(Object.fromEntries(Object.entries(before).filter(([id]) => id !== "actor:public.bookings")));
    expect(requests).toHaveLength(1);
    await expect(page.locator(".database-overview__detail")).toHaveCount(0);

    // Observe every DOM mutation and animation frame through stale routing
    // replies and the save acknowledgements, rather than just the final state.
    await page.evaluate(() => {
      const read = () => Object.fromEntries([...document.querySelectorAll(".database-overview__map .vue-flow__node-actor")].map((node: HTMLElement) => [node.dataset.id, node.style.transform]));
      const frames = [read()];
      const observer = new MutationObserver(() => frames.push(read()));
      observer.observe(document.querySelector(".database-overview__map")!, { subtree: true, childList: true, attributes: true, attributeFilter: ["style"] });
      let raf: number;
      const sample = () => { frames.push(read()); raf = requestAnimationFrame(sample); };
      raf = requestAnimationFrame(sample);
      (window as any).stopOverviewFrames = () => { observer.disconnect(); cancelAnimationFrame(raf); return frames; };
    });
    releaseSave();
    await expect.poll(() => requests.length).toBe(2);
    await expect.poll(async () => JSON.parse(await server.readOverviewFile()).positions).toEqual(requests[1].definition.positions);
    await expect(page.getByRole("button", { name: "Explore Bookings", exact: true })).toBeVisible();
    await page.evaluate(() => { (window as any).erdRoutingControl.held = false; });
    while (await worker.pending()) {
      await worker.release();
      await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
      expect(await positions()).toEqual(latest);
    }
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    expect((await page.evaluate(() => (window as any).stopOverviewFrames())).every(frame => JSON.stringify(frame) === JSON.stringify(latest))).toBe(true);
    expect(await camera.getAttribute("style")).toBe(initialCamera);
    expect(requests).toHaveLength(2);
    await page.reload();
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect.poll(positions).toEqual(latest);
    expect(server.saves).toHaveLength(0);
    expect(errors).toEqual([]);
  } finally { releaseSave(); await context.close().catch(() => {}); await server.close(); }
});

test("@overview-drag-stability an acknowledged save and older route cannot interrupt the next active drag", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let releaseSave = () => {};
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    const worker = await controlRoutingWorker(page, "overview");
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    const requests: any[] = [];
    const responses: any[] = [];
    await page.route("**/database/sessions/*/overview", async route => {
      requests.push(route.request().postDataJSON());
      if (requests.length === 1) await gate;
      const response = await route.fetch();
      responses.push(await response.json());
      await route.fulfill({ response });
    });
    await worker.hold();
    const bookings = page.locator('[data-id="actor:public.bookings"]');
    const first = (await bookings.boundingBox())!;
    await page.mouse.move(first.x + 20, first.y + 15);
    await page.mouse.down();
    await page.mouse.move(first.x + 80, first.y + 45, { steps: 8 });
    await page.mouse.up();
    await expect.poll(() => requests.length).toBe(1);
    const dogs = page.locator('[data-id="actor:public.dogs"]');
    const second = (await dogs.boundingBox())!;
    await page.mouse.move(second.x + 20, second.y + 15);
    await page.mouse.down();
    await page.mouse.move(second.x - 30, second.y - 45, { steps: 8 });
    const held = await dogs.evaluate((node: HTMLElement) => node.style.transform);
    const reloaded = page.waitForResponse(response => response.url().endsWith(`/database/sessions/${directChatSessionId}`));
    releaseSave();
    await reloaded;
    await expect.poll(() => responses.length).toBe(1);
    await worker.release();
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    expect(await dogs.evaluate((node: HTMLElement) => node.style.transform)).toBe(held);
    await expect(dogs).toHaveClass(/dragging/);
    await page.mouse.move(second.x - 60, second.y - 20, { steps: 8 });
    const dropped = await dogs.evaluate((node: HTMLElement) => node.style.transform);
    await page.mouse.up();
    await expect.poll(() => responses.length).toBe(2);
    expect(responses.every(response => response.ok)).toBe(true);
    expect(requests[1].baseHash).toBe(responses[0].overview.hash);
    expect(JSON.parse(await server.readOverviewFile()).positions).toEqual(requests[1].definition.positions);
    await page.evaluate(() => { (window as any).erdRoutingControl.held = false; });
    while (await worker.pending()) await worker.release();
    await expect(page.getByText("Arranging actors…")).toHaveCount(0);
    expect(await dogs.evaluate((node: HTMLElement) => node.style.transform)).toBe(dropped);
    await expect(page.locator(".database-overview__detail")).toHaveCount(0);
    expect(errors).toEqual([]);
  } finally { releaseSave(); await context.close().catch(() => {}); await server.close(); }
});

test("@overview-drag-stability a failed save discards queued writes and restores the saved arrangement", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!, { schemaOverride: dataOverviewSchema(), overviewDefinition: bookingOverview() });
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  let releaseSave = () => {};
  const gate = new Promise<void>(resolve => { releaseSave = resolve; });
  try {
    const page = await context.newPage();
    await openDiagram(page, server.url, { view: "Overview", waitForReady: false });
    const actor = page.locator('[data-id="actor:public.bookings"]');
    const position = () => actor.evaluate((node: HTMLElement) => node.style.transform);
    const before = await position();
    let writes = 0;
    await page.route("**/database/sessions/*/overview", async route => {
      writes += 1;
      await gate;
      await route.fulfill({ status: 409, contentType: "application/json", body: JSON.stringify({ ok: false, error: "The data overview changed. Reload it before saving your grouping." }) });
    });
    for (const [dx, dy] of [[60, 50], [-30, 40]]) {
      const box = (await actor.boundingBox())!;
      await page.mouse.move(box.x + 20, box.y + 15);
      await page.mouse.down();
      await page.mouse.move(box.x + 20 + dx, box.y + 15 + dy, { steps: 8 });
      await page.mouse.up();
    }
    expect(await position()).not.toBe(before);
    await expect.poll(() => writes).toBe(1);
    releaseSave();
    await expect.poll(position).toBe(before);
    expect(JSON.parse(await server.readOverviewFile()).positions).toBeUndefined();
    expect(writes).toBe(1);
    await expect(actor).toHaveClass(/draggable/);
    await expect(page.getByText(/changed|could not be saved/i).first()).toBeVisible();
  } finally { releaseSave(); await context.close().catch(() => {}); await server.close(); }
});

test("@erd-controls saved views, groups, filters and fullscreen remain usable from options", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    const errors: string[] = [];
    page.on("pageerror", error => errors.push(error.message));
    await openDiagram(page, server.url);
    await diagramAction(page, "Edit table groups");
    const groupDialog = page.getByRole("dialog");
    await groupDialog.getByRole("textbox", { name: "Group name", exact: true }).fill("Customers only");
    await groupDialog.getByRole("combobox", { name: "Tables in group", exact: true }).fill("customers");
    await page.getByRole("option", { name: "customers", exact: true }).click();
    await groupDialog.getByRole("button", { name: "Save group", exact: true }).click();
    await expect(groupDialog).toBeHidden();
    const options = page.locator(".database-erd__options");
    if (!await options.isVisible()) await page.getByRole("button", { name: "Diagram options", exact: true }).click();
    await options.locator(".v-select").click({ timeout: 5000 });
    await page.getByRole("option", { name: "Customers only", exact: true }).click();
    await expect(page.locator('.database-erd .vue-flow__node:visible')).toHaveCount(1);
    await options.getByRole("button", { name: "Saved views", exact: true }).click();
    await page.getByText("Save view…", { exact: true }).click();
    await page.getByRole("textbox", { name: "View name", exact: true }).fill("Customer view");
    await page.getByRole("button", { name: "Save view", exact: true }).click();
    await expect(page.getByRole("dialog")).toBeHidden();
    if (!await options.isVisible()) await page.getByRole("button", { name: "Diagram options", exact: true }).click();
    await options.locator(".v-select").click({ timeout: 5000 });
    await page.getByRole("option", { name: "All tables", exact: true }).click();
    await expect(page.locator('.database-erd .vue-flow__node:visible')).toHaveCount(2);
    await options.getByRole("button", { name: "Saved views", exact: true }).click();
    await page.getByText("Customer view", { exact: true }).click();
    await expect(page.locator('.database-erd .vue-flow__node:visible')).toHaveCount(1);
    await diagramAction(page, "Full screen");
    await expect.poll(() => page.evaluate(() => document.fullscreenElement?.classList.contains("database-erd"))).toBe(true);
    await diagramAction(page, "Exit full screen");
    await expect.poll(() => page.evaluate(() => !!document.fullscreenElement)).toBe(false);
    expect(errors).toEqual([]);
  } finally { await context.close().catch(() => {}); await server.close(); }
});

test("@erd-camera zoom saves after settling and closing cancels a pending camera save", async ({ browser, baseURL }) => {
  const server = await sharedDiagramServer(baseURL!);
  const context = await browser.newContext({ viewport: { width: 1600, height: 1000 } });
  try {
    const page = await context.newPage();
    await openDiagram(page, server.url);
    await waitForDiagramViewport(page);
    const diagram = page.locator(".database-erd");
    const box = (await diagram.locator(".vue-flow__pane").boundingBox())!;
    const before = server.saves.length;
    await page.mouse.move(box.x + box.width / 2, box.y + box.height / 2);
    await page.mouse.wheel(0, -100);
    await waitForDiagramViewport(page);
    expect(server.saves).toHaveLength(before);
    await expect.poll(() => server.saves.length).toBe(before + 1);
    await page.mouse.wheel(0, 100);
    await page.getByRole("button", { name: "Overview", exact: true }).click();
    await expect(diagram).toHaveCount(0);
    // Deliberately outwait the camera debounce to catch writes from a closed view.
    await page.waitForTimeout(850);
    expect(server.saves).toHaveLength(before + 1);
  } finally { await context.close(); await server.close(); }
});
