import { expect, test } from "@playwright/test";
import {
  BASE_URL, DEVELOPMENT_PATH, directChatSessionId, directChatSessionPayload, viewports
} from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell/codex-mocks";
import { showProjectPaneIfNeeded } from "./support/base-shell-assertions";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

const missingSession = {
  sessionId: "missing-checkout",
  sessionName: "Bookings",
  sessionRoot: "/workspace/state/sessions/active/missing-checkout",
  sourcePath: "/workspace/source/sessions/active/missing-checkout/source",
  unavailable: {
    code: "vibe64_session_source_required",
    message: "The source checkout is missing. Ask your Vibe64 administrator to restore it from a verified backup, then check again. A fresh checkout cannot recover missing unsaved work."
  }
};

for (const viewport of viewports) {
  test.describe(viewport.name, () => {
    test.use({ viewport });
    test("unavailable sessions remain visible without blocking chat and clear only after rechecking", async ({ page }) => {
      await mockDirectChatSession(page);
      await page.addInitScript(() => {
        Object.defineProperty(navigator, "clipboard", {
          value: { writeText: async (value: string) => { (window as any).copiedRecoveryDetails = value; } },
          configurable: true
        });
      });
      let unavailableSessions = [missingSession];
      let sessions = [directChatSessionPayload];
      let listReads = 0;
      await routeApiEndpoint(page, "/vibe64/sessions", (route) => {
        listReads += 1;
        return fulfillJson(route, {
          ok: true, creation: { canCreate: true, showCreateAction: true, mode: "direct" }, limits: { openSessionCount: sessions.length },
          sessions, unavailableSessions
        });
      });
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}?session=missing-checkout`);
      const notice = page.locator(".studio-unavailable-sessions");
      await expect(notice).toContainText("Bookings");
      await expect(notice).toContainText("verified backup");
      const healthyTab = page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).first();
      await expect(healthyTab).toBeVisible();
      await expect(healthyTab).toHaveClass(/studio-ai-sessions__tab--active/u);
      await expect(page.locator('[data-vibe64-session-id="missing-checkout"]')).toHaveCount(0);
      await notice.getByRole("button", { name: "Copy recovery details" }).click();
      await expect.poll(() => page.evaluate(() => JSON.parse((window as any).copiedRecoveryDetails || "null"))).toMatchObject({
        project: "example-target-app", sessionId: missingSession.sessionId,
        code: missingSession.unavailable.code, sourcePath: missingSession.sourcePath
      });
      const readsBefore = listReads;
      await notice.getByRole("button", { name: "Check again", exact: true }).click();
      await expect.poll(() => listReads).toBeGreaterThan(readsBefore);
      await expect(notice).toBeVisible();
      await expect(notice.getByRole("button", { name: "Check again", exact: true })).toBeEnabled();
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
      await page.screenshot({ path: `/tmp/vibe64-session-availability-${viewport.name}.png` });

      unavailableSessions = [];
      await notice.getByRole("button", { name: "Check again", exact: true }).click();
      await expect(notice).toBeHidden();
      await expect(healthyTab).toBeVisible();
      await expect(healthyTab).toHaveClass(/studio-ai-sessions__tab--active/u);

      const unsupported = {
        sessionId: "unsupported-archive", sessionName: "Old review",
        unavailable: { code: "vibe64_session_runtime_unsupported", message: "This session uses an unsupported format. Ask your Vibe64 administrator to preserve its remaining files and retire the record. Start a new session to continue working." }
      };
      await routeApiEndpoint(page, "/vibe64/sessions/archived", (route) => fulfillJson(route, {
        ok: true,
        sessions: [{ ...directChatSessionPayload, status: "archived", archived: true }],
        unavailableSessions: [unsupported]
      }));
      await showProjectPaneIfNeeded(page);
      await (viewport.width <= 980
        ? page.getByRole("button", { name: "Go to dashboard", exact: true })
        : page.getByRole("tab", { name: "Dashboard", exact: true })).click();
      if (viewport.width <= 760) {
        await page.getByRole("combobox", { name: "Dashboard section", exact: true }).press("ArrowDown");
        await page.getByRole("option", { name: "Session History", exact: true }).click();
      } else {
        await page.getByRole("navigation", { name: "Dashboard sections" })
          .getByRole("link", { name: "Session History", exact: true }).click();
      }
      await expect(page.locator(".studio-archived-sessions").getByText("Old review", { exact: true })).toBeVisible();
      await expect(page.locator(".studio-archived-sessions").getByRole("link", { name: "View", exact: true })).toBeVisible();
      await (viewport.width <= 980
        ? page.getByRole("button", { name: "Go to preview", exact: true })
        : page.getByRole("tab", { name: "Preview", exact: true })).click();
      if (viewport.width <= 980) {
        await page.getByRole("button", { name: "Show chat", exact: true }).click();
      }
      await expect(healthyTab).toBeVisible();
      await expect(notice).toBeHidden();

      sessions = [];
      unavailableSessions = [missingSession];
      await page.reload();
      await expect(notice).toContainText("Bookings");
      await expect(healthyTab).toBeHidden();
      await expect(page.getByRole("button", { name: "New session", exact: true })).toBeVisible();
    });
  });
}
