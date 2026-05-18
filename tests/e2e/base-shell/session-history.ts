import { expect, test } from "@playwright/test";

import { BASE_URL, viewports } from "../support/base-shell-data";
import {
  expectNoHorizontalOverflow,
  expectSessionHistoryRoute,
  expectVisibleTapTargets
} from "../support/base-shell-assertions";
import { mockSessionHistoryArchives } from "../support/base-shell-mocks";

test.describe("session history navigation", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} session history groups archive tabs under secondary navigation`, async ({ page }) => {
      const archiveRequests = [];
      await mockSessionHistoryArchives(page, archiveRequests);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}/home/history`);

      await expect(page).toHaveURL(/\/home\/history\?tab=completed$/u);
      await expectSessionHistoryRoute(page, "completed");
      await expect(page.getByText("issue-2-session-history")).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      await expect(page.getByRole("link", { name: /^Sessions$/u }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^Session History$/u }).first()).toBeVisible();
      await expect(page.getByRole("link", { name: /^Completed$/u })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Abandoned$/u })).toHaveCount(0);
      expect(archiveRequests).toContain("/api/ai-studio/sessions");

      await page.getByRole("tab", { name: "Abandoned", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/history\?tab=abandoned$/u);
      await expectSessionHistoryRoute(page, "abandoned");
      await expect(page.getByText("issue-2-abandoned-session")).toBeVisible();

      await page.getByRole("tab", { name: "Completed", exact: true }).click();
      await expect(page).toHaveURL(/\/home\/history\?tab=completed$/u);
      await expectSessionHistoryRoute(page, "completed");

      await expectVisibleTapTargets(page);
      await expectNoHorizontalOverflow(page);
    });
  }

  test("old completed and abandoned routes are not preserved as archive views", async ({ page }) => {
    const archiveRequests = [];
    await mockSessionHistoryArchives(page, archiveRequests);

    await page.goto(`${BASE_URL}/home/completed`);
    await expect(page.getByRole("heading", { name: "Completed Sessions", exact: true })).toHaveCount(0);
    await expect(page.locator(".studio-archived-sessions")).toHaveCount(0);

    await page.goto(`${BASE_URL}/home/abandoned`);
    await expect(page.getByRole("heading", { name: "Abandoned Sessions", exact: true })).toHaveCount(0);
    await expect(page.locator(".studio-archived-sessions")).toHaveCount(0);
    expect(archiveRequests).toEqual([]);
  });
});
