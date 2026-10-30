import { readFileSync } from "node:fs";
import { expect, test, type Page } from "@playwright/test";

import {
  buildCallIndex,
  buildSnapshotIndex,
  joinFunctions,
  readEntries,
  readFunction
} from "../../packages/vibe64-system-graph/src/server/usageWeb.js";
import { pageOf } from "../../packages/vibe64-usage-recording/src/server/traceStore.js";
import {
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

// Recording results of a long recording over the shared usage-map fixtures:
// the request list scrolls under the mouse wheel, shows how many requests it
// lists of how many with Show more, puts a live recording's newest requests on
// top, and names the chosen request and its click. USAGE_RESULTS_SCREENSHOTS
// names a folder for screenshots; USAGE_RESULTS_THEME=dark takes them dark.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/usage-map/${name}`, import.meta.url), "utf8"));
const machine = fixture("machine-city.json");
const callWeb = fixture("call-web.json");
const index = buildSnapshotIndex({ city: machine, exists: true, builtAt: "2026-10-30T10:00:00.000Z" }, {});
const calls = buildCallIndex(callWeb);
const ran = fixture("recording/api/request-functions/r_000004.json");
const screenshots = String(process.env.USAGE_RESULTS_SCREENSHOTS || "").trim();
const theme = String(process.env.USAGE_RESULTS_THEME || "").trim();

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

const CLICK = { id: "i_0001", label: "button \"Add\"", kind: "click", componentFile: "src/components/SessionList.vue" };
const REQUESTS = 450;
const requestRow = (number: number) => ({
  id: `r_${String(number).padStart(6, "0")}`,
  method: number % 3 ? "GET" : "POST",
  path: number % 3 ? `/api/app/demo/vibe64/accounts/${number}/settings` : "/api/sessions",
  status: 200,
  startedAt: new Date(Date.parse("2026-10-30T10:00:02.000Z") + number * 1000).toISOString(),
  durationMs: 9,
  interaction: number % 3 ? null : CLICK.id,
  functionCount: 16,
  fileCount: 11
});

// The recording API over one long recording, answering requests reads as the server pages them.
function recordingServer() {
  const recording = { ...fixture("recording/api/list.json").recordings[0] };
  const rows: Record<string, any>[] = [
    { id: "bg_4242", kind: "background", method: null, path: null, status: null, startedAt: "2026-10-30T10:00:01.000Z", durationMs: null, interaction: null, functionCount: 7, fileCount: 4 },
    ...Array.from({ length: REQUESTS }, (_, position) => requestRow(position + 1))
  ];
  function requests(query: URLSearchParams) {
    const q = String(query.get("q") || "").toLowerCase();
    const matching = rows.filter((row) => (query.get("includeEmpty") === "true" || row.functionCount > 0) &&
      (!q || `${row.method || ""} ${row.path || ""}`.toLowerCase().includes(q)));
    if (query.get("order") === "newest") matching.reverse();
    const page = pageOf(matching, { cursor: query.get("cursor") || "", limit: query.get("limit") || 100, maxLimit: 200 });
    const referenced = new Set(page.items.map((row) => row.interaction));
    return { requests: page.items, interactions: [CLICK].filter((item) => referenced.has(item.id)), nextCursor: page.more ? page.next : null, total: matching.length };
  }
  function answer(path: string, query: URLSearchParams) {
    if (!path) return { recordings: [recording] };
    if (path === "/targets") return fixture("recording/api/targets.json");
    if (path === "/current") return { recording, serverTime: new Date().toISOString() };
    if (path.endsWith("/requests")) return requests(query);
    if (/\/requests\/[^/]+\/functions$/u.test(path)) return ran;
    return { ok: true };
  }
  return { recording, rows, answer };
}

async function mockProject(page: Page) {
  await mockDirectChatSession(page);
  await page.unroute(apiEndpointPattern("/vibe64/sessions"));
  await page.unroute(apiEndpointPattern(`/vibe64/sessions/${directChatSessionId}`));
  await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, { creation: { canCreate: true, mode: "direct" }, limits: { openSessionCount: 1 }, ok: true, sessions: [sessionPayload] }));
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, sessionPayload));
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
    const kind = url.pathname.split("/").pop();
    const query = Object.fromEntries(url.searchParams);
    const answer = kind === "join" ? joinFunctions(index, calls, route.request().postDataJSON())
      : kind === "function" ? readFunction(index, calls, query) : readEntries(index, query);
    await fulfillJson(route, { ok: true, snapshot: index.snapshot, ...answer });
  }, { children: true });
  const server = recordingServer();
  await routeApiEndpoint(page, recordingApi, async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, server.answer(url.pathname.replace(/^.*\/usage-recordings\/sessions\/[^/]+/u, ""), url.searchParams));
  }, { prefix: true });
  return server;
}

async function openRecording(page: Page) {
  if (theme) await page.addInitScript((value) => localStorage.setItem("vibe64.appearance", JSON.stringify(value)), theme);
  await page.goto(`${DEVELOPMENT_PATH}/dashboard/system?view=usage&mode=recording`);
  return page.getByRole("region", { name: "Usage" });
}

const shot = async (page: Page, name: string) => {
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
  if (screenshots) await page.screenshot({ path: `${screenshots}/${name}${theme ? `-${theme}` : ""}.png` });
};
const scrollTop = (list) => list.evaluate((element: HTMLElement) => element.scrollTop);

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 360, height: 780 }]) {
  const phone = viewport.width <= 600;
  test(`a long recording's requests scroll, page and name the chosen request at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    try {
      await mockProject(page);
      const usage = await openRecording(page);
      if (phone) await usage.getByRole("button", { name: "Choose a request" }).click({ timeout: 20_000 });
      const rail = phone ? page.getByRole("dialog") : usage.getByRole("region", { name: "Recordings" });
      const list = rail.getByRole("listbox", { name: "Requests" });
      await expect(rail.getByText("Showing 200 of 451 requests")).toBeVisible({ timeout: 20_000 });
      await expect(rail.getByRole("button", { name: "Show more" })).toBeVisible();
      expect(await list.evaluate((element: HTMLElement) => element.scrollHeight > element.clientHeight)).toBe(true);
      // Start-up work has an icon in the method column, not a method.
      await expect(rail.getByRole("option").first().locator(".usage-recordings__method")).not.toContainText("ALL");
      await shot(page, `${viewport.width}-1-requests`);

      // The mouse wheel over the list scrolls it.
      await list.hover();
      await page.mouse.wheel(0, 900);
      await expect.poll(() => scrollTop(list)).toBeGreaterThan(0);

      // Show more lists the next 200, then the rest.
      await rail.getByRole("button", { name: "Show more" }).click();
      await expect(rail.getByText("Showing 400 of 451 requests")).toBeVisible();
      await rail.getByRole("button", { name: "Show more" }).click();
      await expect(rail.getByText(/^Showing /u)).toHaveCount(0);
      await expect(rail.getByRole("option")).toHaveCount(451);
      await list.hover();
      await page.mouse.wheel(0, 100_000);
      await expect(rail.getByRole("option").last()).toBeInViewport();
      await expect(rail.getByRole("option").last()).toContainText("/api/sessions");
      await shot(page, `${viewport.width}-2-all-requests`);

      // A request under a click: a desktop header names both.
      await rail.getByRole("option").filter({ hasText: "/api/sessions" }).last().click();
      await expect(page).toHaveURL(/request=r_000450/u);
      if (phone) {
        await expect(usage.getByRole("button", { name: "Request: POST /api/sessions" })).toBeVisible();
      } else {
        await expect(usage.getByRole("heading", { name: "Request: POST /api/sessions" })).toBeVisible();
        await expect(usage.locator(".usage-view__click")).toHaveText("Click: button \"Add\" (SessionList.vue)");
      }
      const core = usage.locator(".usage-web__card").filter({ hasText: "Core" });
      await expect(core).toContainText("6 functions ran");
      await shot(page, `${viewport.width}-3-request`);

      // Shared plumbing, then a function whose calls ran in this request.
      await core.click();
      await usage.getByRole("switch", { name: "Show shared plumbing (5)" }).click();
      // Beside the open chat the zoomed functions are a list, as on a phone.
      await usage.locator(".usage-web__rows .v-list-item, .usage-node").filter({ hasText: "handleWithContext" }).click();
      const details = page.getByRole("article", { name: /^Details for handleWithContext/u });
      await expect(details.locator(".usage-panel__ran").first()).toHaveText("· ran 1 time");
      await shot(page, `${viewport.width}-4-function`);
      expect(errors).toEqual([]);
    } finally {
      await page.close().catch(() => {});
    }
  });
}

test("a live recording lists its newest requests first and adds new ones on top, with the chat open or collapsed", async ({ page }) => {
  test.setTimeout(90_000);
  await page.setViewportSize({ width: 1280, height: 800 });
  try {
    const server = await mockProject(page);
    Object.assign(server.recording, { state: "recording", stoppedAt: null, stopReason: null });
    const usage = await openRecording(page);
    const rail = usage.getByRole("region", { name: "Recordings" });
    await expect(rail.getByText("Recording now. New requests appear as they finish.")).toBeVisible({ timeout: 20_000 });
    await expect(rail.getByText("Showing 200 of 451 requests, newest first")).toBeVisible();
    await expect(rail.getByRole("option").first()).toContainText("/api/sessions");
    await expect(page).toHaveURL(/view=usage/u);
    server.rows.push(requestRow(REQUESTS + 1), requestRow(REQUESTS + 2));
    await expect(rail.getByRole("option").first()).toContainText("/api/app/demo/vibe64/accounts/452/settings", { timeout: 15_000 });
    await expect(rail.getByText("Showing 202 of 453 requests, newest first")).toBeVisible();
    await shot(page, "1280-5-live");

    // With the chat collapsed the rail keeps its height and still scrolls.
    await page.locator(".studio-home-shell-chat-toggle").click();
    const list = rail.getByRole("listbox", { name: "Requests" });
    await list.hover();
    await page.mouse.wheel(0, 900);
    await expect.poll(() => scrollTop(list)).toBeGreaterThan(0);
    expect((await rail.boundingBox())!.y + (await rail.boundingBox())!.height).toBeLessThanOrEqual(800);
    await shot(page, "1280-6-live-chat-collapsed");
  } finally {
    await page.close().catch(() => {});
  }
});
