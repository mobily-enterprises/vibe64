import { expect, test } from "@playwright/test";

import { BASE_URL, DASHBOARD_PATH, DEVELOPMENT_PATH } from "../support/base-shell-data";
import { expectSessionsRoute, showProjectPaneIfNeeded } from "../support/base-shell-assertions";
import {
  mockConnectionsBlocked,
  mockAppSetupBlocked,
  mockBootstrapBlocked,
  mockCurrentAppInspection,
  mockStudioReady,
  trackStudioApiRequests
} from "../support/base-shell-mocks";

test.describe("studio startup navigation", () => {
  test("root opens the project picker before setup checks when no project is selected", async ({ page }) => {
    let projectSelectionRequests = 0;
    await page.route("**/api/bootstrap", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          app: {},
          requestMeta: {
            hasRequest: false
          },
          session: {
            authenticated: false
          },
          surfaceAccess: {}
        })
      });
    });
    await page.route("**/api/vibe64/projects", async (route) => {
      projectSelectionRequests += 1;
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          ok: true,
          currentProject: null,
          hasSelection: false,
          projects: [
            {
              external: false,
              name: "demo-app",
              path: "/workspace/vibe64/demo-app",
              selected: false,
              slug: "demo-app",
              source: "workspace"
            }
          ],
          projectsRoot: "/workspace/vibe64",
          targetRoot: ""
        })
      });
    });
    const apiRequests = trackStudioApiRequests(page);

    await page.goto(`${BASE_URL}/`);

    await expect(page).toHaveURL(`${BASE_URL}/app`);
    await expect(page.getByRole("heading", { name: "Choose a project", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /demo-app/u })).toBeVisible();
    await expect(page.getByLabel("New project folder")).toBeVisible();
    expect(projectSelectionRequests).toBeGreaterThanOrEqual(1);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("root opens the project picker when studio readiness is blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockBootstrapBlocked(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(`${BASE_URL}/app`);
    await expect(page.getByRole("heading", { name: "Choose a project", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /example-target-app/u })).toBeVisible();
    await expect(page.getByText("Checking setup", { exact: true })).toHaveCount(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("root opens the project picker when setup readiness passes", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(`${BASE_URL}/app`);
    await expect(page.getByRole("heading", { name: "Choose a project", exact: true })).toBeVisible();
    await expect(page.getByRole("button", { name: /example-target-app/u })).toBeVisible();
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("project workspace loads sessions after setup readiness passes", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expectSessionsRoute(page);
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Run", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Studio Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Adapter Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Project Setup", exact: true })).toHaveCount(0);
    await expect(page.locator(".target-scripts-panel")).toHaveCount(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("inspect mode keeps Sessions primary navigation active", async ({ page }) => {
    await mockCurrentAppInspection(page);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}?mode=inspect`);

    await expectSessionsRoute(page);
    await expect(page.getByRole("tab", { name: "Preview", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("project workspace does not redirect to the blocked setup step", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expectSessionsRoute(page);
    await expect(page.getByText("Checking setup", { exact: true })).toHaveCount(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("project workspace reaches sessions when setup is ready", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("direct Project Setup tab runs the Project Setup doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup?tab=project-setup`);
    await showProjectPaneIfNeeded(page);
    await expect(page.getByRole("heading", { name: "Project Setup", exact: true })).toBeVisible();
    await expect(page.getByText("Project Setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/studio-setup")).toBeGreaterThanOrEqual(1);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.requests.filter((request) => request.endsWith("/studio/project-setup/stream"))).toHaveLength(1);
  });

  test("setup tab clicks update the URL query", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup?tab=studio-setup`);
    await showProjectPaneIfNeeded(page);
    await expect(page.getByRole("tab", { name: "Studio Setup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Project Setup", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/setup\\?tab=project-setup$`, "u"));
    await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("ready continue moves from Studio Setup to Project Setup tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup?tab=studio-setup`);
    await showProjectPaneIfNeeded(page);
    await page.getByRole("button", { name: "Project Setup", exact: true }).click();
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/setup\\?tab=project-setup$`, "u"));
    await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("project workspace disables session creation when connections are missing", async ({ page }) => {
    await mockConnectionsBlocked(page);
    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(page).toHaveURL(`${BASE_URL}${DEVELOPMENT_PATH}`);
    await expect(page.getByText("Checking setup", { exact: true })).toHaveCount(0);
    await expect(page.getByRole("button", { name: "New session" })).toBeDisabled();
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup`);
    await showProjectPaneIfNeeded(page);
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/setup(?:\\?tab=studio-setup)?$`, "u"));
    await expect(page.getByRole("tab", { name: "Studio Setup", exact: true })).toBeVisible();
  });

  test("ready Project Setup does not show a continue button", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup?tab=project-setup`);
    await showProjectPaneIfNeeded(page);
    await expect(page.getByRole("link", { name: /^Continue to/u })).toHaveCount(0);
    await expect(page.getByRole("button", { name: /^Continue to/u })).toHaveCount(0);
  });

  test("removed setup routes stay unsupported", async ({ page }) => {
    await page.goto(`${BASE_URL}/setup`);
    await expect(page).toHaveURL(/\/setup$/u);
    await expect(page.getByRole("heading", { name: "Studio Setup", exact: true })).toHaveCount(0);

    for (const removedRoute of ["/bootup", "/app-bootup", "/app-setup"]) {
      await page.goto(`${BASE_URL}${removedRoute}`);
      await expect(page).not.toHaveURL(new RegExp(`${DASHBOARD_PATH}/setup`, "u"));
    }
  });

});
