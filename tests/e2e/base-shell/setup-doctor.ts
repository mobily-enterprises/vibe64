import { expect, test } from "@playwright/test";

import {
  BASE_URL,
  blockedAppSetupPayload,
  blockedBootstrapPayload,
  blockedTargetAppPayload,
  viewports
} from "../support/base-shell-data";
import {
  expectGeneratedScreenContract,
  expectNoHorizontalOverflow,
  expectVisibleTapTargets
} from "../support/base-shell-assertions";
import { mockAppSetupBlocked, mockBootstrapBlocked, mockTargetAppBlocked } from "../support/base-shell-mocks";

test.describe("setup tabbed doctor responsive smoke", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} default route renders the Studio Setup tab without horizontal overflow`, async ({ page }) => {
      await mockBootstrapBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/home/dashboard/setup`);
      await expect(page).toHaveURL(/\/home\/dashboard\/setup\?tab=studio-setup$/u);
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
      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });

    test(`${viewport.name} Adapter Setup tab renders before current app inspection`, async ({ page }) => {
      await mockTargetAppBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/home/dashboard/setup?tab=adapter-setup`);
      await expect(page.getByRole("tab", { name: "Adapter Setup", exact: true })).toHaveAttribute("aria-selected", "true");
      await expect(page.getByRole("heading", { name: "Adapter Setup", exact: true })).toBeVisible();
      await expect(page.getByText("Adapter Setup blocked").first()).toBeVisible();
      await expect(page.getByText("Target directory").first()).toBeVisible();
      await expect(page.getByText("Target identity").first()).toBeVisible();
      await expect(page.getByText("Git repository").first()).toBeVisible();
      await expect(page.getByText("Git identity").first()).toBeVisible();
      await expect(page.getByText("GitHub repository").first()).toBeVisible();
      await expect(page.getByText("Initialize Git").first()).toBeVisible();
      await expect(page.getByText("Set Git identity").first()).toBeVisible();
      await expect(page.getByText("Create/link GitHub repo").first()).toBeVisible();
      await expect(page.locator(".adapter-setup-doctor .doctor-status__status-icon")).toHaveCount(
        blockedTargetAppPayload.checks.length
      );
      await expect(page.getByRole("heading", { name: "Home" })).toHaveCount(0);
      const firstFactLine = page.locator(".adapter-setup-doctor .doctor-status__fact-line").first();
      await expect(firstFactLine).toContainText("Expected:");
      await expect(firstFactLine).toContainText("Observed:");
      await page.getByRole("button", { name: "Set Git identity" }).click();
      await expect(page.getByLabel("Git user.name")).toBeVisible();
      await expect(page.getByLabel("Git user.email")).toBeVisible();
      await expect(page.getByRole("button", { name: "Run repair" })).toBeDisabled();
      await page.getByLabel("Git user.name").fill("Ada Lovelace");
      await page.getByLabel("Git user.email").fill("ada@example.com");
      await expect(page.getByRole("button", { name: "Run repair" })).toBeEnabled();
      await expect(page.locator(".doctor-repair-dialog__command")).toContainText("Ada Lovelace");
      const repairDialog = page.getByRole("dialog");
      await repairDialog.getByRole("button", { name: "Close" }).click();
      await expect(repairDialog).toBeHidden();
      await expectGeneratedScreenContract(page);
      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });

    test(`${viewport.name} Project Setup tab renders sequential stages`, async ({ page }) => {
      await mockAppSetupBlocked(page);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/home/dashboard/setup?tab=project-setup`);
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
      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });
  }
});
