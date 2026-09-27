import { expect, test } from "@playwright/test";
import { BASE_URL, DEVELOPMENT_PATH, directChatSessionId, directChatSessionPayload } from "./support/base-shell-data";
import { mockDirectChatSession } from "./support/base-shell/codex-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

for (const viewport of [{ name: "desktop", width: 1440, height: 1000 }, { name: "mobile", width: 390, height: 844 }]) {
  test.describe(viewport.name, () => {
    test.use({ viewport: { width: viewport.width, height: viewport.height }, hasTouch: viewport.name === "mobile", isMobile: viewport.name === "mobile" });
    test("rename from session details, save with Enter, and cancel with Escape", async ({ page }) => {
      await page.setViewportSize(viewport);
      await mockDirectChatSession(page);
      let sessionName = "Bookings";
      const names: string[] = [];
      await routeApiEndpoint(page, "/vibe64/sessions", (route) => fulfillJson(route, {
        ok: true, creation: { canCreate: true, mode: "direct" }, limits: { openSessionCount: 1 },
        sessions: [{ ...directChatSessionPayload, sessionName }]
      }));
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}`, (route) => fulfillJson(route, { ...directChatSessionPayload, sessionName }));
      await routeApiEndpoint(page, `/vibe64/sessions/${directChatSessionId}/name`, async (route) => {
        expect(route.request().method()).toBe("PATCH");
        sessionName = route.request().postDataJSON().name;
        names.push(sessionName);
        await fulfillJson(route, { ok: true, sessionId: directChatSessionId, sessionName });
      });
      await page.goto(`${BASE_URL}${DEVELOPMENT_PATH}`);
      const tab = page.locator(`[data-vibe64-session-id="${directChatSessionId}"]:visible`).first();
      await expect(tab).toContainText("Bookings");
      const openInfo = async () => {
        if (viewport.name === "mobile") await tab.getByRole("button", { name: /^Session info:/u }).click();
        else await tab.hover();
        await page.getByRole("button", { name: "Rename session", exact: true }).click();
      };
      await openInfo();
      const dialog = page.getByRole("dialog", { name: "Rename session" });
      const input = dialog.getByRole("textbox", { name: "Session name" });
      await expect(input).toBeFocused();
      await expect(dialog.getByRole("button", { name: "Rename", exact: true })).toBeDisabled();
      await input.fill("  ");
      await expect(dialog.getByRole("button", { name: "Rename", exact: true })).toBeDisabled();
      await input.fill("My bookings");
      await input.press("Enter");
      await expect(dialog).toBeHidden();
      await expect(tab).toContainText("My bookings");
      expect(names).toEqual(["My bookings"]);
      expect(new URL(page.url()).pathname).toBe(DEVELOPMENT_PATH);
      await page.mouse.move(0, viewport.height - 1);
      await openInfo();
      await input.fill("Cancelled");
      await input.press("Escape");
      await expect(dialog).toBeHidden();
      expect(names).toEqual(["My bookings"]);
      await expect(tab).toContainText("My bookings");
      await page.screenshot({ path: `/tmp/vibe64-session-rename-${viewport.name}.png` });
    });
  });
}
