import { expect, test } from "@playwright/test";

import {
  DEVELOPMENT_PATH,
  directChatSessionId,
  directChatSessionPayload
} from "./support/base-shell-data";
import {
  mockDirectChatSession
} from "./support/base-shell-mocks";
import {
  apiEndpointPattern,
  fulfillJson,
  routeApiEndpoint
} from "./support/base-shell/http";

const sessionApi = `/vibe64/system-graph/sessions/${directChatSessionId}`;
const systemWorldSourcePath = `/workspace/managed-sources/test/projects/example/sessions/active/${directChatSessionId}/source`;
const systemWorldSessionPayload = {
  ...directChatSessionPayload,
  agentSession: {
    ...directChatSessionPayload.agentSession,
    workdir: systemWorldSourcePath
  },
  metadata: {
    ...directChatSessionPayload.metadata,
    source_kind: "session_clone",
    source_path: systemWorldSourcePath,
    source_path_authority: "managed_session_source"
  },
  sourcePath: systemWorldSourcePath,
  sourceReady: true
};

const architecture = {
  subsystems: [{
    id: "catalog",
    root: "src/catalog",
    title: "Catalog",
    description: "Owns the book catalogue.",
    fileIds: ["file:src/catalog/catalog.js"]
  }],
  files: [{
    id: "file:src/catalog/catalog.js",
    path: "src/catalog/catalog.js",
    subsystemId: "catalog",
    sourceLines: 120
  }],
  symbols: [],
  relations: [],
  program: {
    status: "valid",
    diagnostics: [],
    modules: [{
      id: "catalog/list-books",
      subsystemId: "catalog",
      title: "List books",
      description: "Lists the current book catalogue.",
      publicContract: "Returns every current book in catalogue order.",
      path: "genesis/program/catalog/list-books.md",
      mainSource: "src/catalog/catalog.js",
      sources: ["src/catalog/catalog.js"]
    }]
  }
};

test("Architecture shows the Engine map, zooms into a subsystem and its Program, and re-scans", async ({ page }) => {
  test.setTimeout(60_000);
  await mockDirectChatSession(page);
  await page.unroute(apiEndpointPattern("/vibe64/sessions"));
  await page.unroute(apiEndpointPattern(`/vibe64/sessions/${directChatSessionId}`));
  await routeApiEndpoint(page, "/vibe64/sessions", async (route) => {
    await fulfillJson(route, {
      creation: {
        canCreate: true,
        mode: "direct"
      },
      limits: {
        openSessionCount: 1
      },
      ok: true,
      sessions: [systemWorldSessionPayload]
    });
  });
  await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, async (route) => {
    await fulfillJson(route, systemWorldSessionPayload);
  });

  let refreshCount = 0;
  await routeApiEndpoint(page, `${sessionApi}/status`, async (route) => {
    await fulfillJson(route, {
      cities: {
        machine: { available: true, error: null, path: ".genesis/machine-city.json", state: "ready", status: "current" },
        program: { available: true, error: null, path: ".genesis/program-city.json", state: "ready", status: "valid" }
      },
      ok: true,
      status: "ready"
    });
  });
  await routeApiEndpoint(page, `${sessionApi}/refresh/status`, async (route) => {
    await fulfillJson(route, { ok: true, refresh: null });
  });
  await routeApiEndpoint(page, `${sessionApi}/architecture`, async (route) => {
    await fulfillJson(route, { architecture, ok: true });
  });
  await routeApiEndpoint(page, `${sessionApi}/refresh`, async (route) => {
    refreshCount += 1;
    await fulfillJson(route, { changedFiles: [], diagnostics: [], ok: true, status: "ready" });
  });

  await page.goto(DEVELOPMENT_PATH);
  await expect(page.getByRole("region", { name: "Session chat" })).toBeVisible({ timeout: 15_000 });
  await page.getByRole("tab", { name: "Dashboard" }).click();
  await page.getByRole("link", { exact: true, name: "Architecture" }).click();

  const sheet = page.getByRole("region", { name: "UI and Engine architecture" });
  await expect(sheet.getByRole("heading", { level: 1, name: "Architecture" })).toBeVisible();
  await expect(sheet.getByText("0 pages / screens / scenes · 1 subsystems")).toBeVisible({ timeout: 15_000 });
  const subsystem = sheet.locator(".engine-subsystem").filter({ hasText: "Catalog" });
  await expect(subsystem).toContainText("Owns the book catalogue.");
  await expect(subsystem).toContainText("120 source lines");

  await subsystem.click();
  const zoomed = page.getByRole("article", { name: "Zoomed subsystem" });
  const location = zoomed.getByRole("navigation", { name: "Architecture location" });
  await expect(location.getByText("Catalog", { exact: true })).toBeVisible({ timeout: 15_000 });
  const explanation = zoomed.getByRole("region", { name: "Subsystem explanation" });
  await expect(explanation).toContainText("Owns the book catalogue.");

  await zoomed.getByRole("region", { name: "Subsystem Programs" }).getByRole("button", { name: /List books/u }).click();
  const program = zoomed.getByRole("region", { name: "Program explanation" });
  await expect(program.getByRole("heading", { level: 2, name: "List books" })).toBeVisible();
  await expect(program.getByRole("button", { name: /^Main source file src\/catalog\/catalog\.js/u })).toBeVisible();
  await expect(location.getByText("List books", { exact: true })).toBeVisible();

  await location.getByRole("button", { name: "Back to previous view" }).first().click();
  await expect(program).toBeHidden();
  await expect(explanation).toBeVisible();
  await location.getByRole("button", { exact: true, name: "Engine" }).click();
  await expect(zoomed).toHaveCount(0);

  await sheet.getByRole("button", { name: "Architecture options" }).click();
  await page.getByRole("listitem").filter({ hasText: "Re-scan project" }).click();
  await expect.poll(() => refreshCount).toBe(1);
});
