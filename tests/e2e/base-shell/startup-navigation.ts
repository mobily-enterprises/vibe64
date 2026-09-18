import { expect, test } from "@playwright/test";

import { BASE_URL, DASHBOARD_PATH, DEVELOPMENT_PATH } from "../support/base-shell-data";
import { expectSessionsRoute, showProjectPaneIfNeeded } from "../support/base-shell-assertions";
import {
  mockCurrentAppInspection,
  mockProjectGateReady,
  trackStudioApiRequests
} from "../support/base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "../support/base-shell/http";

test.describe("studio startup navigation", () => {
  test("root opens the project picker when no project is selected", async ({ page }) => {
    let projectSelectionRequests = 0;
    await page.route("**/api/bootstrap", async (route) => {
      await fulfillJson(route, {
        app: {},
        requestMeta: { hasRequest: false },
        session: { authenticated: false },
        surfaceAccess: {}
      });
    });
    await page.route("**/api/vibe64/projects", async (route) => {
      projectSelectionRequests += 1;
      await fulfillJson(route, {
        ok: true,
        currentProject: null,
        hasSelection: false,
        projects: [{
          external: false,
          name: "demo-app",
          path: "/workspace/vibe64/demo-app",
          selected: false,
          slug: "demo-app",
          source: "workspace"
        }],
        projectsRoot: "/workspace/vibe64",
        targetRoot: ""
      });
    });
    const apiRequests = trackStudioApiRequests(page);

    await page.goto(`${BASE_URL}/`);

    await expect(page).toHaveURL(`${BASE_URL}/app`);
    await expect(page.getByRole("heading", { name: "Choose a project", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /demo-app/u })).toBeVisible();
    await expect(page.getByLabel("New project folder")).toBeVisible();
    expect(projectSelectionRequests).toBeGreaterThanOrEqual(1);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("project workspace loads sessions directly after project selection", async ({ page }) => {
    await mockCurrentAppInspection(page);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);

    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expectSessionsRoute(page);
    await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
    await expect(page.getByRole("link", { name: "Health", exact: true })).toBeVisible();
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toHaveCount(0);
  });

  test("inspect mode keeps Sessions primary navigation active", async ({ page }) => {
    await mockCurrentAppInspection(page);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}?mode=inspect`);

    await expectSessionsRoute(page);
    await expect(page.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("Health opens the read-only platform report", async ({ page }) => {
    await mockProjectGateReady(page);
    await routeApiEndpoint(page, "/studio/health", async (route) => {
      await fulfillJson(route, {
        ok: true,
        healthy: true,
        checks: [{
          id: "genesis",
          label: "Genesis",
          group: "Runtime",
          status: "pass",
          observed: "Usage: genesis init",
          explanation: "Genesis is available."
        }],
        summary: { failed: 0, passed: 1, total: 1 }
      });
    });

    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/health`);
    await showProjectPaneIfNeeded(page);

    await expect(page.getByRole("heading", { name: "Studio Health", exact: true })).toBeVisible();
    await expect(page.getByText("All 1 platform checks passed.", { exact: true })).toBeVisible();
    await expect(page.getByText("Genesis", { exact: true })).toBeVisible();
  });
});
