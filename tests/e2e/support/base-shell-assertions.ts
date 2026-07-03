import { expect } from "@playwright/test";

async function expectNoHorizontalOverflow(page) {
  const metrics = await page.evaluate(() => ({
    clientWidth: document.documentElement.clientWidth,
    scrollWidth: document.documentElement.scrollWidth
  }));

  expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
}

async function expectGeneratedScreenContract(page) {
  const screen = page.locator(".generated-ui-screen").first();

  await expect(screen).toBeVisible();
  await expect(screen).toHaveClass(/generated-ui-screen--(?:app|studio)/u);
  await expect(screen.locator("h1").first()).toBeVisible();
}

async function expectSessionsRoute(page) {
  await expect(page.locator(".studio-ai-sessions").first()).toBeVisible();
}

async function showProjectPaneIfNeeded(page) {
  const projectRegion = page.getByRole("region", { name: "Project", exact: true }).first();
  const viewport = page.viewportSize();
  const mobilePane = !viewport || viewport.width <= 980;
  if (!mobilePane) {
    await expect(projectRegion).toBeVisible({ timeout: 8000 });
    return;
  }
  const showProject = page.getByRole("button", { name: "Show project", exact: true }).first();
  await expect(showProject).toBeVisible({ timeout: 8000 });
  await showProject.click();
  await expect(projectRegion).toBeVisible();
}

async function expectVisibleTapTargets(page, {
  minHeight = 48
} = {}) {
  const targetHeights = await page.locator("a[href], button, [role='button'], .v-btn").evaluateAll(
    (elements) => elements
      .filter((element) => {
        const rect = element.getBoundingClientRect();
        const style = window.getComputedStyle(element);
        return style.display !== "none" && style.visibility !== "hidden" && rect.width > 0 && rect.height > 0;
      })
      .map((element) => element.getBoundingClientRect().height)
  );

  for (const height of targetHeights) {
    expect(height).toBeGreaterThanOrEqual(minHeight);
  }
}

async function expectSessionHistoryRoute(page, archive) {
  const tabName = archive === "abandoned" ? "Abandoned" : "Completed";

  await expect(page.getByRole("heading", { level: 1, name: "Session History", exact: true })).toBeVisible();
  await expect(page.getByText("Review completed and abandoned Vibe64 sessions.", { exact: true })).toHaveCount(0);
  await expect(page.getByRole("tab", { name: "Completed", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: "Abandoned", exact: true })).toBeVisible();
  await expect(page.getByRole("tab", { name: tabName, exact: true })).toHaveAttribute("aria-selected", "true");
  await expect(page.getByRole("heading", { name: "Completed Sessions", exact: true })).toHaveCount(0);
  await expect(page.getByText("Finished sessions keep their reports, decisions, issue links, and PR outcome."))
    .toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Abandoned Sessions", exact: true })).toHaveCount(0);
  await expect(page.getByText("Worktrees are removed; session branches remain recoverable in Git.")).toHaveCount(0);
}

export {
  expectNoHorizontalOverflow,
  expectGeneratedScreenContract,
  expectSessionsRoute,
  showProjectPaneIfNeeded,
  expectVisibleTapTargets,
  expectSessionHistoryRoute
};
