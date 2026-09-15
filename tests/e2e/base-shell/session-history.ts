import { expect, test } from "@playwright/test";

import { BASE_URL, DASHBOARD_PATH, viewports } from "../support/base-shell-data";
import {
  expectNoHorizontalOverflow,
  expectSessionHistoryRoute,
  showProjectPaneIfNeeded
} from "../support/base-shell-assertions";
import { mockSessionHistoryArchives } from "../support/base-shell-mocks";

test.describe("session history navigation", () => {
  for (const viewport of viewports) {
    test(`${viewport.name} session history shows archived direct chats`, async ({ page }) => {
      const archiveRequests = [];
      await mockSessionHistoryArchives(page, archiveRequests);
      await page.setViewportSize({ width: viewport.width, height: viewport.height });
      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/history`);
      await showProjectPaneIfNeeded(page);

      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history$`, "u"));
      await expectSessionHistoryRoute(page);
      await expect(page.getByText("Archived direct chat")).toBeVisible();
      await expect(page.getByText(/^Archived /u)).toBeVisible();
      await expect(page.getByText("source removed", { exact: true })).toHaveCount(0);
      await expect(page.getByRole("button", { name: "Refresh" })).toBeVisible();
      if (viewport.width > 980) {
        await expect(page.getByRole("link", { name: /^Session History$/u }).first()).toBeVisible();
      }
      expect(archiveRequests.some((request) => {
        return request.endsWith("/vibe64/sessions/archived");
      })).toBe(true);

      await page.getByRole("link", { name: "View", exact: true }).first().click();
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history/2026-05-12_03-11-00$`, "u"));
      await expect(page.getByText("Read-only history. Source restore is not available from archived sessions.")).toBeVisible();
      await expect(page.getByText("Stop this session.")).toBeVisible();
      await expect(page.getByText("I stopped before finishing this session.")).toBeVisible();
      const archiveConversationBody = page.locator(".studio-archived-session-detail__conversation .assistant-transcript__body");
      await expect(archiveConversationBody).toHaveCSS("overflow-y", "auto");
      await expect(archiveConversationBody).toHaveCSS("overscroll-behavior-y", "contain");
      await page.getByRole("link", { name: "Back to sessions" }).click();
      await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history$`, "u"));

      await page.goto(`${BASE_URL}${DASHBOARD_PATH}/history/open-session`);
      await showProjectPaneIfNeeded(page);
      await expect(page.getByText("Archived session unavailable")).toBeVisible();
      await expect(page.getByText("Read-only history. Source restore is not available from archived sessions.")).toHaveCount(0);

      await expectNoHorizontalOverflow(page);
    });
  }
});
