import { expect, test } from "@playwright/test";

import { BASE_URL, DASHBOARD_PATH, DEVELOPMENT_PATH, viewports } from "../support/base-shell-data";
import {
  expectNoHorizontalOverflow,
  expectSessionHistoryRoute,
  showProjectPaneIfNeeded
} from "../support/base-shell-assertions";
import { mockSessionHistoryArchives } from "../support/base-shell-mocks";

test.describe("session history navigation", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} session history groups archive tabs under secondary navigation`, async ({ page }) => {
      const archiveRequests = [];
      await mockSessionHistoryArchives(page, archiveRequests);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/history`);
      await showProjectPaneIfNeeded(page);

      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history(?:\\?tab=completed)?$`, "u"));
      await expectSessionHistoryRoute(page, "completed");
      await expect(page.getByText("issue-2-session-history")).toBeVisible();
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      if (viewport.width > 980) {
        await expect(page.getByRole("link", { name: /^Session History$/u }).first()).toBeVisible();
      }
      await expect(page.getByRole("link", { name: /^Completed$/u })).toHaveCount(0);
      await expect(page.getByRole("link", { name: /^Abandoned$/u })).toHaveCount(0);
      expect(archiveRequests.some((request) => {
        return request.includes("/vibe64/sessions?") && request.includes("archive=completed");
      })).toBe(true);

      await page.getByRole("link", { name: "View", exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history/2026-05-12_03-10-00\\?tab=completed$`, "u"));
      await expect(page.getByText("Read-only history. Source restore is not available from archived sessions.")).toBeVisible();
      await expect(page.getByText("Completed archive report.")).toBeVisible();
      await expect(page.getByText("Please finish the session.")).toBeVisible();
      await expect(page.getByText("I finished the session.")).toBeVisible();
      const archiveConversationBody = page.locator(".studio-archived-session-detail__conversation .studio-conversation-log__body");
      await expect(archiveConversationBody).toHaveCSS("overflow-y", "auto");
      await expect(archiveConversationBody).toHaveCSS("overscroll-behavior-y", "contain");
      await page.getByRole("link", { name: "Back to sessions" }).click();
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history\\?tab=completed$`, "u"));

      await page.getByRole("tab", { name: "Abandoned", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history\\?tab=abandoned$`, "u"));
      await expectSessionHistoryRoute(page, "abandoned");
      await expect(page.getByText("issue-2-abandoned-session")).toBeVisible();

      await page.getByRole("tab", { name: "Completed", exact: true }).click();
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history\\?tab=completed$`, "u"));
      await expectSessionHistoryRoute(page, "completed");

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/history/open-session?tab=completed`);
      await showProjectPaneIfNeeded(page);
      await expect(page.getByText("Archived session unavailable")).toBeVisible();
      await expect(page.getByText("Read-only history. Source restore is not available from archived sessions.")).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
    });
  }

  test("removed completed and abandoned routes stay unsupported", async ({ page }) => {
    const archiveRequests = [];
    await mockSessionHistoryArchives(page, archiveRequests);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}/completed`);
    await expect(page.getByRole("heading", { name: "Completed Sessions", exact: true })).toHaveCount(0);
    await expect(page.locator(".studio-archived-sessions")).toHaveCount(0);

    await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}/abandoned`);
    await expect(page.getByRole("heading", { name: "Abandoned Sessions", exact: true })).toHaveCount(0);
    await expect(page.locator(".studio-archived-sessions")).toHaveCount(0);
    expect(archiveRequests).toEqual([]);
  });
});
