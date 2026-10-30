import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import { injectLaunchPreviewBridge } from "../../packages/vibe64-terminals/src/server/launchPreviewBridge.js";
import {
  buildCallIndex,
  buildSnapshotIndex,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb
} from "../../packages/vibe64-system-graph/src/server/usageWeb.js";
import {
  BASE_URL,
  DEVELOPMENT_PATH,
  directChatSessionId,
  directChatSessionPayload
} from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell-mocks";
import {
  apiEndpointPattern,
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";

// Preview Pick and recorded clicks over the usage-map fixture project: a
// picked element opens Usage › Calls at its component, and a recorded click's
// requests are grouped under it. USAGE_PREVIEW_PICK_SCREENSHOTS names a folder
// for screenshots.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/usage-map/${name}`, import.meta.url), "utf8"));
const machine = fixture("machine-city.json");
const LAYOUT = { groups: [
  { id: "entry", title: "Entry points", kind: "layer", subsystems: [{ root: "bin" }, { root: "server" }] },
  { id: "features", title: "Features", kind: "layer", subsystems: [{ root: "src" }, { root: "packages/sessions" }, { root: "packages/reports" }] },
  { id: "shared", title: "Shared code", kind: "layer", subsystems: [{ root: "packages/core" }] }
] };
const index = buildSnapshotIndex({ city: machine, exists: true, builtAt: "2026-10-30T10:00:00.000Z" }, LAYOUT);
const calls = buildCallIndex(fixture("call-web.json"));
const screenshots = String(process.env.USAGE_PREVIEW_PICK_SCREENSHOTS || "").trim();

const PREVIEW_ORIGIN = "http://127.0.0.1:49000";
const OTHER_ORIGIN = "http://127.0.0.1:49001";
const TARGET_ORIGIN = "http://127.0.0.1:4103";
const RECORDING_ID = "rec_fixture2usagemap3pik";
const COMPONENT_ENTRY = "entry:component:src/components/SessionList.vue";
const sessionApi = `/vibe64/system-graph/sessions/${directChatSessionId}`;
const recordingApi = `/vibe64/usage-recordings/sessions/${directChatSessionId}`;
const sourcePath = `/workspace/managed-sources/test/projects/example/sessions/active/${directChatSessionId}/source`;
const sessionPayload = {
  ...directChatSessionPayload,
  agentSession: { ...directChatSessionPayload.agentSession, workdir: sourcePath },
  metadata: { ...directChatSessionPayload.metadata, source_kind: "session_clone", source_path: sourcePath, source_path_authority: "managed_session_source" },
  sourcePath,
  sourceReady: true
};

// The fixture app's Sessions page, and a locator that names an element's
// component from its nearest marked ancestor (the Vue locator reads the
// component instance instead). Neither reads text or values.
const APP_HTML = `<!doctype html><html><head><title>Sessions</title></head><body>
<main data-component="src/pages/SessionsPage.vue">
  <h1>Sessions</h1>
  <section data-component="src/components/SessionList.vue">
    <label>Name <input id="name" autocomplete="off"></label>
    <button id="add" type="button">Add</button>
  </section>
</main>
<script>
document.getElementById("add").addEventListener("click", async () => {
  window.__vibe64TestAdded = (window.__vibe64TestAdded || 0) + 1;
  await fetch("/api/sessions", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ name: document.getElementById("name").value }) });
  await fetch("/api/sessions");
  await fetch("${OTHER_ORIGIN}/api/elsewhere").catch(() => null);
});
</script>
</body></html>`;
const LOCATOR = `globalThis.__vibe64LocateElement = (element) => {
  const host = element && element.closest ? element.closest("[data-component]") : null;
  const file = host ? host.getAttribute("data-component") : "";
  return file ? { file: ${JSON.stringify(`${sourcePath}/`)} + file, name: file.split("/").pop().replace(/\\.vue$/u, "") } : null;
};`;

function recordingPayload(state: string) {
  return {
    id: RECORDING_ID,
    sessionId: directChatSessionId,
    state,
    target: { id: "dev", kind: "web", label: "Run app" },
    runtimes: ["nodejs"],
    tracers: [{ runtime: "nodejs", state: "ready", reason: "" }],
    startedAt: "2026-10-30T10:00:00.000Z",
    stoppedAt: state === "recording" ? null : "2026-10-30T10:02:00.000Z",
    stopReason: state === "recording" ? null : "person",
    counts: { requests: 0, functions: 0 },
    truncated: false,
    dismissedAt: null
  };
}

const launchStatus = {
  activeTerminal: {
    commandPreview: "npm run dev",
    id: "server-launch-terminal",
    metadata: { actions: [], launchReady: true, outputTargetId: "dev", outputTargetLabel: "Run app" },
    output: "ready",
    running: true,
    status: "running"
  },
  ok: true,
  openTarget: { available: true, href: `${TARGET_ORIGIN}/home`, kind: "url", label: "Open browser", previewHref: `${PREVIEW_ORIGIN}/home` },
  outputRuns: [],
  outputTargets: [{ available: true, default: true, downloads: [], id: "dev", label: "Run app", mode: "interactive", presentation: { kind: "web" } }],
  previewTarget: { available: true, disabledReason: "", href: `${PREVIEW_ORIGIN}/home`, kind: "url", label: "Preview", targetHref: `${TARGET_ORIGIN}/home` }
};

function usageAnswer(kind: string, query: Record<string, string>) {
  if (kind === "entries") return readEntries(index, query);
  if (kind === "function") return readFunction(index, calls, query);
  const entry = index.entryById.get(query.entryId);
  if (!entry) throw Object.assign(new Error("This entry point is not in the current scan."), { code: "vibe64_usage_entry_not_found" });
  return query.mode === "imports" ? readImportsWeb(index, entry, query) : readCallsWeb(index, calls, entry, query);
}

// Mocks the session, its running Preview, Architecture's usage reads and the
// recording API. The recording API answers from what the Preview actually
// sent: each proxied request under the interaction header it carried, and the
// interactions the editor posted.
async function mockProject(page: Page, { recording = false } = {}) {
  const seen = { appRequests: [] as Array<{ interaction: string; method: string; origin: string; path: string }>, interactions: [] as Array<Record<string, unknown>>, usage: [] as string[] };
  await page.addInitScript(() => {
    const OriginalWebSocket = window.WebSocket;
    class OutputSocket extends EventTarget {
      readyState = 0;
      constructor(url: string | URL) {
        super();
        if (!new URL(String(url), window.location.href).pathname.includes("/output-runs/")) {
          return new OriginalWebSocket(url) as unknown as OutputSocket;
        }
        window.setTimeout(() => {
          this.readyState = 1;
          this.dispatchEvent(new Event("open"));
          this.dispatchEvent(new MessageEvent("message", { data: JSON.stringify({
            type: "snapshot",
            session: { commandPreview: "npm run dev", id: "server-launch-terminal", metadata: { actions: [], launchReady: true, outputTargetId: "dev", outputTargetLabel: "Run app" }, ok: true, output: "ready", status: "running" }
          }) }));
        }, 0);
      }
      send() {}
      close() {
        this.readyState = 3;
        this.dispatchEvent(new CloseEvent("close"));
      }
    }
    window.WebSocket = OutputSocket as unknown as typeof WebSocket;
  });
  await mockDirectChatSession(page);
  await page.unroute(apiEndpointPattern("/vibe64/sessions"));
  await page.unroute(apiEndpointPattern(`/vibe64/sessions/${directChatSessionId}`));
  await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, { creation: { canCreate: true, mode: "direct" }, limits: { openSessionCount: 1 }, ok: true, sessions: [sessionPayload] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, sessionPayload));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/outputs`, (route) => fulfillJson(route, launchStatus));
  await routeApiEndpoint(page, `${sessionApi}/status`, (route) => fulfillJson(route, {
    cities: {
      machine: { available: true, error: null, path: ".genesis/machine-city.json", state: "ready", status: "current" },
      program: { available: true, error: null, path: ".genesis/program-city.json", state: "ready", status: "valid" }
    },
    ok: true,
    status: "ready"
  }));
  await routeApiEndpoint(page, `${sessionApi}/refresh/status`, (route) => fulfillJson(route, { ok: true, refresh: null }));
  await routeApiEndpoint(page, `${sessionApi}/architecture`, (route) => fulfillJson(route, { architecture: machine.architecture, ok: true }));
  await routeApiEndpoint(page, `${sessionApi}/usage`, async (route) => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split("/").pop() || "";
    seen.usage.push(`${kind}${url.search}`);
    try {
      await fulfillJson(route, { ok: true, snapshot: index.snapshot, ...usageAnswer(kind, Object.fromEntries(url.searchParams)) });
    } catch (error) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: error.message, code: error.code }) });
    }
  }, { children: true });
  await routeApiEndpoint(page, recordingApi, async (route) => {
    const request = route.request();
    const path = new URL(request.url()).pathname.replace(/^.*\/usage-recordings\/sessions\/[^/]+/u, "");
    if (request.method() === "POST" && path === `/${RECORDING_ID}/interactions`) {
      seen.interactions.push(request.postDataJSON());
      await fulfillJson(route, { ok: true });
      return;
    }
    const current = recordingPayload(recording ? "recording" : "stopped");
    if (path === "/current") return fulfillJson(route, { recording: recording ? current : null, serverTime: "2026-10-30T10:01:00.000Z" });
    if (path === "/targets") return fulfillJson(route, { targets: [] });
    if (path === "" || path === "/") return fulfillJson(route, { recordings: [current] });
    if (path === `/${RECORDING_ID}/requests`) {
      const proxied = seen.appRequests.filter((item) => item.origin === PREVIEW_ORIGIN);
      return fulfillJson(route, {
        requests: proxied.map((item, position) => ({
          id: `r_${String(position + 1).padStart(6, "0")}`,
          method: item.method,
          path: item.path,
          status: 200,
          startedAt: "2026-10-30T10:00:20.000Z",
          durationMs: 5,
          interaction: item.interaction || null,
          functionCount: 3,
          fileCount: 2
        })),
        interactions: seen.interactions.map(({ id, label, componentFile }) => ({ id, label, componentFile })),
        nextCursor: null
      });
    }
    await fulfillJson(route, { ok: true });
  }, { prefix: true });
  for (const origin of [PREVIEW_ORIGIN, OTHER_ORIGIN]) {
    await page.route(`${origin}/**`, async (route) => {
      const request = route.request();
      const url = new URL(request.url());
      seen.appRequests.push({ interaction: (await request.allHeaders())["x-vibe64-interaction"] || "", method: request.method(), origin, path: url.pathname });
      if (origin === PREVIEW_ORIGIN && url.pathname === "/home") {
        await route.fulfill({
          body: injectLaunchPreviewBridge(APP_HTML, {
            locatorSource: LOCATOR,
            parentOrigins: [new URL(BASE_URL).origin],
            recording: recording ? { active: true, recordingId: RECORDING_ID } : null,
            targetOrigin: TARGET_ORIGIN
          }),
          contentType: "text/html"
        });
        return;
      }
      await route.fulfill({ body: "[]", contentType: "application/json", headers: { "access-control-allow-origin": "*" } });
    });
  }
  return seen;
}

async function openPreview(page: Page, phone: boolean, { controls = false } = {}) {
  await page.goto(DEVELOPMENT_PATH);
  if (phone) {
    await page.getByRole("button", { name: "Show project", exact: true }).click();
    if (controls) await page.getByRole("button", { name: "Show preview controls", exact: true }).click();
  }
  const app = page.frameLocator(".vibe64-launch-controls__preview-frame");
  await expect(app.getByRole("heading", { name: "Sessions" })).toBeVisible({ timeout: 20_000 });
  return app;
}

async function capture(page: Page, name: string) {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBe(0);
  if (screenshots) await page.screenshot({ path: `${screenshots}/${name}.png` });
}

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }]) {
  const phone = viewport.width <= 600;

  test(`Pick opens Usage › Calls at the clicked element's component at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const seen = await mockProject(page);
    const app = await openPreview(page, phone, { controls: true });
    const pick = page.getByRole("button", { name: "Pick element", exact: true });
    const picking = page.getByText("Select an element in Preview to see what it uses.");

    // Escape in the editor cancels Pick.
    await expect(pick).toBeEnabled();
    await pick.click();
    await expect(picking).toBeVisible();
    await expect(pick).toHaveAttribute("aria-pressed", "true");
    await page.keyboard.press("Escape");
    await expect(picking).toBeHidden();
    await expect(app.locator("[data-vibe64-preview-pick]")).toHaveCount(0);

    // Hovering outlines the element; the click picks it instead of running it.
    await pick.click();
    await expect(picking).toBeVisible();
    await app.getByRole("button", { name: "Add" }).hover();
    await expect(app.locator("[data-vibe64-preview-pick]")).toBeVisible();
    await expect(app.locator("[data-vibe64-preview-pick]")).toContainText("SessionList");
    await capture(page, `${viewport.width}-pick-hover`);
    await app.getByRole("button", { name: "Add" }).click();
    await expect(page).toHaveURL(/view=usage/u, { timeout: 20_000 });
    expect(Object.fromEntries(new URL(page.url()).searchParams)).toMatchObject({ entry: COMPONENT_ENTRY, mode: "calls", view: "usage" });
    expect(seen.usage.some((request) => request.startsWith("entries?") && request.includes("SessionList.vue"))).toBe(true);
    expect(seen.appRequests.filter((request) => request.path.startsWith("/api/"))).toEqual([]);

    const usage = page.getByRole("region", { name: "Usage" });
    if (phone) {
      await expect(usage.getByRole("button", { name: "Entry: SessionList" })).toBeVisible();
    } else {
      await expect(usage.getByRole("region", { name: "Entry points" }).getByRole("option", { name: /Component: SessionList/u })).toHaveAttribute("aria-selected", "true");
    }
    await expect(usage.locator(".usage-web__card").filter({ hasText: "Client" })).toContainText(/\d+ functions?/u);
    await capture(page, `${viewport.width}-pick-usage`);
    expect(errors).toEqual([]);
  });

  test(`a recorded click groups the requests it started at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const seen = await mockProject(page, { recording: true });
    const app = await openPreview(page, phone);
    await capture(page, `${viewport.width}-recording-preview`);

    await app.getByLabel("Name").fill("secret plan");
    await app.getByRole("button", { name: "Add" }).click();
    await expect.poll(() => seen.interactions.length).toBe(1);
    const [interaction] = seen.interactions;
    expect(interaction).toMatchObject({ label: "button \"Add\"", componentFile: "src/components/SessionList.vue" });
    expect(String(interaction.id)).toMatch(/^i_\d{4}$/u);
    expect(JSON.stringify(seen.interactions)).not.toContain("secret");
    await expect.poll(() => seen.appRequests.filter((request) => request.path.startsWith("/api/")).length).toBe(3);
    expect(seen.appRequests.filter((request) => request.path.startsWith("/api/"))).toEqual([
      { interaction: interaction.id, method: "POST", origin: PREVIEW_ORIGIN, path: "/api/sessions" },
      { interaction: interaction.id, method: "GET", origin: PREVIEW_ORIGIN, path: "/api/sessions" },
      { interaction: "", method: "GET", origin: OTHER_ORIGIN, path: "/api/elsewhere" }
    ]);
    await capture(page, `${viewport.width}-recorded-click`);

    await page.goto(`${DEVELOPMENT_PATH}/dashboard/system?view=usage&mode=recording&recording=${RECORDING_ID}`);
    const usage = page.getByRole("region", { name: "Usage" });
    if (phone) await usage.getByRole("button", { name: "Choose a request" }).click({ timeout: 20_000 });
    const requests = phone ? page.getByRole("dialog").getByRole("listbox", { name: "Requests" }) : usage.getByRole("listbox", { name: "Requests" });
    await expect(requests.getByText("Click: button \"Add\" (SessionList.vue)")).toBeVisible({ timeout: 20_000 });
    const rows = await requests.evaluate((list) => [...list.children]
      .map((row) => row.textContent?.replace(/\s+/gu, " ").trim() || "")
      .filter(Boolean));
    const heading = rows.findIndex((row) => row.startsWith("Click: button \"Add\""));
    const grouped = rows.slice(heading + 1, heading + 3);
    expect(grouped.map((row) => row.match(/^(GET|POST)/u)?.[0])).toEqual(["POST", "GET"]);
    expect(rows.filter((row) => row.includes("/api/sessions"))).toEqual(grouped);
    await capture(page, `${viewport.width}-recorded-results`);
    expect(errors).toEqual([]);
  });
}
