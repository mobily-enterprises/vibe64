import { expect, test } from "@playwright/test";

import {
  BASE_URL,
  DASHBOARD_PATH,
  blockedAppSetupPayload,
  blockedBootstrapPayload,
  viewports
} from "../support/base-shell-data";
import {
  expectGeneratedScreenContract,
  expectNoHorizontalOverflow,
  showProjectPaneIfNeeded
} from "../support/base-shell-assertions";
import { mockAppSetupBlocked, mockBootstrapBlocked } from "../support/base-shell-mocks";

test.describe("setup tabbed doctor responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} default route renders the Studio Setup tab without horizontal overflow`, async ({ page }) => {
      await mockBootstrapBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup`);
      await showProjectPaneIfNeeded(page);
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/setup\\?tab=studio-setup$`, "u"));
      await expect(page.getByRole("tab", { name: "Studio Setup", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: "Studio Setup", exact: true })).toBeVisible();
      await expect(page.getByText("Studio Setup blocked").first()).toBeVisible();
      await expect(page.getByText("MySQL capability").first()).toBeVisible();
      await expect(page.getByText("Managed toolchain image").first()).toBeVisible();
      await expect(page.locator(".doctor-status__status-icon")).toHaveCount(blockedBootstrapPayload.checks.length);
      await expect(page.getByText("Pass", { exact: true })).toHaveCount(0);
      await expect(page.getByText("Fail", { exact: true })).toHaveCount(0);
      const firstFactLine = page.locator(".doctor-status__fact-line").first();
      await expect(firstFactLine).toContainText("Expected:");
      await expect(firstFactLine).toContainText("Observed:");
      await expectGeneratedScreenContract(page);
      await expectNoHorizontalOverflow(page);
    });

    test(`${viewport.name} Project Setup tab renders sequential stages`, async ({ page }) => {
      await mockAppSetupBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/setup?tab=project-setup`);
      await showProjectPaneIfNeeded(page);
      await expect(page.getByRole("tab", { name: "Project Setup", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: "Project Setup", exact: true })).toBeVisible();
      await expect(page.getByText("Project Setup blocked").first()).toBeVisible();
      await expect(page.getByText("Directory admissibility").first()).toBeVisible();
      await expect(page.getByText("Remote/local sync").first()).toBeVisible();
      await expect(page.getByText("Seed JSKIT app").first()).toBeVisible();
      await expect(page.getByText("Dependencies runnable").first()).toBeVisible();
      await expect(page.getByText("JSKIT doctor").first()).toBeVisible();
      await expect(page.getByText("Git checkpoint").first()).toBeVisible();
      await expect(page.getByRole("button", { name: "Seed this project" })).toBeVisible();
      await expect(page.locator(".project-setup-doctor .doctor-status__status-icon")).toHaveCount(
        blockedAppSetupPayload.stages.length
      );
      const scaffoldFactLine = page.locator(".project-setup-doctor .doctor-status__fact-line").nth(4);
      await expect(scaffoldFactLine).toContainText("Expected:");
      await expect(scaffoldFactLine).toContainText("Observed:");
      await expectGeneratedScreenContract(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});
