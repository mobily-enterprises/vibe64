import { expect, test } from "@playwright/test";
import process from "node:process";

import {
  LIVE_E2E_FLAG,
  UI_COMMAND_TIMEOUT_MS,
  addCleanupTask,
  assertGithubCliReady,
  closeGithubIssue,
  closeGithubPr,
  createFixtureIssue,
  createFixturePullRequest,
  deleteRemoteBranch,
  fixtureTitle,
  ghJson,
  liveE2eEnabled,
  prepareTargetRoot,
  removeGeneratedSessionState,
  runCleanupTasks,
  runId,
  setLiveBaseUrl,
  startStudioServer,
  stringValue,
  type StudioServer
} from "./live/support/environment";
import {
  assertChecklistControls,
  awaitSessions,
  chooseExistingPr,
  chooseNewBranch,
  clickButton,
  createNewBranchSessionAtIssueStep,
  createSession,
  expectButtonDisabled,
  expectButtonEnabled,
  expectButtonHidden,
  expectSessionMetadata,
  expectSessionMetadataContains,
  goNextToStep,
  latestSession,
  markMetadata,
  markMetadataAndReload,
  reviewDiff,
  runCommandAndWaitForMetadata,
  submitCurrentStepInput,
  useExistingIssue,
  writeIssueArtifacts,
  writePullRequestArtifact,
  writeReportArtifact,
  writeWorktreeFile,
  type Vibe64Session
} from "./live/support/workflow";

let studioServer: StudioServer | null = null;

test.describe("live Vibe64 session workflow", () => {
  test.describe.configure({
    mode: "serial"
  });
  test.setTimeout(20 * 60_000);

  test.skip(!liveE2eEnabled, `Set ${LIVE_E2E_FLAG}=1 to run live Vibe64 e2e tests.`);

  test.beforeAll(async () => {
    await prepareTargetRoot();
    await assertGithubCliReady();
    studioServer = await startStudioServer();
    setLiveBaseUrl(studioServer.baseUrl);
  });

  test.afterAll(async () => {
    await runCleanupTasks();
    await studioServer?.stop();
    await removeGeneratedSessionState();
  });

  test.beforeEach(async ({ page }) => {
    await removeGeneratedSessionState();
    await page.context().clearCookies();
  });

  test.afterEach(async () => {
    await removeGeneratedSessionState();
  });

  test("starts a new session, chooses a new branch, creates a worktree, and installs dependencies", async ({ page }) => {
    await createSession(page);
    await chooseNewBranch(page);
    await goNextToStep(page, "worktree_created");
    await runCommandAndWaitForMetadata(page, "Create worktree", "worktree_path");
    await expectButtonEnabled(page, "Next step");

    await goNextToStep(page, "dependencies_installed");
    await runCommandAndWaitForMetadata(page, "Install dependencies", "dependencies_installed", UI_COMMAND_TIMEOUT_MS);
    await expectButtonEnabled(page, "Next step");

    await goNextToStep(page, "issue_file_created");
    await expect(page.getByLabel("Issue title")).toBeVisible();
    await expect(page.getByLabel("Session label")).toBeVisible();
    await expect(page.getByLabel("Issue body")).toBeVisible();
    await expectButtonDisabled(page, "Save issue");
    await expectButtonEnabled(page, "Solve existing issue");
    await expectButtonDisabled(page, "Next step");
  });

  test("saves issue step input and enables the next step", async ({ page }) => {
    await createNewBranchSessionAtIssueStep(page);
    await submitCurrentStepInput(page, {
      body: `Define a tiny issue for ${runId}.`,
      title: fixtureTitle("step-input-issue"),
      word: "Step input"
    });
    await page.reload({
      waitUntil: "networkidle"
    });

    await expectButtonEnabled(page, "Next step");
  });

  test("shows the expected controls at each checklist step", async ({ page }) => {
    const issue = await createFixtureIssue("checklist-contract-issue");

    await createNewBranchSessionAtIssueStep(page);
    await assertChecklistControls(page, "issue_file_created", {
      disabled: ["Save issue", "Next step"],
      enabled: ["Solve existing issue"],
      hidden: []
    });

    await useExistingIssue(page, issue.url);
    await assertChecklistControls(page, "issue_file_created", {
      disabled: ["Save issue", "Solve existing issue"],
      enabled: ["Next step"]
    });

    await goNextToStep(page, "issue_submitted");
    await assertChecklistControls(page, "issue_submitted", {
      disabled: ["Create issue on GH"],
      enabled: ["Next step"]
    });

    await goNextToStep(page, "plan_made");
    await assertChecklistControls(page, "plan_made", {
      enabled: ["Make a plan for the issue", "Next step"]
    });

    await goNextToStep(page, "plan_executed");
    await assertChecklistControls(page, "plan_executed", {
      enabled: ["Execute plan", "Next step"]
    });

    await goNextToStep(page, "implementation_reviewed");
    await assertChecklistControls(page, "implementation_reviewed", {
      disabled: ["Edit AI response", "Open app"],
      enabled: ["Review diff", "Run app", "Ask AI for tweaks", "Next step"]
    });

    await goNextToStep(page, "deep_ui_check_run");
    await assertChecklistControls(page, "deep_ui_check_run", {
      enabled: ["Run deep UI check", "Next step"]
    });

    await goNextToStep(page, "review_run");
    await assertChecklistControls(page, "review_run", {
      enabled: ["Run deslop", "Next step"]
    });

    await goNextToStep(page, "project_validated");
    await assertChecklistControls(page, "project_validated", {
      disabled: ["Run automated checks", "Next step"],
      enabled: ["Update code index"]
    });

    await markMetadataAndReload(page, "code_index_updated", "yes");
    await assertChecklistControls(page, "project_validated", {
      disabled: ["Next step"],
      enabled: ["Update code index", "Run automated checks"]
    });
    await markMetadataAndReload(page, "automated_checks_passed", "yes");
    await assertChecklistControls(page, "project_validated", {
      enabled: ["Update code index", "Run automated checks", "Next step"]
    });

    await goNextToStep(page, "changes_accepted");
    await assertChecklistControls(page, "changes_accepted", {
      disabled: ["Edit report", "Open app"],
      enabled: ["Review diff", "Run app", "Next step"]
    });

    await goNextToStep(page, "report_created");
    await assertChecklistControls(page, "report_created", {
      disabled: ["Edit report", "Next step"],
      enabled: ["Write report"]
    });
    await writeReportArtifact(page, `# Report\n\nChecklist report for ${runId}.\n`);
    await assertChecklistControls(page, "report_created", {
      enabled: ["Edit report", "Write report", "Next step"]
    });

    await goNextToStep(page, "project_knowledge_updated");
    await assertChecklistControls(page, "project_knowledge_updated", {
      enabled: ["Update project knowledge", "Next step"]
    });

    await goNextToStep(page, "changes_committed");
    await assertChecklistControls(page, "changes_committed", {
      disabled: ["Next step"],
      enabled: ["Commit and push changes"]
    });

    await markMetadataAndReload(page, "accepted_commit", "0000000000000000000000000000000000000000");
    await markMetadataAndReload(page, "branch_pushed", "vibe64/live-e2e-checklist");
    await assertChecklistControls(page, "changes_committed", {
      enabled: ["Commit and push changes", "Next step"]
    });

    await goNextToStep(page, "create_pull_request");
    await assertChecklistControls(page, "create_pull_request", {
      disabled: ["Create PR on GH", "Next step"],
      enabled: ["Draft PR"]
    });

    await writePullRequestArtifact(page, `# ${fixtureTitle("checklist-pr")}\n\nChecklist contract draft.\n`);
    await assertChecklistControls(page, "create_pull_request", {
      disabled: ["Draft PR", "Open PR", "Next step"],
      enabled: ["Create PR on GH", "Update PR"]
    });

    await markMetadataAndReload(page, "pr_url", "https://github.com/mercmobily/studio-ai-e2e-repo/pull/999999");
    await markMetadataAndReload(page, "pr_source", "created");
    await assertChecklistControls(page, "create_pull_request", {
      disabled: ["Create PR on GH", "Draft PR"],
      enabled: ["Open PR", "Next step"]
    });

    await goNextToStep(page, "pr_merged");
    await assertChecklistControls(page, "pr_merged", {
      disabled: ["Next step"],
      enabled: ["Prepare for merge", "Merge", "Do not merge"]
    });

    await markMetadataAndReload(page, "pr_merged", "yes");
    await assertChecklistControls(page, "pr_merged", {
      enabled: ["Next step"]
    });

    await goNextToStep(page, "main_checkout_synced");
    await assertChecklistControls(page, "main_checkout_synced", {
      disabled: ["Next step"],
      enabled: ["Sync main checkout"]
    });

    await markMetadataAndReload(page, "main_checkout_synced", "yes");
    await assertChecklistControls(page, "main_checkout_synced", {
      enabled: ["Next step"]
    });

    await goNextToStep(page, "session_finished");
    await assertChecklistControls(page, "session_finished", {
      enabled: ["Archive"],
      hidden: ["Next step"]
    });
  });

  test("selects an existing issue and disables issue-creation actions", async ({ page }) => {
    const issue = await createFixtureIssue("existing-issue");

    await createNewBranchSessionAtIssueStep(page);
    await useExistingIssue(page, issue.url);

    const session = await expectSessionMetadata(page, "issue_url", issue.url);
    expect(session.metadata?.issue_source).toBe("existing");
    expect(session.metadata?.issue_number).toBe(issue.number);

    await expectButtonDisabled(page, "Save issue");
    await expectButtonDisabled(page, "Solve existing issue");
    await expectButtonEnabled(page, "Next step");

    await goNextToStep(page, "issue_submitted");
    await expectButtonDisabled(page, "Create issue on GH");
    await expectButtonEnabled(page, "Next step");
  });

  test("creates and edits a new issue draft, then creates the GitHub issue", async ({ page }) => {
    await createNewBranchSessionAtIssueStep(page);
    await writeIssueArtifacts(page, {
      body: `Created by ${runId} through the live Vibe64 issue flow.`,
      title: fixtureTitle("new-issue")
    });

    await expectButtonEnabled(page, "Next step");
    await goNextToStep(page, "issue_submitted");
    await runCommandAndWaitForMetadata(page, "Create issue on GH", "issue_url", UI_COMMAND_TIMEOUT_MS);

    const session = await latestSession(page);
    const issueUrl = stringValue(session.metadata?.issue_url);
    expect(issueUrl).toContain("/issues/");
    expect(session.metadata?.issue_source).toBe("created");
    addCleanupTask(async () => closeGithubIssue(issueUrl));
    await expectButtonEnabled(page, "Next step");
  });

  test("runs the full new-branch path through PR creation, merge, sync, and finish", async ({ page }) => {
    const issue = await createFixtureIssue("new-pr-source-issue");

    await createNewBranchSessionAtIssueStep(page);
    await useExistingIssue(page, issue.url);
    await goNextToStep(page, "issue_submitted");
    await goNextToStep(page, "plan_made");
    await goNextToStep(page, "plan_executed");
    await goNextToStep(page, "implementation_reviewed");
    await goNextToStep(page, "deep_ui_check_run");
    await goNextToStep(page, "review_run");
    await goNextToStep(page, "project_validated");

    await writeWorktreeFile(page, `e2e-fixtures/${runId}-new-pr.txt`, `New PR path ${runId}\n`);
    await runCommandAndWaitForMetadata(page, "Update code index", "code_index_updated", UI_COMMAND_TIMEOUT_MS);
    await runCommandAndWaitForMetadata(page, "Run automated checks", "automated_checks_passed", UI_COMMAND_TIMEOUT_MS);
    await goNextToStep(page, "changes_accepted");
    await reviewDiff(page, `${runId}-new-pr.txt`);
    await goNextToStep(page, "report_created");
    await writeReportArtifact(page, `# Report\n\nNew PR path ${runId}.\n`);
    await goNextToStep(page, "project_knowledge_updated");
    await goNextToStep(page, "changes_committed");
    await runCommandAndWaitForMetadata(page, "Commit and push changes", "accepted_commit", UI_COMMAND_TIMEOUT_MS);

    const committedSession = await latestSession(page);
    const pushedBranch = stringValue(committedSession.metadata?.branch_pushed);
    if (pushedBranch) {
      addCleanupTask(async () => deleteRemoteBranch(pushedBranch));
    }

    await goNextToStep(page, "create_pull_request");
    await writePullRequestArtifact(page, `# ${fixtureTitle("new-pr")}\n\nCreated by ${runId}.\n`);
    await runCommandAndWaitForMetadata(page, "Create PR on GH", "pr_url", UI_COMMAND_TIMEOUT_MS);

    const prSession = await latestSession(page);
    const prUrl = stringValue(prSession.metadata?.pr_url);
    expect(prUrl).toContain("/pull/");
    addCleanupTask(async () => closeGithubPr(prUrl));

    await goNextToStep(page, "pr_merged");
    await expectButtonEnabled(page, "Prepare for merge");
    await expectButtonEnabled(page, "Merge");
    await runCommandAndWaitForMetadata(page, "Merge", "pr_merged", UI_COMMAND_TIMEOUT_MS);

    await goNextToStep(page, "main_checkout_synced");
    await runCommandAndWaitForMetadata(page, "Sync main checkout", "main_checkout_synced", UI_COMMAND_TIMEOUT_MS);

    await goNextToStep(page, "session_finished");
    await clickButton(page, "Archive");
    await expect.poll(async () => (await latestSession(page)).status, {
      timeout: 30_000
    }).toBe("finished");
  });

  test("opens an existing PR and creates a stacked pull request from it", async ({ page }) => {
    const pullRequest = await createFixturePullRequest("stacked-existing-pr");

    await createSession(page);
    await chooseExistingPr(page, pullRequest.url);
    await goNextToStep(page, "worktree_created");
    await runCommandAndWaitForMetadata(page, "Create worktree", "worktree_path", UI_COMMAND_TIMEOUT_MS);

    const worktreeSession = await expectSessionMetadata(page, "source_pr_update_mode", "stacked");
    expect(worktreeSession.metadata?.source_pr_url).toBe(pullRequest.url);
    expect(worktreeSession.metadata?.source_pr_head_ref).toBe(pullRequest.branch);
    expect(stringValue(worktreeSession.metadata?.pr_url)).toBe("");

    await goNextToStep(page, "dependencies_installed");
    await runCommandAndWaitForMetadata(page, "Install dependencies", "dependencies_installed", UI_COMMAND_TIMEOUT_MS);
    await goNextToStep(page, "plan_made");
    await goNextToStep(page, "plan_executed");
    await goNextToStep(page, "implementation_reviewed");
    await goNextToStep(page, "deep_ui_check_run");
    await goNextToStep(page, "review_run");
    await goNextToStep(page, "project_validated");
    await markMetadata(page, "code_index_updated", "yes");
    await markMetadata(page, "automated_checks_passed", "yes");
    await page.reload({
      waitUntil: "networkidle"
    });
    await goNextToStep(page, "changes_accepted");
    await writeWorktreeFile(page, `e2e-fixtures/${runId}-existing-stacked-pr.txt`, `Existing stacked PR path ${runId}\n`);
    await goNextToStep(page, "report_created");
    await writeReportArtifact(page, `# Report\n\nExisting PR path ${runId}.\n`);
    await goNextToStep(page, "project_knowledge_updated");
    await goNextToStep(page, "changes_committed");
    await runCommandAndWaitForMetadata(page, "Commit and push changes", "accepted_commit", UI_COMMAND_TIMEOUT_MS);

    const committedSession = await latestSession(page);
    const pushedBranch = stringValue(committedSession.metadata?.branch_pushed);
    if (pushedBranch) {
      addCleanupTask(async () => deleteRemoteBranch(pushedBranch));
    }

    await goNextToStep(page, "create_pull_request");
    await writePullRequestArtifact(page, `# ${fixtureTitle("stacked-pr")}\n\nStacked on ${pullRequest.url}.\n`);
    await runCommandAndWaitForMetadata(page, "Create PR on GH", "pr_url", UI_COMMAND_TIMEOUT_MS);

    const stackedSession = await latestSession(page);
    const stackedPrUrl = stringValue(stackedSession.metadata?.pr_url);
    expect(stackedPrUrl).toContain("/pull/");
    expect(stackedPrUrl).not.toBe(pullRequest.url);
    expect(stackedSession.metadata?.pr_source).toBe("stacked");
    addCleanupTask(async () => closeGithubPr(stackedPrUrl));

    const stackedPullRequest = await ghJson([
      "pr",
      "view",
      stackedPrUrl,
      "--json",
      "baseRefName,body,url"
    ]);
    expect(stackedPullRequest.url).toBe(stackedPrUrl);
    expect(stackedPullRequest.baseRefName).toBe(pullRequest.branch);
    expect(stringValue(stackedPullRequest.body)).toContain(pullRequest.url);
  });

  test("rejects a cross-repo existing PR when configured", async ({ page }) => {
    const replacementPrRef = stringValue(process.env.VIBE64_E2E_REPLACEMENT_PR_REF);
    test.skip(!replacementPrRef, "Set VIBE64_E2E_REPLACEMENT_PR_REF to exercise a cross-repo PR rejection.");

    await createSession(page);
    await clickButton(page, "Use existing PR");
    const dialog = page.getByRole("dialog");
    await expect(dialog).toBeVisible();
    await dialog.getByLabel("PR URL or number").fill(replacementPrRef);
    await dialog.getByRole("button", {
      exact: true,
      name: "Continue"
    }).click();
    await expect(page.getByText("cannot be used as a stacked PR base because its head branch is not in this repository").first()).toBeVisible({
      timeout: 60_000
    });
    await expectSessionMetadata(page, "work_source", "");
    await expectButtonDisabled(page, "Next step");
  });

  test("requires confirmation before abandoning a session", async ({ page }) => {
    await createSession(page);
    await clickButton(page, "Abandon session");
    await expect(page.getByRole("dialog").getByText("Abandon session?")).toBeVisible();

    await page.getByRole("button", {
      exact: true,
      name: "Cancel"
    }).click();
    await expect(page.getByRole("dialog")).toHaveCount(0);
    expect((await awaitSessions(page)).sessions.filter((session: Vibe64Session) => session.status === "active")).toHaveLength(1);

    await clickButton(page, "Abandon session");
    await page.getByRole("button", {
      exact: true,
      name: "Abandon session"
    }).last().click();
    await expect.poll(async () => {
      const payload = await awaitSessions(page);
      return payload.sessions.filter((session: Vibe64Session) => session.status === "active").length;
    }, {
      timeout: 30_000
    }).toBe(0);
  });
});
