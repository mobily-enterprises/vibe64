import { expect, test } from "@playwright/test";
import { DASHBOARD_PATH, DEVELOPMENT_PATH, viewports } from "./support/base-shell-data";
import { expectNoHorizontalOverflow, expectSessionHistoryRoute, showProjectPaneIfNeeded } from "./support/base-shell-assertions";
import { mockSessionHistoryArchives } from "./support/base-shell-mocks";

for (const viewport of viewports) {
  test(`${viewport.name} project navigation remains reachable without horizontal overflow`, async ({ page }) => {
    await mockSessionHistoryArchives(page, []);
    await page.setViewportSize(viewport);
    await page.goto(DEVELOPMENT_PATH);
    await showProjectPaneIfNeeded(page);
    await (viewport.width <= 980
      ? page.getByRole("button", { name: "Go to dashboard", exact: true })
      : page.getByRole("tab", { name: "Dashboard", exact: true })).click();
    if (viewport.width <= 760) {
      await page.getByRole("combobox", { name: "Dashboard section", exact: true }).press("ArrowDown");
      await page.getByRole("option", { name: "Session History", exact: true }).click();
    } else {
      const navigation = page.getByRole("navigation", { name: "Dashboard sections" });
      await expect(navigation).toBeVisible();
      await navigation.getByRole("link", { name: "Session History", exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/history$`, "u"));
    await expectSessionHistoryRoute(page);
    await expectNoHorizontalOverflow(page);
    await (viewport.width <= 980
      ? page.getByRole("button", { name: "Go to preview", exact: true })
      : page.getByRole("tab", { name: "Preview", exact: true })).click();
    await expect(page).toHaveURL(new RegExp(`${DEVELOPMENT_PATH}$`, "u"));
    await expectNoHorizontalOverflow(page);
  });
}
