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
  await routeApiEndpoint(page, "/vibe64/issue-mentions", (route) => fulfillJson(route, {
    ok: true, users: [{ login: "alice" }, { login: "tamiastewart123", name: "Tamia Stewart" },
      ...(new URL(route.request().url()).searchParams.has("number") ? [{ login: "early-commenter", name: "Early participant" }] : [])]
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

for (const viewport of viewports) {
  test(`label clicks search issues without opening them at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    const requests = await mockGithubIssues(page);
    await page.goto(`${DASHBOARD_PATH}/issues?issueState=all&issueSearch=old&issueLabel=bug&issueCursor=after-1000`);
    await showProjectPaneIfNeeded(page);
    const panel = page.locator(".issues-panel");
    const search = panel.getByRole("textbox", { name: "Search issues", exact: true });
    await panel.getByRole("button", { name: "Filter by label help wanted", exact: true }).click();
    await expect(search).toHaveValue('label:"help wanted"');
    await expect.poll(() => requests.at(-1)?.searchParams.get("search")).toBe('label:"help wanted"');
    const filteredUrl = page.url();
    const query = new URL(filteredUrl).searchParams;
    expect(query.get("issueState")).toBe("all");
    for (const key of ["issue", "issueCursor", "issueLabel"]) expect(query.has(key)).toBe(false);
    expect(requests.at(-1)?.searchParams.getAll("labels")).toEqual([]);
    await expectNoHorizontalOverflow(page);
    await panel.screenshot({ path: testInfo.outputPath(`label-search-${viewport.name}.png`) });

    await panel.getByRole("link", { name: issue.title, exact: true }).click();
    await expect(panel.getByText(issue.body, { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "All issues", exact: true }).click();
    await expect(page).toHaveURL(filteredUrl);
    await expect(search).toHaveValue('label:"help wanted"');
    await panel.getByRole("tab", { name: "Pull requests", exact: true }).click();
    await page.getByRole("tab", { name: "Issues", exact: true }).click();
    await expect(search).toHaveValue('label:"help wanted"');

    await panel.getByRole("link", { name: issue.title, exact: true }).click();
    const bug = panel.getByRole("button", { name: "Filter by label bug", exact: true });
    await bug.focus();
    await bug.press("Enter");
    await expect(search).toHaveValue("label:bug");
    expect(new URL(page.url()).searchParams.has("issue")).toBe(false);
    await page.goBack();
    await expect(panel.getByText(issue.body, { exact: true })).toBeVisible();
    await page.goForward();
    await expect(search).toHaveValue("label:bug");
    await search.fill('layout label:new label:"some label"');
    await search.press("Enter");
    await expect.poll(() => requests.at(-1)?.searchParams.get("search")).toBe('layout label:new label:"some label"');
    await panel.getByRole("button", { name: "Clear Search issues", exact: true }).click();
    await expect(search).toHaveValue("");
    await expect.poll(() => requests.at(-1)?.searchParams.has("search")).toBe(false);
  });

  test(`GitHub attachment images render safely at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockGithubIssues(page);
    const rawBody = 'Screenshot: <img width="1637" height="892" alt="Schedule" src="https://github.com/user-attachments/assets/example" />';
    const imageUrl = "https://private-user-images.githubusercontent.com/example/schedule.png?jwt=fixture";
    await page.route("https://private-user-images.githubusercontent.com/**", route => route.fulfill({
      contentType: "image/svg+xml",
      body: '<svg xmlns="http://www.w3.org/2000/svg" width="1637" height="892"><rect width="1637" height="892" fill="#b5c7dd"/><text x="80" y="120" font-size="60">Schedule attachment</text></svg>'
    }));
    const bodyHTML = `<p>Screenshot: <strong>Schedule</strong></p><p><a href="${imageUrl}"><img src="${imageUrl}" alt="Schedule" width="1637" height="892" onload="window.imageScriptRan=true" style="position:fixed;width:9999px"></a></p>
      <script>window.imageScriptRan=true</script><iframe src="https://example.com"></iframe>
      <a href="javascript:window.imageScriptRan=true">Unsafe link</a><p><code>&lt;img src="example"&gt;</code></p>`;
    await routeApiEndpoint(page, "/vibe64/issues/1001", route => fulfillJson(route, {
      ok: true, issue: { ...issue, body: rawBody, bodyHTML, viewerCanUpdate: true,
        comments: { ...issue.comments, totalCount: 1, nodes: [{
          id: "image-comment", body: `![Comment attachment](${imageUrl})`,
          bodyHTML: `<p><img src="${imageUrl}" alt="Comment attachment" width="1637" height="892"></p>`,
          author: { login: "alice" }, createdAt: issue.createdAt
        }] } }
    }));
    await page.goto(`${DASHBOARD_PATH}/issues?issue=1001`);
    await showProjectPaneIfNeeded(page);
    const image = page.getByRole("img", { name: "Schedule", exact: true });
    await expect(image).toBeVisible();
    await expect(image).toHaveAttribute("src", imageUrl);
    await expect.poll(() => image.evaluate((element: HTMLImageElement) => element.naturalWidth)).toBe(1637);
    await expect(page.getByRole("img", { name: "Comment attachment", exact: true })).toBeVisible();
    const content = page.locator(".github-markdown");
    await expect(content.locator("script, iframe, [onload], [style], a[href^='javascript:']")).toHaveCount(0);
    expect(await page.evaluate(() => (window as Window & { imageScriptRan?: boolean }).imageScriptRan)).toBeUndefined();
    await expect(content.locator("code")).toHaveText('<img src="example">');
    expect(await image.evaluate(element => element.getBoundingClientRect().width <= element.closest(".github-markdown")!.clientWidth)).toBe(true);
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`github-images-${viewport.name}.png`) });
    await page.getByRole("button", { name: "Edit issue", exact: true }).click();
    await expect(page.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(rawBody);
    await page.getByRole("button", { name: "Close issue dialog", exact: true }).click();
    await page.getByRole("button", { name: "All issues", exact: true }).click();
    await page.getByRole("link", { name: /An issue beyond the first thousand/u }).click();
    await expect(image).toBeVisible();
  });

  test(`optimistic issue comments retain failed posts and retry at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockGithubIssues(page);
    let savedComments: object[] = [];
    let finishRequest: () => void = () => {};
    const postedBodies: string[] = [];
    await routeApiEndpoint(page, "/vibe64/issues/1001", (route) => fulfillJson(route, {
      ok: true, issue: { ...issue, comments: { ...issue.comments, nodes: savedComments, totalCount: savedComments.length } }
    }));
    await routeApiEndpoint(page, "/vibe64/issues/1001/comments", async (route) => {
      const body = route.request().postDataJSON().body;
      postedBodies.push(body);
      await new Promise<void>((resolve) => { finishRequest = resolve; });
      if (postedBodies.length === 1) {
        await route.fulfill({ status: 403, contentType: "application/json",
          body: JSON.stringify({ error: "GitHub refused this action." }) });
      } else {
        const comment = { id: "new-comment", body, author: { login: "alice" }, createdAt: new Date().toISOString() };
        savedComments = [comment];
        await fulfillJson(route, { ok: true, comment });
      }
    });
    await page.goto(`${DASHBOARD_PATH}/issues?issue=1001`);
    await showProjectPaneIfNeeded(page);
    const draft = page.getByRole("textbox", { name: "Add a comment", exact: true });
    await draft.fill("An optimistic **update**");
    await page.getByRole("button", { name: "Comment", exact: true }).click();
    const posted = page.locator("article").filter({ hasText: "An optimistic update" });
    await expect(posted).toHaveCount(1);
    await expect(page.getByRole("heading", { name: "Comments 1", exact: true })).toBeVisible();
    await expect(posted.getByText("Posting…", { exact: true })).toBeVisible();
    await expect(draft).toHaveValue("");
    await draft.fill("Keep my next draft");
    await expect.poll(() => postedBodies.length).toBe(1);
    await page.screenshot({ path: testInfo.outputPath(`comment-sending-${viewport.name}.png`) });
    finishRequest();
    await expect(posted.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
    await page.getByRole("button", { name: "All issues", exact: true }).click();
    await page.getByRole("link", { name: /An issue beyond the first thousand/u }).click();
    await expect(posted.getByRole("button", { name: "Retry", exact: true })).toBeVisible();
    await expect(draft).toHaveValue("Keep my next draft");
    await page.screenshot({ path: testInfo.outputPath(`comment-retry-${viewport.name}.png`) });
    await posted.getByRole("button", { name: "Retry", exact: true }).click();
    await expect(posted.getByText("Posting…", { exact: true })).toBeVisible();
    await expect.poll(() => postedBodies.length).toBe(2);
    expect(postedBodies).toEqual(["An optimistic **update**", "An optimistic **update**"]);
    finishRequest();
    await expect(posted.getByText("alice", { exact: true })).toBeVisible();
    await expect(posted).toHaveCount(1);
    await expect(posted.getByRole("button", { name: "Retry", exact: true })).toHaveCount(0);
    await expect(draft).toHaveValue("Keep my next draft");
    await expectNoHorizontalOverflow(page);
  });

  test(`issue mention autocomplete preserves drafts and supports keyboard and pointer at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockGithubIssues(page);
    const mentionRequests: string[] = [];
    page.on("request", (request) => {
      if (new URL(request.url()).pathname.endsWith("/issue-mentions")) mentionRequests.push(request.url());
    });
    await page.goto(`${DASHBOARD_PATH}/issues?issue=1001`);
    await showProjectPaneIfNeeded(page);
    const comment = page.getByRole("textbox", { name: "Add a comment", exact: true });
    await expect(comment).toBeVisible();
    await expect.poll(() => mentionRequests.length).toBe(1);
    await comment.fill("Please ask @ta about this.");
    await comment.evaluate((element: HTMLTextAreaElement) => element.setSelectionRange(14, 14));
    await comment.press("ArrowLeft");
    await comment.press("ArrowRight");
    const tamia = page.getByRole("option", { name: /@tamiastewart123/u });
    await expect(tamia).toBeVisible();
    await expect(comment).toBeFocused();
    await expectNoHorizontalOverflow(page);
    await page.screenshot({ path: testInfo.outputPath(`mention-${viewport.name}.png`) });
    await comment.press("Enter");
    await expect(comment).toHaveValue("Please ask @tamiastewart123 about this.");
    await expect(comment).toBeFocused();
    expect(await comment.evaluate((element: HTMLTextAreaElement) => element.selectionStart)).toBe(28);
    await expect(tamia).not.toBeVisible();

    await comment.fill("Thanks @early");
    await page.getByRole("option", { name: /@early-commenter/u }).click();
    await expect(comment).toHaveValue("Thanks @early-commenter ");
    await comment.fill("Thanks @");
    await expect(page.getByRole("option")).toHaveCount(3);
    await comment.press("ArrowDown");
    await comment.press("Tab");
    await expect(comment).toHaveValue("Thanks @early-commenter ");
    await comment.fill("@TAM");
    await expect(tamia).toBeVisible();
    await comment.press("Escape");
    await expect(tamia).not.toBeVisible();
    await expect(comment).toHaveValue("@TAM");
    await comment.press("Enter");
    await expect(comment).toHaveValue("@TAM\n");
    await comment.fill("person@tamiastewart123.com");
    await expect(page.getByRole("listbox", { name: "Mention suggestions" })).not.toBeVisible();
    expect(mentionRequests).toHaveLength(1);

    await page.getByRole("button", { name: "All issues", exact: true }).click();
    await page.getByRole("link", { name: /An issue beyond the first thousand/u }).click();
    await expect(comment).toHaveValue("person@tamiastewart123.com");
    await comment.fill("@early");
    await expect(page.getByRole("option", { name: /@early-commenter/u })).toBeVisible();
    await comment.press("Escape");
    expect(mentionRequests).toHaveLength(1);

    await page.getByRole("button", { name: "New issue", exact: true }).click();
    const dialog = page.getByRole("dialog");
    const description = dialog.getByRole("textbox", { name: "Description", exact: true });
    await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toBeFocused();
    await description.fill("Please review @tam");
    await expect(tamia).toBeVisible();
    await tamia.click();
    await expect(description).toHaveValue("Please review @tamiastewart123 ");
    await expect(description).toBeFocused();
    await description.fill("@early");
    await expect(page.getByText("No matching people", { exact: true })).toBeVisible();
    await description.press("Escape");
    await expect(dialog).toBeVisible();
    await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
    await expectNoHorizontalOverflow(page);
  });
}

test("issue number search preserves bare and hash-prefixed numbers through navigation", async ({ page }) => {
  const requests = await mockGithubIssues(page);
  await page.goto(`${DASHBOARD_PATH}/issues`);
  const search = page.getByRole("textbox", { name: "Search issues", exact: true });
  await expect(search).toHaveAttribute("placeholder", "Number, title or description");
  for (const number of ["1001", "#1001"]) {
    await search.fill(number);
    await search.press("Enter");
    await expect.poll(() => requests.at(-1)?.searchParams.get("search")).toBe(number);
    await page.getByRole("link", { name: /An issue beyond the first thousand/u }).click();
    await expect(page.getByRole("heading", { name: issue.title, exact: true })).toBeVisible();
    await page.getByRole("button", { name: "All issues", exact: true }).click();
    await expect(search).toHaveValue(number);
  }
});

test("mention loading failure retains local authors and typing, and Retry restores suggestions", async ({ page }) => {
  await mockGithubIssues(page);
  let unavailable = true;
  await routeApiEndpoint(page, "/vibe64/issue-mentions", async (route) => {
    if (unavailable) await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ message: "Suggestions unavailable" }) });
    else await fulfillJson(route, { ok: true, users: [{ login: "tamiastewart123" }] });
  });
  await page.goto(`${DASHBOARD_PATH}/issues?issue=1001`);
  const comment = page.getByRole("textbox", { name: "Add a comment", exact: true });
  await comment.fill("Hello @");
  await expect(page.getByRole("option", { name: "@alice", exact: true })).toBeVisible();
  const retry = page.getByRole("button", { name: "Retry", exact: true });
  await expect(retry).toBeVisible();
  unavailable = false;
  await retry.click();
  await expect(page.getByRole("option", { name: /@tamiastewart123/u })).toBeVisible();
  await expect(comment).toHaveValue("Hello @");
  await comment.fill("Hello @t");
  await comment.press("Tab");
  await expect(comment).toHaveValue("Hello @tamiastewart123 ");
});

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

for (const viewport of viewports) {
  test(`edit issues and comments and reopen at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockGithubIssues(page);
    const comment = { id: "IC_edit", body: "Original comment", author: { login: "alice" }, createdAt: issue.createdAt, viewerCanUpdate: true };
    const current = { ...issue, state: "CLOSED", viewerCanUpdate: true,
      comments: { ...issue.comments, totalCount: 1, nodes: [comment] } };
    let issueAttempts = 0;
    let commentAttempts = 0;
    await routeApiEndpoint(page, "/vibe64/issues/1001", async (route) => {
      const request = route.request();
      if (request.method() === "PUT") {
        issueAttempts++;
        expect(request.postDataJSON()).toEqual({ title: "Revised issue", body: "Revised description" });
        if (issueAttempts === 1) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "GitHub refused this edit." }) });
        Object.assign(current, request.postDataJSON());
      } else if (request.method() === "PATCH") {
        expect(request.postDataJSON()).toEqual({ state: "open" });
        current.state = "OPEN";
      }
      await fulfillJson(route, { ok: true, issue: current });
    });
    await routeApiEndpoint(page, "/vibe64/issues/1001/comments/IC_edit", async (route) => {
      expect(route.request().method()).toBe("PATCH");
      expect(route.request().postDataJSON()).toEqual({ body: "Revised comment" });
      commentAttempts++;
      if (commentAttempts === 1) return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "GitHub refused this comment edit." }) });
      comment.body = "Revised comment";
      await fulfillJson(route, { ok: true, comment });
    });
    await page.goto(`${DASHBOARD_PATH}/issues?issue=1001`);
    await showProjectPaneIfNeeded(page);
    const panel = page.locator(".issues-panel");
    await expect(panel.getByRole("button", { name: "Edit labels", exact: true })).toHaveCount(0);
    await panel.getByRole("button", { name: "Edit issue", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await expect(dialog.getByRole("textbox", { name: "Title", exact: true })).toHaveValue(issue.title);
    await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue(issue.body);
    await dialog.getByRole("textbox", { name: "Title", exact: true }).fill("Revised issue");
    await dialog.getByRole("textbox", { name: "Description", exact: true }).fill("Revised description");
    await dialog.getByRole("button", { name: "Save issue", exact: true }).click();
    await expect(page.getByText("GitHub refused this edit.", { exact: true })).toBeVisible();
    await expect(dialog.getByRole("textbox", { name: "Description", exact: true })).toHaveValue("Revised description");
    await dialog.screenshot({ path: testInfo.outputPath(`issue-edit-${viewport.name}.png`) });
    await dialog.getByRole("button", { name: "Save issue", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    await expect(panel.getByRole("heading", { name: "Revised issue", exact: true })).toBeVisible();
    await expect(panel.getByText("Revised description", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Edit comment", exact: true }).click();
    const commentInput = panel.getByRole("textbox", { name: "Edit comment", exact: true });
    await expect(commentInput).toHaveValue("Original comment");
    await commentInput.fill("Revised comment");
    await panel.getByRole("button", { name: "Save comment", exact: true }).click();
    await expect(page.getByText("GitHub refused this comment edit.", { exact: true })).toBeVisible();
    await expect(commentInput).toHaveValue("Revised comment");
    await panel.getByRole("button", { name: "Save comment", exact: true }).click();
    await expect(commentInput).toHaveCount(0);
    await expect(panel.getByText("Revised comment", { exact: true })).toBeVisible();
    await panel.getByRole("button", { name: "Reopen issue", exact: true }).click();
    await expect(panel.getByRole("button", { name: "Close issue", exact: true })).toBeEnabled();
    expect(issueAttempts).toBe(2);
    expect(commentAttempts).toBe(2);
    await expectNoHorizontalOverflow(page);
    await panel.screenshot({ path: testInfo.outputPath(`issue-edited-${viewport.name}.png`) });
  });

  test(`bulk issue selector adds and removes labels and retries only failures at ${viewport.name}`, async ({ page }, testInfo) => {
    await page.setViewportSize(viewport);
    await mockGithubIssues(page);
    await routeApiEndpoint(page, "/vibe64/issue-labels", (route) => fulfillJson(route, {
      ok: true, labels, canEditLabels: true, canCreateWithLabels: true
    }));
    await routeApiEndpoint(page, "/vibe64/issues", (route) => fulfillJson(route, {
      ok: true, issues: [issue, { ...issue, number: 1002, title: "Second issue" }], total: 30,
      pageInfo: { hasNextPage: true, endCursor: "next" }
    }));
    const writes: { number: number; labelMode: string; labels: string[] }[] = [];
    let failSecond = true;
    for (const number of [1001, 1002]) {
      await routeApiEndpoint(page, `/vibe64/issues/${number}/labels`, async (route) => {
        expect(route.request().method()).toBe("PUT");
        writes.push({ number, ...route.request().postDataJSON() });
        if (number === 1002 && failSecond) {
          failSecond = false;
          return route.fulfill({ status: 403, contentType: "application/json", body: JSON.stringify({ error: "GitHub refused this label change." }) });
        }
        await fulfillJson(route, { ok: true, issue: { number } });
      });
    }
    await page.goto(`${DASHBOARD_PATH}/issues`);
    await showProjectPaneIfNeeded(page);
    const panel = page.locator(".issues-panel");
    const all = panel.getByRole("checkbox", { name: "Select all on this page", exact: true });
    const first = panel.getByRole("checkbox", { name: "Select issue #1001", exact: true });
    const second = panel.getByRole("checkbox", { name: "Select issue #1002", exact: true });
    await first.check();
    await expect(panel.getByText("1 selected", { exact: true })).toBeVisible();
    expect(new URL(page.url()).searchParams.has("issue")).toBe(false);
    await all.check();
    await expect(second).toBeChecked();
    await expect(panel.getByText("2 selected", { exact: true })).toBeVisible();
    await panel.screenshot({ path: testInfo.outputPath(`bulk-selector-${viewport.name}.png`) });
    await panel.getByRole("button", { name: "Bulk edit labels", exact: true }).click();
    const dialog = page.getByRole("dialog");
    await dialog.getByRole("combobox", { name: "Labels to change", exact: true }).fill("bug");
    await page.getByRole("option", { name: "bug", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Labels to change", exact: true }).press("Escape");
    await dialog.getByRole("button", { name: "Apply labels", exact: true }).click();
    await expect(dialog.getByText("#1002: GitHub refused this label change.", { exact: true })).toBeVisible();
    await expect(first).not.toBeChecked();
    await expect(second).toBeChecked();
    await dialog.screenshot({ path: testInfo.outputPath(`bulk-retry-${viewport.name}.png`) });
    await dialog.getByRole("button", { name: "Retry failed issues", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes).toEqual([
      { number: 1001, labelMode: "add", labels: ["bug"] },
      { number: 1002, labelMode: "add", labels: ["bug"] },
      { number: 1002, labelMode: "add", labels: ["bug"] }
    ]);
    await expect(panel.getByText("0 selected", { exact: true })).toBeVisible();
    await first.check();
    await panel.getByRole("button", { name: "Bulk edit labels", exact: true }).click();
    await dialog.getByRole("button", { name: "Remove labels", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Labels to change", exact: true }).fill("bug");
    await page.getByRole("option", { name: "bug", exact: true }).click();
    await dialog.getByRole("combobox", { name: "Labels to change", exact: true }).press("Escape");
    await dialog.getByRole("button", { name: "Apply labels", exact: true }).click();
    await expect(dialog).toHaveCount(0);
    expect(writes.at(-1)).toEqual({ number: 1001, labelMode: "remove", labels: ["bug"] });
    await all.check();
    await panel.getByRole("button", { name: "Clear selection", exact: true }).click();
    await expect(first).not.toBeChecked();
    await expect(second).not.toBeChecked();
    await all.check();
    await panel.getByRole("button", { name: "Next page", exact: true }).click();
    await expect(panel.getByText("0 selected", { exact: true })).toBeVisible();
    await all.check();
    await panel.getByRole("button", { name: "Closed", exact: true }).click();
    await expect(panel.getByText("0 selected", { exact: true })).toBeVisible();
    await expectNoHorizontalOverflow(page);
  });
}
