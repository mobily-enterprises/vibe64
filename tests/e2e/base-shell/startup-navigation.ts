import { expect, test } from "@playwright/test";

import { BASE_URL, currentAppPayload } from "../support/base-shell-data";
import { expectSessionsRoute } from "../support/base-shell-assertions";
import {
  mockAppSetupBlocked,
  mockBootstrapBlocked,
  mockCurrentAppInspection,
  mockStudioReady,
  mockTargetAppBlocked,
  mockTargetScripts,
  trackStudioApiRequests
} from "../support/base-shell-mocks";

test.describe("studio startup navigation", () => {
  test("root opens Studio Setup when studio readiness is blocked", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockBootstrapBlocked(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/setup\?tab=studio-setup$/u);
    await expect(page.getByRole("heading", { name: "Studio Setup", exact: true })).toBeVisible();
    await expect(page.getByText("Studio Setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(1);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup/stream")).toBe(1);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("root opens home when setup readiness passes", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(1);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("home loads sessions after setup readiness passes", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await mockCurrentAppInspection(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    await expect(page.getByRole("link", { name: "Setup", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Target Scripts", exact: true })).toHaveCount(1);
    await expect(page.getByRole("link", { name: "Studio Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Adapter Setup", exact: true })).toHaveCount(0);
    await expect(page.getByRole("link", { name: "Project Setup", exact: true })).toHaveCount(0);
    await expect(page.locator(".target-scripts-panel")).toHaveCount(0);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(1);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("inspect mode keeps Sessions primary navigation active", async ({ page }) => {
    await mockTargetAppBlocked(page);
    await mockCurrentAppInspection(page);

    await page.goto(`${BASE_URL}/home?mode=inspect`);

    await expectSessionsRoute(page);
    await expect(page.getByRole("link", { name: /^Sessions$/u }).first()).toHaveAttribute("aria-current", "page");
  });

  test("target scripts page persists stars, resets defaults, and runs one terminal", async ({ page }) => {
    const terminalInputs: string[] = [];
    const terminalStarts: string[] = [];
    await page.route("**/api/studio/current-app", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify(currentAppPayload)
      });
    });
    await page.route("**/api/vibe64/sessions**", async (route) => {
      await route.fulfill({
        contentType: "application/json",
        body: JSON.stringify({
          limits: {
            maxOpenSessions: 5,
            openSessionCount: 0
          },
          ok: true,
          sessions: [],
          stepDefinitions: []
        })
      });
    });
    await mockTargetScripts(page, {
      terminalInputs,
      terminalStarts
    });

    await page.goto(`${BASE_URL}/home?mode=inspect`);
    await page.getByRole("link", { name: "Target Scripts", exact: true }).click();
    await expect(page).toHaveURL(/\/home\/target-scripts\?mode=inspect$/u);

    await page.goto(`${BASE_URL}/home/target-scripts`);
    const panel = page.locator(".target-scripts-panel");
    await expect(panel).toBeVisible();
    await expect(page.getByRole("link", { name: "Target Scripts", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { name: "Target Scripts", exact: true })).toHaveCount(0);

    await expect.poll(async () => {
      return panel.locator(".target-scripts-panel__starred button[aria-label^='Run ']")
        .evaluateAll((buttons) => buttons.map((button) =>
          String(button.getAttribute("aria-label") || "").replace(/^Run /u, "")
        ));
    }).toEqual(["jskit:update", "build", "server", "verify"]);
    await expect(panel.getByText("vite preview")).toHaveCount(0);
    await expect(panel.getByRole("button", { name: "Reset" })).toHaveCount(0);
    await expect(panel.getByRole("button", { name: /^Star /u })).toHaveCount(0);

    await page.goto(`${BASE_URL}/home/target-scripts?mode=inspect`);
    await expect(panel.getByText("vite preview")).toBeVisible();

    await panel.getByRole("button", { name: "Unstar jskit:update" }).click();
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run jskit:update" }))
      .toHaveCount(0);
    await panel.getByRole("button", { name: "Star preview" }).click();
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run preview" }))
      .toBeVisible();
    await expect(panel.locator(".target-scripts-panel__other-scripts").getByRole("button", { name: "Run preview" }))
      .toHaveCount(0);
    await panel.getByRole("button", { name: "Reset" }).click();
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run preview" }))
      .toHaveCount(0);
    await expect(panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run jskit:update" }))
      .toBeVisible();

    await panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run build" }).click();
    await expect.poll(() => terminalStarts).toEqual(["build"]);
    const terminal = page.locator(".target-script-terminal");
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("vite build");
    await expect(terminal.locator(".xterm-rows")).toContainText("Started target-term-build.");
    const viewport = page.viewportSize();
    await expect.poll(async () => {
      const box = await terminal.boundingBox();
      return Boolean(
        box &&
        viewport &&
        Math.round(box.width) === viewport.width &&
        Math.round(box.height) === viewport.height
      );
    }).toBe(true);
    await terminal.getByRole("button", { name: "Ctrl-C" }).click();
    await expect.poll(() => terminalInputs).toContain("\u0003");
    await terminal.getByRole("button", { name: "Close target script terminal" }).click();
    await expect(terminal).toHaveCount(0);

    await panel.locator(".target-scripts-panel__starred").getByRole("button", { name: "Run server" }).click();
    await expect.poll(() => terminalStarts).toEqual(["build", "server"]);
    await expect(terminal).toHaveCount(1);
    await expect(terminal).toContainText("node server.js");
  });

  test("home redirects to the blocked setup step", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/setup\?tab=project-setup$/u);
    await expect(page.getByRole("heading", { name: "Project Setup", exact: true })).toBeVisible();
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(1);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("home reaches sessions when every setup gate is ready", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/home`);
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness")).toBe(1);
    expect(apiRequests.count("/api/studio/current-app/setup-readiness/stream")).toBe(0);
    expect(apiRequests.count("/api/studio/studio-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/current-app")).toBe(0);
  });

  test("direct Adapter Setup tab runs the adapter setup stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockTargetAppBlocked(page);
    await page.goto(`${BASE_URL}/setup?tab=adapter-setup`);
    await expect(page.getByRole("heading", { name: "Adapter Setup", exact: true })).toBeVisible();
    await expect(page.getByText("Adapter Setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/studio-setup")).toBeGreaterThanOrEqual(1);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/adapter-setup/stream")).toBe(1);
  });

  test("direct Project Setup tab runs the Project Setup doctor stream once", async ({ page }) => {
    const apiRequests = trackStudioApiRequests(page);
    await mockAppSetupBlocked(page);
    await page.goto(`${BASE_URL}/setup?tab=project-setup`);
    await expect(page.getByRole("heading", { name: "Project Setup", exact: true })).toBeVisible();
    await expect(page.getByText("Project Setup blocked").first()).toBeVisible();
    expect(apiRequests.count("/api/studio/studio-setup")).toBeGreaterThanOrEqual(1);
    expect(apiRequests.count("/api/studio/adapter-setup")).toBeGreaterThanOrEqual(1);
    expect(apiRequests.count("/api/studio/project-setup")).toBe(0);
    expect(apiRequests.count("/api/studio/project-setup/stream")).toBe(1);
  });

  test("setup tab clicks update the URL query", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=studio-setup`);
    await expect(page.getByRole("tab", { name: "Studio Setup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Adapter Setup", exact: true }).click();
    await expect(page).toHaveURL(/\/setup\?tab=adapter-setup$/u);
    await expect(page.getByRole("tab", { name: "Adapter Setup", exact: true })).toHaveAttribute("aria-selected", "true");

    await page.getByRole("tab", { name: "Project Setup", exact: true }).click();
    await expect(page).toHaveURL(/\/setup\?tab=project-setup$/u);
    await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
  });

  test("ready continue moves from Studio Setup to Accounts tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=studio-setup`);
    await page.getByRole("button", { name: "Continue to Accounts" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=accounts$/u);
    await expect(page.getByRole("heading", { name: "Accounts", exact: true })).toBeVisible();
  });

  test("ready continue moves from Adapter Setup to Project Setup tab", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=adapter-setup`);
    await page.getByRole("button", { name: "Continue to Project Setup" }).click();
    await expect(page).toHaveURL(/\/setup\?tab=project-setup$/u);
    await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByRole("heading", { name: "Preparing your project", exact: true })).toBeVisible();
  });

  test("ready continue moves from Project Setup to home", async ({ page }) => {
    await mockStudioReady(page);
    await page.goto(`${BASE_URL}/setup?tab=project-setup`);
    await page.getByRole("link", { name: "Continue to home" }).click();
    await expect(page).toHaveURL(/\/home$/u);
    await expectSessionsRoute(page);
  });

  test("removed setup routes stay unsupported", async ({ page }) => {
    for (const removedRoute of ["/bootup", "/app-bootup", "/app-setup"]) {
      await page.goto(`${BASE_URL}${removedRoute}`);
      await expect(page).not.toHaveURL(/\/setup/u);
    }
  });

});
