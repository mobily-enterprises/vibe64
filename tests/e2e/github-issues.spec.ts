import { expect, test, type Page } from "@playwright/test";
import { DASHBOARD_PATH, readyProjectSelectionPayload, viewports } from "./support/base-shell-data";
import { expectNoHorizontalOverflow, showProjectPaneIfNeeded } from "./support/base-shell-assertions";
import { mockProjectGateReady } from "./support/base-shell-mocks";
import { fulfillJson, routeApiEndpoint } from "./support/base-shell/http";

const labels = [
  { name: "bug", color: "d73a4a", description: "Something isn't working" },
  { name: "help wanted", color: "008672", description: "Extra attention is needed" }
];
const issue = {
  number: 1001, title: "An issue beyond the first thousand", state: "OPEN",
  body: "The issue description remains available with filters selected.",
  url: "https://github.com/example/project/issues/1001", author: { login: "alice" },
  updatedAt: "2026-09-18T00:00:00Z", createdAt: "2026-09-17T00:00:00Z",
  comments: { totalCount: 0, nodes: [], pageInfo: { hasPreviousPage: false } },
  labels: { totalCount: 2, nodes: labels }, viewerCanClose: true, viewerCanReopen: true
};
const pullRequest = {
  number: 7, title: "Keep project tabs stable", state: "OPEN", isDraft: false,
  body: "Preserve the workspace when changing tabs.",
  url: "https://github.com/example/project/pull/7", author: { login: "alice" },
  updatedAt: "2026-09-18T00:00:00Z", headRefName: "fix-tabs", baseRefName: "main",
  headRepository: { nameWithOwner: "example/project" }, changedFiles: 1, additions: 2, deletions: 1
};

async function mockGithubIssues(page: Page) {
  const requests: URL[] = [];
  await mockProjectGateReady(page);
  await routeApiEndpoint(page, "/vibe64/projects", async (route) => {
    await fulfillJson(route, {
      ...readyProjectSelectionPayload,
      currentProject: {
        ...readyProjectSelectionPayload.currentProject,
        repositoryMode: "github", githubRepository: { fullName: "example/project" }
      }
    });
  });
  await routeApiEndpoint(page, "/vibe64/issue-labels", (route) => fulfillJson(route, {
    ok: true, labels, canEditLabels: false, canCreateWithLabels: false
  }));
  await routeApiEndpoint(page, "/vibe64/settings", (route) => fulfillJson(route, { ok: true }));
  await routeApiEndpoint(page, "/vibe64/sessions/current", (route) => fulfillJson(route, { ok: true }));
  await routeApiEndpoint(page, "/vibe64/issues", async (route) => {
    const url = new URL(route.request().url());
    requests.push(url);
    await fulfillJson(route, {
      ok: true, repository: "example/project", issues: [issue], total: 1250,
      searchLimit: url.searchParams.getAll("labels").length > 1 || url.searchParams.get("search") ? 1000 : null,
      pageInfo: { hasNextPage: true, endCursor: "after-1025" }
    });
  });
  await routeApiEndpoint(page, "/vibe64/issues/1001", (route) => fulfillJson(route, { ok: true, issue }));
  await routeApiEndpoint(page, "/vibe64/pull-requests", (route) => fulfillJson(route, {
    ok: true, repository: "example/project", pullRequests: [pullRequest], total: 1, pageInfo: { hasNextPage: false }
  }));
  await routeApiEndpoint(page, "/vibe64/pull-requests/7", (route) => fulfillJson(route, { ok: true, pullRequest }));
  return requests;
}

test("GitHub tabs return to lists and keep the project mounted when clicked again", async ({ page }) => {
  await mockGithubIssues(page);
  let projectOpens = 0;
  await routeApiEndpoint(page, "/vibe64/project-runtime/open", async (route) => {
    projectOpens += 1;
    await fulfillJson(route, { ok: true, runtime: { open: true } });
  });
  await page.goto(`${DASHBOARD_PATH}/issues?issue=1001&pr=7&issueLabel=bug&prState=closed&prCursor=next-pr-page`);
  await expect(page.getByText(issue.body, { exact: true })).toBeVisible();
  const project = await page.locator(".studio-ai-sessions").elementHandle();
  const comment = page.getByRole("textbox", { name: "Add a comment", exact: true });
  await comment.fill("Keep this unfinished comment.");

  for (const name of ["Issues", "Pull requests", "Pull requests", "Issues", "Issues"]) {
    await page.getByRole("tab", { name, exact: true }).click();
    await expect(page.getByRole("tab", { name, exact: true })).toHaveAttribute("aria-selected", "true");
    await expect(page.getByLabel(name === "Issues" ? "GitHub issues" : "GitHub pull requests", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has(name === "Issues" ? "issue" : "pr")).toBe(false);
    expect(await project!.evaluate((element) => element.isConnected)).toBe(true);
    await expect(page.getByLabel("Loading project", { exact: true })).toHaveCount(0);
    expect(projectOpens).toBe(1);
  }
  await page.getByRole("tab", { name: "Pull requests", exact: true }).click();
  await page.getByRole("link", { name: /Keep project tabs stable/u }).click();
  await expect(page.getByText(pullRequest.body, { exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Pull requests", exact: true }).click();
  await expect(page.getByLabel("GitHub pull requests", { exact: true })).toBeVisible();
  expect(new URL(page.url()).searchParams.has("pr")).toBe(false);
  expect(new URL(page.url()).searchParams.get("prState")).toBe("closed");
  expect(new URL(page.url()).searchParams.get("prCursor")).toBe("next-pr-page");
  await page.getByRole("tab", { name: "Issues", exact: true }).click();
  expect(new URL(page.url()).searchParams.getAll("issueLabel")).toEqual(["bug"]);
  await page.getByRole("link", { name: /An issue beyond the first thousand/u }).click();
  await expect(comment).toHaveValue("Keep this unfinished comment.");
  expect(await project!.evaluate((element) => element.isConnected)).toBe(true);
  expect(projectOpens).toBe(1);
});

test("Repeated dashboard navigation retries a failed project opening", async ({ page }) => {
  await mockGithubIssues(page);
  let projectOpens = 0;
  await routeApiEndpoint(page, "/vibe64/project-runtime/open", async (route) => {
    projectOpens += 1;
    await fulfillJson(route, projectOpens === 1
      ? { ok: false, error: "Opening failed. Try again." }
      : { ok: true, runtime: { open: true } });
  });
  await page.goto(`${DASHBOARD_PATH}/issues`);
  await expect(page.getByRole("button", { name: "Try again", exact: true })).toBeVisible();
  await page.getByRole("tab", { name: "Dashboard", exact: true }).click();
  await expect(page.getByRole("link", { name: /An issue beyond the first thousand/u })).toBeVisible();
  expect(projectOpens).toBe(2);
});

for (const viewport of viewports) {
  test(`GitHub issue filters preserve labels and page context at ${viewport.name} width`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("response", (response) => {
      if (response.status() >= 400) errors.push(`${response.status()} ${response.url()}`);
    });
    const requests = await mockGithubIssues(page);
    await page.goto(`${DASHBOARD_PATH}/issues?issueLabel=bug&issueCursor=after-1000`);
    await showProjectPaneIfNeeded(page);
    const panel = page.locator(".issues-panel");
    const filter = panel.getByRole("combobox", { name: "Filter by labels" });
    const chips = panel.locator(".v-autocomplete .v-chip");
    const limitNotice = panel.getByText(/GitHub returns up to 1,000 matches/u);

    await expect(panel.getByRole("link", { name: /An issue beyond the first thousand/u })).toBeVisible();
    await expect(panel.getByRole("heading", { name: "Issues", exact: true })).toHaveCount(0);
    await expect(panel.getByText("example/project", { exact: true })).toHaveCount(0);
    const toolbar = panel.locator(".issues-panel__toolbar");
    await expect(toolbar.getByRole("link", { name: "Back to dashboard", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "Refresh", exact: true })).toBeVisible();
    await expect(toolbar.getByRole("button", { name: "New issue", exact: true })).toBeVisible();
    const actionCenters = await toolbar.locator("a, button").evaluateAll((actions) => actions.map((action) => {
      const box = action.getBoundingClientRect();
      return box.top + box.height / 2;
    }));
    expect(Math.max(...actionCenters) - Math.min(...actionCenters)).toBeLessThan(1);
    await expect(chips.filter({ hasText: "bug" })).toHaveCSS("background-color", "rgb(215, 58, 74)");
    await expect(limitNotice).toHaveCount(0);
    expect(requests.at(-1)?.searchParams.getAll("labels")).toEqual(["bug"]);
    expect(requests.at(-1)?.searchParams.get("cursor")).toBe("after-1000");
    await panel.getByRole("button", { name: "Next page", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("cursor")).toBe("after-1025");
    expect(new URL(page.url()).searchParams.getAll("issueLabel")).toEqual(["bug"]);

    await filter.fill("help");
    const helpOption = page.getByRole("option", { name: /help wanted/u });
    await expect(helpOption.locator(".v-chip")).toHaveCSS("background-color", "rgb(0, 134, 114)");
    await helpOption.click();
    await filter.press("Escape");
    await expect.poll(() => requests.at(-1)?.searchParams.getAll("labels")).toEqual(["bug", "help wanted"]);
    expect(new URL(page.url()).searchParams.has("issueCursor")).toBe(false);
    await expect(chips).toHaveCount(2);
    await expect(chips.filter({ hasText: "help wanted" })).toHaveCSS("background-color", "rgb(0, 134, 114)");
    await expect(panel.getByText("Match all selected labels.", { exact: true })).toBeVisible();
    await expect(limitNotice).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await panel.screenshot({ path: testInfo.outputPath(`issue-label-filters-${viewport.name}.png`) });

    await panel.getByRole("button", { name: "Closed", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("state")).toBe("closed");
    expect(requests.at(-1)?.searchParams.getAll("labels")).toEqual(["bug", "help wanted"]);
    await panel.getByRole("textbox", { name: "Search issues" }).fill("layout");
    await panel.getByRole("button", { name: "Search issues", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("search")).toBe("layout");
    await panel.getByRole("button", { name: "Next page", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.get("cursor")).toBe("after-1025");
    const filteredUrl = page.url();
    await panel.getByRole("link", { name: /An issue beyond the first thousand/u }).click();
    await expect(panel.getByText(issue.body, { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.getAll("issueLabel")).toEqual(["bug", "help wanted"]);
    await panel.getByRole("button", { name: "All issues", exact: true }).click();
    await expect(page).toHaveURL(filteredUrl);
    await expect(chips).toHaveCount(2);

    await panel.getByRole("tab", { name: "Pull requests", exact: true }).click();
    const pullRequestsPanel = page.locator(".pull-requests");
    await expect(pullRequestsPanel.getByRole("link", { name: /Keep project tabs stable/u })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await pullRequestsPanel.screenshot({ path: testInfo.outputPath(`pull-requests-${viewport.name}.png`) });
    await page.getByRole("tab", { name: "Issues", exact: true }).click();
    await expect(page).toHaveURL(filteredUrl);
    await expect(chips).toHaveCount(2);
    await page.goBack();
    await page.goForward();
    await expect(page).toHaveURL(filteredUrl);
    await expect(chips).toHaveCount(2);

    await chips.filter({ hasText: "help wanted" }).getByRole("button", { name: "Close", exact: true }).click();
    await expect.poll(() => requests.at(-1)?.searchParams.getAll("labels")).toEqual(["bug"]);
    expect(new URL(page.url()).searchParams.has("issueCursor")).toBe(false);
    await page.goBack();
    await expect(page).toHaveURL(filteredUrl);
    await expect(chips).toHaveCount(2);

    await filter.focus();
    await panel.getByRole("button", { name: "Clear Filter by labels", exact: true }).click();
    await filter.press("Escape");
    await expect(chips).toHaveCount(0);
    await expect.poll(() => requests.at(-1)?.searchParams.getAll("labels")).toEqual([]);
    expect(new URL(page.url()).searchParams.has("issueLabel")).toBe(false);
    expect(new URL(page.url()).searchParams.has("issueCursor")).toBe(false);
    expect(new URL(page.url()).searchParams.get("issueState")).toBe("closed");
    await expect(limitNotice).toBeVisible();
    await panel.getByRole("button", { name: "Clear Search issues", exact: true }).click();
    await expect(limitNotice).toHaveCount(0);
    await expectNoHorizontalOverflow(page);
    expect(errors).toEqual([]);
  });
}
