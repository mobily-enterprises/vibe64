import { readFileSync } from "node:fs";
import { expect, test } from "@playwright/test";

import {
  buildCallIndex,
  buildSnapshotIndex,
  joinFunctions,
  readCallsWeb,
  readEntries,
  readFunction,
  readImportsWeb
} from "../../packages/vibe64-system-graph/src/server/usageWeb.js";
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

// Usage in Architecture over the shared usage-map fixtures: entry, Calls and
// Imports at each level, Recording requests, the address surviving a reload,
// and no sideways scrolling on desktop or phone. USAGE_MAP_SCREENSHOTS names a
// folder for one screenshot per level and width.
const fixture = (name: string) => JSON.parse(readFileSync(new URL(`../fixtures/usage-map/${name}`, import.meta.url), "utf8"));
const machine = fixture("machine-city.json");
const callWeb = fixture("call-web.json");
const LAYOUT = { groups: [
  { id: "entry", title: "Entry points", kind: "layer", subsystems: [{ root: "bin" }, { root: "server" }] },
  { id: "features", title: "Features", kind: "layer", subsystems: [{ root: "src" }, { root: "packages/sessions" }, { root: "packages/reports" }] },
  { id: "shared", title: "Shared code", kind: "layer", subsystems: [{ root: "packages/core" }] }
] };
const index = buildSnapshotIndex({ city: machine, exists: true, builtAt: "2026-10-30T10:00:00.000Z" }, LAYOUT);
const calls = buildCallIndex(callWeb);
const screenshots = String(process.env.USAGE_MAP_SCREENSHOTS || "").trim();

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

function usageAnswer(kind: string, query: Record<string, string>, body: unknown) {
  if (kind === "entries") return readEntries(index, query);
  if (kind === "function") return readFunction(index, calls, query);
  if (kind === "join") return joinFunctions(index, calls, body);
  const entry = index.entryById.get(query.entryId);
  if (!entry) throw Object.assign(new Error("This entry point is not in the current scan."), { code: "vibe64_usage_entry_not_found" });
  return query.mode === "imports" ? readImportsWeb(index, entry, query) : readCallsWeb(index, calls, entry, query);
}

function recordingAnswer(path: string, query: URLSearchParams) {
  if (!path) return fixture("recording/api/list.json");
  if (path === "/targets" || path === "/current") return fixture(`recording/api${path}.json`);
  const functions = path.match(/\/requests\/(r_\d+)\/functions$/u);
  if (functions) return fixture(`recording/api/request-functions/${functions[1]}.json`);
  if (path.endsWith("/requests")) return fixture(query.get("includeEmpty") === "true" ? "recording/api/requests-include-empty.json" : "recording/api/requests.json");
  return { ok: true };
}

async function mockProject(page) {
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
  const usageRequests: string[] = [];
  await routeApiEndpoint(page, `${sessionApi}/usage`, async (route) => {
    const url = new URL(route.request().url());
    const kind = url.pathname.split("/").pop() || "";
    usageRequests.push(`${kind}${url.search}`);
    try {
      await fulfillJson(route, { ok: true, snapshot: index.snapshot, ...usageAnswer(kind, Object.fromEntries(url.searchParams), route.request().postDataJSON()) });
    } catch (error) {
      await route.fulfill({ status: 404, contentType: "application/json", body: JSON.stringify({ ok: false, error: error.message, code: error.code }) });
    }
  }, { children: true });
  await routeApiEndpoint(page, recordingApi, async (route) => {
    const url = new URL(route.request().url());
    await fulfillJson(route, recordingAnswer(url.pathname.replace(/^.*\/usage-recordings\/sessions\/[^/]+/u, ""), url.searchParams));
  }, { prefix: true });
  return usageRequests;
}

async function expectNoSidewaysScroll(page) {
  const overflow = await page.evaluate(() => {
    const usage = document.querySelector(".usage-view");
    return {
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      usage: usage ? usage.scrollWidth - usage.clientWidth : 0
    };
  });
  expect(overflow).toEqual({ page: 0, usage: 0 });
}

async function capture(page, name: string) {
  await expectNoSidewaysScroll(page);
  if (screenshots) await page.screenshot({ path: `${screenshots}/${name}.png` });
}

const COMPONENT_ENTRY = "entry:component:src/components/SessionList.vue";

for (const viewport of [{ width: 1280, height: 800 }, { width: 390, height: 844 }, { width: 360, height: 780 }]) {
  const phone = viewport.width <= 600;
  test(`Usage shows what one entry reaches, keeps its address and lists recorded requests at ${viewport.width}px`, async ({ page }) => {
    test.setTimeout(90_000);
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    const usageRequests = await mockProject(page);
    const shot = (level: string) => capture(page, `${viewport.width}-${level}`);

    await page.goto(`${DEVELOPMENT_PATH}/dashboard/system`);
    const sheet = page.getByRole("region", { name: "UI and Engine architecture" });
    await expect(sheet.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible({ timeout: 20_000 });
    await sheet.getByRole("group", { name: "Architecture view" }).getByRole("button", { name: "Usage" }).click();
    const usage = sheet.getByRole("region", { name: "Usage" });
    await expect(usage.getByRole("heading", { name: "Pick an entry point" })).toBeVisible();

    if (phone) {
      await usage.getByRole("button", { name: "Choose an entry" }).click();
      const dialog = page.getByRole("dialog");
      await expect(dialog.getByRole("option", { name: /Component: SessionList/u })).toBeVisible();
      await shot("0-entries");
      await dialog.getByRole("option", { name: /Component: SessionList/u }).click();
      await expect(dialog).toBeHidden();
      await expect(usage.getByRole("button", { name: "Entry: SessionList" })).toBeVisible();
    } else {
      const rail = usage.getByRole("region", { name: "Entry points" });
      await expect(rail.getByText("Pages · 1")).toBeVisible();
      await shot("0-entries");
      await rail.getByRole("option", { name: /Component: SessionList/u }).click();
    }

    // Level 1: the subsystems the component reaches through calls.
    const client = usage.locator(".usage-web__card").filter({ hasText: "Client" });
    await expect(client).toContainText(/\d+ functions?/u);
    await expect(client).toContainText(/\d+ exact · \d+ probable/u);
    await expect(usage.getByRole("switch", { name: /Show untouched/u })).toBeVisible();
    await expect(page).toHaveURL(/view=usage/u);
    await shot("1-subsystems");

    // Level 2: one subsystem's functions by depth.
    await client.click();
    await expect(usage.getByRole("button", { name: "All subsystems" })).toBeVisible();
    await expect(page).toHaveURL(/subsystem=directory%3Asrc|subsystem=directory:src/u);
    const addSession = phone ? usage.locator(".usage-web__rows .v-list-item").filter({ hasText: "addSession" }) : usage.getByRole("button", { name: /^addSession,/u });
    await expect(addSession).toBeVisible();
    await shot("2-functions");

    // Level 3: a function's calls, by certainty.
    await addSession.click();
    const details = page.getByRole("article", { name: /^Details for / });
    await expect(details.getByRole("button", { name: "Open source" })).toBeVisible();
    await expect(details.getByRole("heading", { name: /^(Calls|Called by) \((exact|probable)\)$/u }).first()).toBeVisible();
    await shot("3-function");
    await details.getByRole("button", { name: "Close details" }).click();
    await expect(details).toBeHidden();

    // Reload: the address brings back the same entry, mode and subsystem.
    await page.reload();
    await expect(usage.getByRole("button", { name: "All subsystems" })).toBeVisible({ timeout: 20_000 });
    await expect(addSession).toBeVisible();
    expect(usageRequests.some((request) => request.startsWith("web?") && request.includes(encodeURIComponent(COMPONENT_ENTRY)) && request.includes("subsystemId=directory%3Asrc"))).toBe(true);

    // Imports for the same entry.
    await usage.getByRole("group", { name: "Usage mode" }).getByRole("button", { name: "Imports" }).click();
    await expect(page).toHaveURL(/mode=imports/u);
    await expect(usage.locator(".usage-web__card").first()).toContainText(/\d+ files?/u);
    await shot("4-imports");

    // Recording: requests grouped under the click, then what one request ran.
    await usage.getByRole("group", { name: "Usage mode" }).getByRole("button", { name: "Recording" }).click();
    if (phone) await usage.getByRole("button", { name: "Choose a request" }).click();
    const requests = phone ? page.getByRole("dialog") : usage.getByRole("region", { name: "Recordings" });
    await expect(requests.getByText("Click: button \"Add\" (SessionList.vue)")).toBeVisible();
    await shot("5-requests");
    await requests.getByRole("option").filter({ hasText: "16 functions" }).click();
    await expect(page).toHaveURL(/request=r_000004/u);
    const core = usage.locator(".usage-web__card").filter({ hasText: "Core" });
    await expect(core).toContainText("6 functions ran");
    await expect(core).toContainText("Shared plumbing (5)");
    await shot("6-recorded");
    await core.click();
    await expect(usage.getByRole("switch", { name: "Show shared plumbing (5)" })).toBeVisible();
    await shot("7-recorded-functions");

    if (!phone) {
      // Map's Show usage opens the one entry under a zoomed subsystem.
      await sheet.getByRole("group", { name: "Architecture view" }).getByRole("button", { name: "Map" }).click();
      await sheet.locator(".engine-subsystem").filter({ hasText: "Command" }).click();
      const location = page.getByRole("article", { name: "Zoomed subsystem" }).getByRole("navigation", { name: "Architecture location" });
      await location.getByRole("button", { name: "Show usage" }).click();
      await expect(usage.getByRole("region", { name: "Entry points" }).getByRole("option", { name: /Command: demo/u })).toHaveAttribute("aria-selected", "true");
      await expect(page).toHaveURL(/mode=calls/u);
      await expect(page).toHaveURL(/entry=entry(?::|%3A)cli-command/u);
    }

    expect(errors).toEqual([]);
  });
}
