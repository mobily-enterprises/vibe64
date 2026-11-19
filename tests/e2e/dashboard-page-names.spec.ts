import { expect, test } from "@playwright/test";
import { openMenu } from "./support/settled-ui";
import { DASHBOARD_PATH, DEVELOPMENT_PATH } from "./support/base-shell-data";
import { expectNoHorizontalOverflow, showProjectPaneIfNeeded } from "./support/base-shell-assertions";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";
import { mockProjectGateReady } from "./support/base-shell-mocks";

// A saved project with no Packaging section yet: the page shows its first step.
const PUBLISHING_STATE = {
  ok: true,
  baseline: { supported: true, commit: "c".repeat(40), branch: "main", saved: true, pushed: true, remote: null, message: "" },
  packaging: { status: "missing", packages: [], diagnostics: [], problem: "" },
  targets: [],
  keys: { exists: false, unlocked: false, entries: [], recoveryKit: null },
  toolchains: { java: { ready: false }, androidSdk: { ready: false }, androidLicence: null, install: null },
  checks: null,
  pendingConfirmation: null,
  releases: [],
  activeRelease: null,
  destinations: [],
  accountKinds: [],
  accounts: [],
  share: { sharing: false }
};

// The page that publishes the project as phone apps and packages people install is Packages: the Dashboard's
// section link (and, on a phone, its section list) and the page's own header name it so, where they said Publish.
// Its address is /dashboard/packages.
for (const viewport of [{ name: "compact", width: 390, height: 844 }, { name: "expanded", width: 1280, height: 900 }]) {
  test(`${viewport.name} Dashboard names the page for phone apps and packages Packages`, async ({ page }, info) => {
    await mockProjectGateReady(page);
    await routeApiEndpoint(page, "/vibe64/publishing", (route) => fulfillJson(route, PUBLISHING_STATE));
    await page.setViewportSize(viewport);
    await page.goto(DEVELOPMENT_PATH);
    await showProjectPaneIfNeeded(page);
    await (viewport.width <= 980
      ? page.getByRole("button", { name: "Go to dashboard", exact: true })
      : page.getByRole("tab", { name: "Dashboard", exact: true })).click();
    if (viewport.width <= 760) {
      await page.getByRole("combobox", { name: "Dashboard section", exact: true }).press("ArrowDown");
      const sections = openMenu(page);
      await expect(sections.getByRole("option", { name: "Packages", exact: true })).toBeVisible();
      await expect(sections.getByRole("option", { name: "Publish", exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`dashboard-sections-${viewport.width}.png`) });
      await sections.getByRole("option", { name: "Packages", exact: true }).click();
    } else {
      const navigation = page.getByRole("navigation", { name: "Dashboard sections" });
      await expect(navigation.getByRole("link", { name: "Packages", exact: true })).toBeVisible();
      await expect(navigation.getByRole("link", { name: "Publish", exact: true })).toHaveCount(0);
      await page.screenshot({ path: info.outputPath(`dashboard-sections-${viewport.width}.png`) });
      await navigation.getByRole("link", { name: "Packages", exact: true }).click();
    }
    await expect(page).toHaveURL(new RegExp(`${DASHBOARD_PATH}/packages$`, "u"));
    await expect(page.getByRole("heading", { level: 2, name: "Packages", exact: true })).toBeVisible();
    await expect(page.getByRole("heading", { level: 2, name: "Publish", exact: true })).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: info.outputPath(`packages-page-${viewport.width}.png`) });
  });
}
