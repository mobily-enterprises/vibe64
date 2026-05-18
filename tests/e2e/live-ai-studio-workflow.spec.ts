import { expect, test, type Page } from "@playwright/test";
import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

const LIVE_E2E_FLAG = "AI_STUDIO_LIVE_E2E";
const TARGET_ROOT_ENV = "AI_STUDIO_E2E_TARGET_ROOT";
const EXPECTED_TARGET_REPO_NAME = "studio-ai-e2e-repo";
const COMMAND_TIMEOUT_MS = 120_000;
const SERVER_START_TIMEOUT_MS = 45_000;
const UI_COMMAND_TIMEOUT_MS = 240_000;

const appRoot = process.cwd();
const configuredTargetRoot = String(process.env[TARGET_ROOT_ENV] || "").trim();
const targetRoot = configuredTargetRoot ? path.resolve(configuredTargetRoot) : "";
const runId = `live-e2e-${Date.now()}-${process.pid}`;
const liveE2eEnabled = process.env[LIVE_E2E_FLAG] === "1";

let studioServer: StudioServer | null = null;
let baseUrl = "";
const cleanupTasks: Array<() => Promise<void>> = [];

type StudioServer = {
  baseUrl: string;
  logs: () => string;
  stop: () => Promise<void>;
};

type AiStudioSession = {
  actionResults?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  artifactReadiness?: Record<string, { nonEmpty?: boolean }>;
  artifactsRoot: string;
  currentStep: string;
  metadata?: Record<string, string>;
  metadataRoot: string;
  sessionId: string;
  status: string;
};

type FixtureIssue = {
  number: string;
  title: string;
  url: string;
};

type FixturePullRequest = {
  branch: string;
  title: string;
  url: string;
};

test.describe("live AI Studio session workflow", () => {
  test.describe.configure({
    mode: "serial"
  });
  test.setTimeout(20 * 60_000);

  test.skip(!liveE2eEnabled, `Set ${LIVE_E2E_FLAG}=1 to run live AI Studio e2e tests.`);

  test.beforeAll(async () => {
    await prepareTargetRoot();
    await assertGithubCliReady();
    studioServer = await startStudioServer();
    baseUrl = studioServer.baseUrl;
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
    await expectButtonEnabled(page, "Next");

    await goNextToStep(page, "dependencies_installed");
    await runCommandAndWaitForMetadata(page, "Install dependencies", "dependencies_installed", UI_COMMAND_TIMEOUT_MS);
    await expectButtonEnabled(page, "Next");

    await goNextToStep(page, "issue_file_created");
    await expect(page.getByLabel("Issue request")).toBeVisible();
    await expectButtonEnabled(page, "Use existing issue");
    await expectButtonHidden(page, "Create issue file");
    await expectButtonHidden(page, "Next");
  });

  test("switches from issue request form to create-file controls after the issue prompt is recorded", async ({ page }) => {
    await createNewBranchSessionAtIssueStep(page);
    await expect(page.getByLabel("Issue request")).toBeVisible();
    await expectButtonEnabled(page, "Use existing issue");
    await expectButtonHidden(page, "Create issue file");
    await expectButtonHidden(page, "Next");

    await recordIssuePromptRequest(page, `Define a tiny issue for ${runId}.`);

    await expect(page.getByLabel("Issue request")).toHaveCount(0);
    await expectButtonEnabled(page, "Create issue file");
    await expectButtonEnabled(page, "Use existing issue");
    await expectButtonDisabled(page, "Next");
  });

  test("shows the expected controls at each checklist step", async ({ page }) => {
    const issue = await createFixtureIssue("checklist-contract-issue");

    await createNewBranchSessionAtIssueStep(page);
    await assertChecklistControls(page, "issue_file_created", {
      enabled: ["Use existing issue"],
      hidden: ["Create issue file", "Next"]
    });

    await useExistingIssue(page, issue.url);
    await assertChecklistControls(page, "issue_file_created", {
      disabled: ["Send prompt", "Create issue file", "Use existing issue"],
      enabled: ["Next"]
    });

    await goNextToStep(page, "issue_submitted");
    await assertChecklistControls(page, "issue_submitted", {
      disabled: ["Edit issue", "Create issue on GH"],
      enabled: ["Next"]
    });

    await goNextToStep(page, "plan_made");
    await assertChecklistControls(page, "plan_made", {
      enabled: ["Make plan", "Next"]
    });

    await goNextToStep(page, "plan_executed");
    await assertChecklistControls(page, "plan_executed", {
      enabled: ["Execute plan", "Next"]
    });

    await goNextToStep(page, "deep_ui_check_run");
    await assertChecklistControls(page, "deep_ui_check_run", {
      enabled: ["Run deep UI check", "Next"]
    });

    await goNextToStep(page, "review_run");
    await assertChecklistControls(page, "review_run", {
      enabled: ["Run deslop", "Resolve deslop", "Next"]
    });

    await goNextToStep(page, "automated_checks_run");
    await assertChecklistControls(page, "automated_checks_run", {
      disabled: ["Next"],
      enabled: ["Run automated checks"]
    });

    await markMetadataAndReload(page, "automated_checks_passed", "yes");
    await assertChecklistControls(page, "automated_checks_run", {
      enabled: ["Run automated checks", "Next"]
    });

    await goNextToStep(page, "changes_accepted");
    await assertChecklistControls(page, "changes_accepted", {
      disabled: ["Open app"],
      enabled: ["Review diff", "Run app", "Next"]
    });

    await goNextToStep(page, "project_knowledge_updated");
    await assertChecklistControls(page, "project_knowledge_updated", {
      enabled: ["Update project knowledge", "Next"]
    });

    await goNextToStep(page, "changes_committed");
    await assertChecklistControls(page, "changes_committed", {
      disabled: ["Next"],
      enabled: ["Commit and push changes"]
    });

    await markMetadataAndReload(page, "accepted_commit", "0000000000000000000000000000000000000000");
    await markMetadataAndReload(page, "branch_pushed", "ai-studio/live-e2e-checklist");
    await assertChecklistControls(page, "changes_committed", {
      enabled: ["Commit and push changes", "Next"]
    });

    await goNextToStep(page, "pr_file_created");
    await assertChecklistControls(page, "pr_file_created", {
      disabled: ["Next"],
      enabled: ["Create PR file"]
    });

    await writePullRequestArtifact(page, `# ${fixtureTitle("checklist-pr")}\n\nChecklist contract draft.\n`);
    await assertChecklistControls(page, "pr_file_created", {
      enabled: ["Create PR file", "Next"]
    });

    await goNextToStep(page, "pr_created");
    await assertChecklistControls(page, "pr_created", {
      disabled: ["Open PR", "Next"],
      enabled: ["Edit PR", "Create PR on GH"]
    });

    await markMetadataAndReload(page, "pr_url", "https://github.com/mercmobily/studio-ai-e2e-repo/pull/999999");
    await markMetadataAndReload(page, "pr_source", "created");
    await assertChecklistControls(page, "pr_created", {
      disabled: ["Edit PR", "Create PR on GH"],
      enabled: ["Open PR", "Next"]
    });

    await goNextToStep(page, "pr_merged");
    await assertChecklistControls(page, "pr_merged", {
      enabled: ["Prepare for merge", "Merge", "Next"]
    });

    await goNextToStep(page, "main_checkout_synced");
    await assertChecklistControls(page, "main_checkout_synced", {
      disabled: ["Sync main checkout"],
      enabled: ["Next"]
    });

    await markMetadataAndReload(page, "pr_merged", "yes");
    await assertChecklistControls(page, "main_checkout_synced", {
      enabled: ["Sync main checkout", "Next"]
    });

    await goNextToStep(page, "session_finished");
    await assertChecklistControls(page, "session_finished", {
      enabled: ["Finish"],
      hidden: ["Next"]
    });
  });

  test("selects an existing issue and disables issue-creation actions", async ({ page }) => {
    const issue = await createFixtureIssue("existing-issue");

    await createNewBranchSessionAtIssueStep(page);
    await useExistingIssue(page, issue.url);

    const session = await expectSessionMetadata(page, "issue_url", issue.url);
    expect(session.metadata?.issue_source).toBe("existing");
    expect(session.metadata?.issue_number).toBe(issue.number);

    await expectButtonDisabled(page, "Send prompt");
    await expectButtonDisabled(page, "Create issue file");
    await expectButtonDisabled(page, "Use existing issue");
    await expectButtonEnabled(page, "Next");

    await goNextToStep(page, "issue_submitted");
    await expectButtonDisabled(page, "Edit issue");
    await expectButtonDisabled(page, "Create issue on GH");
    await expectButtonEnabled(page, "Next");
  });

  test("creates and edits a new issue draft, then creates the GitHub issue", async ({ page }) => {
    await createNewBranchSessionAtIssueStep(page);
    await writeIssueArtifacts(page, {
      body: `Created by ${runId} through the live AI Studio issue flow.`,
      title: fixtureTitle("new-issue")
    });

    await expectButtonEnabled(page, "Next");
    await goNextToStep(page, "issue_submitted");
    await editIssueDraft(page, {
      body: `Edited body from ${runId}.`,
      title: fixtureTitle("new-issue-edited")
    });
    await runCommandAndWaitForMetadata(page, "Create issue on GH", "issue_url", UI_COMMAND_TIMEOUT_MS);

    const session = await latestSession(page);
    const issueUrl = stringValue(session.metadata?.issue_url);
    expect(issueUrl).toContain("/issues/");
    expect(session.metadata?.issue_source).toBe("created");
    cleanupTasks.push(async () => closeGithubIssue(issueUrl));
    await expectButtonEnabled(page, "Next");
  });

  test("runs the full new-branch path through PR creation, merge, sync, and finish", async ({ page }) => {
    const issue = await createFixtureIssue("new-pr-source-issue");

    await createNewBranchSessionAtIssueStep(page);
    await useExistingIssue(page, issue.url);
    await goNextToStep(page, "issue_submitted");
    await goNextToStep(page, "plan_made");
    await goNextToStep(page, "plan_executed");
    await goNextToStep(page, "deep_ui_check_run");
    await goNextToStep(page, "review_run");
    await goNextToStep(page, "automated_checks_run");

    await writeWorktreeFile(page, `e2e-fixtures/${runId}-new-pr.txt`, `New PR path ${runId}\n`);
    await runCommandAndWaitForMetadata(page, "Run automated checks", "automated_checks_passed", UI_COMMAND_TIMEOUT_MS);
    await goNextToStep(page, "changes_accepted");
    await reviewDiff(page, `${runId}-new-pr.txt`);
    await goNextToStep(page, "project_knowledge_updated");
    await goNextToStep(page, "changes_committed");
    await runCommandAndWaitForMetadata(page, "Commit and push changes", "accepted_commit", UI_COMMAND_TIMEOUT_MS);

    const committedSession = await latestSession(page);
    const pushedBranch = stringValue(committedSession.metadata?.branch_pushed);
    if (pushedBranch) {
      cleanupTasks.push(async () => deleteRemoteBranch(pushedBranch));
    }

    await goNextToStep(page, "pr_file_created");
    await writePullRequestArtifact(page, `# ${fixtureTitle("new-pr")}\n\nCreated by ${runId}.\n`);
    await expectButtonEnabled(page, "Next");
    await goNextToStep(page, "pr_created");
    await editPullRequestDraft(page, `# ${fixtureTitle("new-pr-edited")}\n\nEdited by the live e2e suite.\n`);
    await runCommandAndWaitForMetadata(page, "Create PR on GH", "pr_url", UI_COMMAND_TIMEOUT_MS);

    const prSession = await latestSession(page);
    const prUrl = stringValue(prSession.metadata?.pr_url);
    expect(prUrl).toContain("/pull/");
    cleanupTasks.push(async () => closeGithubPr(prUrl));

    await goNextToStep(page, "pr_merged");
    await expectButtonEnabled(page, "Prepare for merge");
    await expectButtonEnabled(page, "Merge");
    await runCommandAndWaitForMetadata(page, "Merge", "pr_merged", UI_COMMAND_TIMEOUT_MS);

    await goNextToStep(page, "main_checkout_synced");
    await runCommandAndWaitForMetadata(page, "Sync main checkout", "main_checkout_synced", UI_COMMAND_TIMEOUT_MS);

    await goNextToStep(page, "session_finished");
    await clickButton(page, "Finish");
    await expect.poll(async () => (await latestSession(page)).status, {
      timeout: 30_000
    }).toBe("finished");
  });

  test("opens an existing PR and follows the detected update mode", async ({ page }) => {
    const issue = await createFixtureIssue("existing-pr-source-issue");
    const pullRequest = await createFixturePullRequest("direct-existing-pr");

    await createSession(page);
    await chooseExistingPr(page, pullRequest.url);
    await goNextToStep(page, "worktree_created");
    await runCommandAndWaitForMetadata(page, "Create worktree", "worktree_path", UI_COMMAND_TIMEOUT_MS);

    const worktreeSession = await expectSessionMetadataContains(page, "source_pr_update_mode", "");
    const updateMode = stringValue(worktreeSession.metadata?.source_pr_update_mode);
    expect(["direct", "replacement"]).toContain(updateMode);
    if (updateMode === "direct") {
      expect(worktreeSession.metadata?.pr_url).toBe(pullRequest.url);
      expect(worktreeSession.metadata?.pr_source).toBe("existing");
    } else {
      expect(stringValue(worktreeSession.metadata?.pr_url)).toBe("");
    }

    await goNextToStep(page, "dependencies_installed");
    await runCommandAndWaitForMetadata(page, "Install dependencies", "dependencies_installed", UI_COMMAND_TIMEOUT_MS);
    await goNextToStep(page, "issue_file_created");
    await useExistingIssue(page, issue.url);
    await goNextToStep(page, "issue_submitted");
    await goNextToStep(page, "plan_made");
    await goNextToStep(page, "plan_executed");
    await goNextToStep(page, "deep_ui_check_run");
    await goNextToStep(page, "review_run");
    await goNextToStep(page, "automated_checks_run");
    await markMetadata(page, "automated_checks_passed", "yes");
    await page.reload({
      waitUntil: "networkidle"
    });
    await goNextToStep(page, "changes_accepted");
    await writeWorktreeFile(page, `e2e-fixtures/${runId}-existing-direct-pr.txt`, `Existing direct PR path ${runId}\n`);
    await goNextToStep(page, "project_knowledge_updated");
    await goNextToStep(page, "changes_committed");
    await runCommandAndWaitForMetadata(page, "Commit and push changes", "accepted_commit", UI_COMMAND_TIMEOUT_MS);

    const committedSession = await latestSession(page);
    const pushedBranch = stringValue(committedSession.metadata?.branch_pushed);
    if (updateMode === "replacement" && pushedBranch) {
      cleanupTasks.push(async () => deleteRemoteBranch(pushedBranch));
    }

    await goNextToStep(page, "pr_file_created");
    if (updateMode === "direct") {
      await expectButtonDisabled(page, "Create PR file");
      await expectButtonEnabled(page, "Next");
      await goNextToStep(page, "pr_created");
      await expectButtonEnabled(page, "Open PR");
      await expectButtonDisabled(page, "Edit PR");
      await expectButtonDisabled(page, "Create PR on GH");
      await expectButtonEnabled(page, "Next");

      const updatedPr = await ghJson([
        "pr",
        "view",
        pullRequest.url,
        "--json",
        "commits,url"
      ]);
      expect(updatedPr.url).toBe(pullRequest.url);
      expect(Array.isArray(updatedPr.commits) ? updatedPr.commits.length : 0).toBeGreaterThan(1);
      return;
    }

    await writePullRequestArtifact(page, `# ${fixtureTitle("replacement-pr")}\n\nReplacement for ${pullRequest.url}.\n`);
    await expectButtonEnabled(page, "Next");
    await goNextToStep(page, "pr_created");
    await runCommandAndWaitForMetadata(page, "Create PR on GH", "pr_url", UI_COMMAND_TIMEOUT_MS);

    const replacementSession = await latestSession(page);
    const replacementPrUrl = stringValue(replacementSession.metadata?.pr_url);
    expect(replacementPrUrl).toContain("/pull/");
    expect(replacementPrUrl).not.toBe(pullRequest.url);
    expect(replacementSession.metadata?.pr_source).toBe("replacement");
    cleanupTasks.push(async () => closeGithubPr(replacementPrUrl));
  });

  test("marks an unpushable existing PR as a replacement-PR workflow when configured", async ({ page }) => {
    const replacementPrRef = stringValue(process.env.AI_STUDIO_E2E_REPLACEMENT_PR_REF);
    test.skip(!replacementPrRef, "Set AI_STUDIO_E2E_REPLACEMENT_PR_REF to exercise a cross-repo replacement PR.");

    await createSession(page);
    await chooseExistingPr(page, replacementPrRef);
    await goNextToStep(page, "worktree_created");
    await runCommandAndWaitForMetadata(page, "Create worktree", "worktree_path", UI_COMMAND_TIMEOUT_MS);

    const session = await expectSessionMetadata(page, "source_pr_update_mode", "replacement");
    expect(stringValue(session.metadata?.pr_url)).toBe("");
    await expectButtonEnabled(page, "Next");
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
    expect((await awaitSessions(page)).sessions.filter((session: AiStudioSession) => session.status === "active")).toHaveLength(1);

    await clickButton(page, "Abandon session");
    await page.getByRole("button", {
      exact: true,
      name: "Abandon session"
    }).last().click();
    await expect.poll(async () => {
      const payload = await awaitSessions(page);
      return payload.sessions.filter((session: AiStudioSession) => session.status === "active").length;
    }, {
      timeout: 30_000
    }).toBe(0);
  });
});

function fixtureTitle(name: string) {
  return `[ai-studio live e2e] ${name} ${runId}`;
}

function stringValue(value: unknown) {
  return String(value || "").trim();
}

async function pathExists(filePath: string) {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function execText(command: string, args: string[], options: {
  cwd?: string;
  env?: Record<string, string | undefined>;
  timeout?: number;
} = {}) {
  try {
    const result = await execFileAsync(command, args, {
      cwd: options.cwd || appRoot,
      env: {
        ...process.env,
        ...(options.env || {})
      },
      maxBuffer: 16 * 1024 * 1024,
      timeout: options.timeout || COMMAND_TIMEOUT_MS
    });
    return String(result.stdout || "").trim();
  } catch (error) {
    const output = [
      String((error as { stdout?: unknown }).stdout || "").trim(),
      String((error as { stderr?: unknown }).stderr || "").trim(),
      String((error as Error).message || "").trim()
    ].filter(Boolean).join("\n");
    throw new Error(`${command} ${args.join(" ")} failed:\n${output}`);
  }
}

async function git(args: string[], options: { timeout?: number } = {}) {
  return execText("git", args, {
    cwd: targetRoot,
    timeout: options.timeout
  });
}

async function gh(args: string[], options: { timeout?: number } = {}) {
  return execText("gh", args, {
    cwd: targetRoot,
    timeout: options.timeout
  });
}

async function ghJson(args: string[]) {
  return JSON.parse(await gh(args));
}

async function prepareTargetRoot() {
  if (!targetRoot) {
    throw new Error([
      `Live AI Studio e2e tests require ${TARGET_ROOT_ENV}.`,
      "",
      `Set it to the dedicated seeded test repository before running ${LIVE_E2E_FLAG}=1 tests:`,
      "",
      `${TARGET_ROOT_ENV}=/home/merc/Development/current/${EXPECTED_TARGET_REPO_NAME} npm run test:e2e:live`,
      "",
      "These tests create real GitHub issues, pull requests, branches, and merges, so they must never infer a target repository."
    ].join("\n"));
  }
  if (!await pathExists(targetRoot)) {
    throw new Error(`${TARGET_ROOT_ENV} does not exist: ${targetRoot}`);
  }
  if (!await pathExists(path.join(targetRoot, ".git"))) {
    throw new Error(`${TARGET_ROOT_ENV} must be a Git repository: ${targetRoot}`);
  }
  if (!await pathExists(path.join(targetRoot, ".ai-studio", "project_type"))) {
    throw new Error(`${TARGET_ROOT_ENV} must be seeded with .ai-studio/project_type.`);
  }

  const remoteUrl = await git(["remote", "get-url", "origin"]);
  if (!remoteUrl.includes(EXPECTED_TARGET_REPO_NAME)) {
    throw new Error(
      `Live e2e tests only run against ${EXPECTED_TARGET_REPO_NAME}; origin is ${remoteUrl}.`
    );
  }

  await removeGeneratedSessionState();
  await assertTargetClean("before tests run");
  await syncTargetMainCheckout();
  await assertTargetClean("after syncing main");
}

async function assertGithubCliReady() {
  await gh(["auth", "status", "--hostname", "github.com"], {
    timeout: 30_000
  });
  await gh(["repo", "view", "--json", "nameWithOwner,url"], {
    timeout: 30_000
  });
}

async function removeGeneratedSessionState() {
  await removeGeneratedWorktrees();
  await rm(path.join(targetRoot, ".ai-studio", "sessions"), {
    force: true,
    recursive: true
  });
  await git(["worktree", "prune"]).catch(() => "");
  if (targetRoot) {
    await syncTargetMainCheckout().catch(() => "");
  }
}

async function assertTargetClean(reason: string) {
  const status = await git(["status", "--porcelain=v1"]);
  if (status) {
    throw new Error(`Live e2e target must be clean ${reason}:\n${status}`);
  }
}

async function syncTargetMainCheckout() {
  await git(["switch", "main"]);
  await git(["pull", "--ff-only", "origin", "main"], {
    timeout: 120_000
  });
}

async function removeGeneratedWorktrees() {
  const output = await git(["worktree", "list", "--porcelain"]).catch(() => "");
  const generatedRoot = path.join(targetRoot, ".ai-studio", "sessions");
  for (const worktreePath of parseWorktreePaths(output)) {
    if (worktreePath.startsWith(generatedRoot)) {
      await git(["worktree", "remove", "--force", worktreePath]).catch(() => "");
    }
  }
}

function parseWorktreePaths(output: string) {
  return output
    .split("\n")
    .map((line) => line.match(/^worktree (.+)$/u)?.[1] || "")
    .filter(Boolean);
}

async function startStudioServer(): Promise<StudioServer> {
  const port = await findFreePort();
  const serverProcess = spawn(process.execPath, ["bin/server.js"], {
    cwd: appRoot,
    env: {
      ...process.env,
      AI_STUDIO_SKIP_STALE_TERMINAL_CLEANUP: "1",
      AI_STUDIO_TARGET_ROOT: targetRoot,
      PORT: String(port)
    },
    stdio: ["ignore", "pipe", "pipe"]
  });
  let logs = "";
  serverProcess.stdout.on("data", (chunk) => {
    logs += String(chunk);
  });
  serverProcess.stderr.on("data", (chunk) => {
    logs += String(chunk);
  });

  const serverBaseUrl = `http://127.0.0.1:${port}`;
  await waitForServerHealth(serverBaseUrl, serverProcess, () => logs);
  return {
    baseUrl: serverBaseUrl,
    logs: () => logs,
    stop: () => stopServer(serverProcess)
  };
}

async function findFreePort() {
  return new Promise<number>((resolve, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) {
          resolve(address.port);
          return;
        }
        reject(new Error("Could not allocate a free local port."));
      });
    });
  });
}

async function waitForServerHealth(
  serverBaseUrl: string,
  serverProcess: ChildProcessWithoutNullStreams,
  logs: () => string
) {
  const deadline = Date.now() + SERVER_START_TIMEOUT_MS;
  while (Date.now() < deadline) {
    if (serverProcess.exitCode !== null) {
      throw new Error(`AI Studio server exited before it became ready:\n${logs()}`);
    }
    try {
      const response = await fetch(`${serverBaseUrl}/api/health`);
      if (response.ok) {
        return;
      }
    } catch {
      await delay(250);
    }
  }
  throw new Error(`AI Studio server did not become ready:\n${logs()}`);
}

async function stopServer(serverProcess: ChildProcessWithoutNullStreams) {
  if (serverProcess.exitCode !== null) {
    return;
  }
  serverProcess.kill("SIGTERM");
  await new Promise<void>((resolve) => {
    serverProcess.once("exit", () => resolve());
    setTimeout(() => {
      if (serverProcess.exitCode === null) {
        serverProcess.kill("SIGKILL");
      }
      resolve();
    }, 10_000).unref();
  });
}

function delay(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function runCleanupTasks() {
  while (cleanupTasks.length > 0) {
    const cleanupTask = cleanupTasks.pop();
    if (cleanupTask) {
      await cleanupTask().catch(() => null);
    }
  }
}

async function createFixtureIssue(label: string): Promise<FixtureIssue> {
  const title = fixtureTitle(label);
  const url = await gh([
    "issue",
    "create",
    "--title",
    title,
    "--body",
    `Created by live AI Studio e2e run ${runId}.`
  ]);
  const issue = await ghJson([
    "issue",
    "view",
    url,
    "--json",
    "number,title,url"
  ]) as FixtureIssue;
  cleanupTasks.push(async () => closeGithubIssue(issue.url));
  return {
    number: String(issue.number),
    title: issue.title,
    url: issue.url
  };
}

async function createFixturePullRequest(label: string): Promise<FixturePullRequest> {
  const branch = `ai-studio-e2e/${runId}/${label}`;
  const title = fixtureTitle(label);
  const relativePath = `e2e-fixtures/${runId}-${label}.txt`;

  await git(["switch", "main"]);
  await git(["pull", "--ff-only", "origin", "main"], {
    timeout: 120_000
  });
  await git(["switch", "-c", branch]);
  await mkdir(path.join(targetRoot, path.dirname(relativePath)), {
    recursive: true
  });
  await writeFile(path.join(targetRoot, relativePath), `Fixture PR ${label} from ${runId}\n`, "utf8");
  await git(["add", relativePath]);
  await git(["commit", "-m", title]);
  await git(["push", "-u", "origin", branch], {
    timeout: 120_000
  });
  const url = await gh([
    "pr",
    "create",
    "--base",
    "main",
    "--head",
    branch,
    "--title",
    title,
    "--body",
    `Created by live AI Studio e2e run ${runId}.`
  ], {
    timeout: 120_000
  });
  await git(["switch", "main"]);
  cleanupTasks.push(async () => {
    await closeGithubPr(url);
    await deleteRemoteBranch(branch);
    await git(["branch", "-D", branch]).catch(() => "");
  });
  return {
    branch,
    title,
    url
  };
}

async function closeGithubIssue(issueUrl: string) {
  if (!issueUrl) {
    return;
  }
  await gh([
    "issue",
    "close",
    issueUrl,
    "--comment",
    `Closed by live AI Studio e2e cleanup ${runId}.`
  ]).catch(() => "");
}

async function closeGithubPr(prUrl: string) {
  if (!prUrl) {
    return;
  }
  await gh([
    "pr",
    "close",
    prUrl,
    "--comment",
    `Closed by live AI Studio e2e cleanup ${runId}.`
  ]).catch(() => "");
}

async function deleteRemoteBranch(branch: string) {
  if (!branch) {
    return;
  }
  await git(["push", "origin", "--delete", branch], {
    timeout: 120_000
  }).catch(() => "");
}

async function gotoSessions(page: Page) {
  await waitForCurrentAppReady(page);
  await page.goto(`${baseUrl}/home`, {
    waitUntil: "networkidle"
  });
  await expect(page.getByRole("button", {
    exact: true,
    name: "New Session"
  })).toBeVisible({
    timeout: 60_000
  });
}

async function waitForCurrentAppReady(page: Page) {
  let lastReadiness: Record<string, unknown> = {};
  try {
    await expect.poll(async () => {
      lastReadiness = await readCurrentAppReadiness(page);
      return lastReadiness.ready === true;
    }, {
      timeout: 180_000
    }).toBe(true);
  } catch (error) {
    throw new Error([
      "AI Studio current app did not become ready before opening Sessions.",
      JSON.stringify(lastReadiness, null, 2),
      String((error as Error)?.message || error)
    ].join("\n"));
  }
}

async function readCurrentAppReadiness(page: Page) {
  const response = await page.request.get(`${baseUrl}/api/studio/current-app`);
  if (!response.ok()) {
    return {
      ready: false,
      status: response.status(),
      error: await response.text()
    };
  }
  const payload = await response.json();
  return {
    ready: payload?.ready === true,
    setup: payload?.setup || null,
    error: payload?.errors?.[0]?.message || payload?.error || ""
  };
}

async function createSession(page: Page) {
  await gotoSessions(page);
  await clickButton(page, "New Session");
  await expectButtonEnabled(page, "Use new branch");
  await expectButtonEnabled(page, "Use existing PR");
  const session = await onlyActiveSession(page);
  expect(session.currentStep).toBe("work_source_selected");
  return session;
}

async function createNewBranchSessionAtIssueStep(page: Page) {
  await createSession(page);
  await chooseNewBranch(page);
  await goNextToStep(page, "worktree_created");
  await runCommandAndWaitForMetadata(page, "Create worktree", "worktree_path");
  await goNextToStep(page, "dependencies_installed");
  await runCommandAndWaitForMetadata(page, "Install dependencies", "dependencies_installed", UI_COMMAND_TIMEOUT_MS);
  await goNextToStep(page, "issue_file_created");
}

async function chooseNewBranch(page: Page) {
  await clickButton(page, "Use new branch");
  await expectSessionMetadata(page, "work_source", "new_branch");
  await expectButtonDisabled(page, "Use new branch");
  await expectButtonDisabled(page, "Use existing PR");
  await expectButtonEnabled(page, "Next");
}

async function chooseExistingPr(page: Page, prRef: string) {
  await clickButton(page, "Use existing PR");
  await fillInputDialog(page, "PR URL or number", prRef);
  const session = await expectSessionMetadata(page, "work_source", "existing_pr");
  expect(session.metadata?.source_pr_url || "").toContain("/pull/");
  await expectButtonEnabled(page, "Next");
}

async function useExistingIssue(page: Page, issueRef: string) {
  await clickButton(page, "Use existing issue");
  await fillInputDialog(page, "Issue URL or number", issueRef);
  const session = await expectSessionMetadataContains(page, "issue_url", "/issues/");
  expect(session.metadata?.issue_source).toBe("existing");
  await expectButtonEnabled(page, "Next");
}

async function fillInputDialog(page: Page, label: string, value: string) {
  const dialog = page.getByRole("dialog");
  await expect(dialog).toBeVisible();
  await dialog.getByLabel(label).fill(value);
  await dialog.getByRole("button", {
    exact: true,
    name: "Continue"
  }).click();
  await expect(dialog).toHaveCount(0);
}

async function goNextToStep(page: Page, stepId: string) {
  await clickButton(page, "Next");
  await expectStep(page, stepId);
}

async function clickButton(page: Page, name: string) {
  const button = page.getByRole("button", {
    exact: true,
    name
  }).first();
  await expect(button).toBeVisible({
    timeout: 60_000
  });
  await expect(button).toBeEnabled({
    timeout: 60_000
  });
  await button.click();
}

async function expectButtonEnabled(page: Page, name: string) {
  await expect(page.getByRole("button", {
    exact: true,
    name
  }).first()).toBeEnabled({
    timeout: 60_000
  });
}

async function expectButtonDisabled(page: Page, name: string) {
  await expect(page.getByRole("button", {
    exact: true,
    name
  }).first()).toBeDisabled({
    timeout: 60_000
  });
}

async function expectButtonHidden(page: Page, name: string) {
  await expect(page.getByRole("button", {
    exact: true,
    name
  })).toHaveCount(0, {
    timeout: 60_000
  });
}

async function assertChecklistControls(page: Page, stepId: string, {
  disabled = [],
  enabled = [],
  hidden = []
}: {
  disabled?: string[];
  enabled?: string[];
  hidden?: string[];
}) {
  await expectStep(page, stepId);
  for (const label of enabled) {
    await expectButtonEnabled(page, label);
  }
  for (const label of disabled) {
    await expectButtonDisabled(page, label);
  }
  for (const label of hidden) {
    await expectButtonHidden(page, label);
  }
}

async function runCommandAndWaitForMetadata(page: Page, buttonLabel: string, metadataName: string, timeout = UI_COMMAND_TIMEOUT_MS) {
  await clickButton(page, buttonLabel);
  await expectSessionMetadataContains(page, metadataName, "", timeout);
  await expectButtonEnabled(page, "Next");
}

async function awaitSessions(page: Page) {
  const response = await page.request.get(`${baseUrl}/api/ai-studio/sessions?limit=20`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function runSessionAction(page: Page, actionId: string, input: Record<string, unknown> = {}) {
  const session = await latestSession(page);
  const response = await page.request.post(
    `${baseUrl}/api/ai-studio/sessions/${encodeURIComponent(session.sessionId)}/actions/${encodeURIComponent(actionId)}`,
    {
      data: input
    }
  );
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.sessionId).toBe(session.sessionId);
  expect(payload.actionResult?.actionId).toBe(actionId);
  return payload as AiStudioSession;
}

async function recordIssuePromptRequest(page: Page, issueRequest: string) {
  await runSessionAction(page, "send_issue_prompt", {
    issueRequest
  });
  await page.reload({
    waitUntil: "networkidle"
  });
  await expect.poll(async () => {
    const session = await latestSession(page);
    return Boolean((session.actionResults || []).find((result) => {
      return result.actionId === "send_issue_prompt" &&
        (result.input as { issueRequest?: string } | undefined)?.issueRequest === issueRequest;
    }));
  }, {
    timeout: 30_000
  }).toBe(true);
}

async function onlyActiveSession(page: Page): Promise<AiStudioSession> {
  await expect.poll(async () => {
    const payload = await awaitSessions(page);
    const activeSessions = payload.sessions.filter((session: AiStudioSession) => session.status === "active");
    return activeSessions.length;
  }, {
    timeout: 60_000
  }).toBe(1);
  const payload = await awaitSessions(page);
  return payload.sessions.find((session: AiStudioSession) => session.status === "active");
}

async function latestSession(page: Page): Promise<AiStudioSession> {
  const payload = await awaitSessions(page);
  const sessions = payload.sessions as AiStudioSession[];
  if (sessions.length < 1) {
    throw new Error("Expected at least one AI Studio session.");
  }
  return sessions.slice().sort((left, right) => left.sessionId.localeCompare(right.sessionId)).at(-1) as AiStudioSession;
}

async function expectStep(page: Page, stepId: string) {
  await expect.poll(async () => (await latestSession(page)).currentStep, {
    timeout: 60_000
  }).toBe(stepId);
}

async function expectSessionMetadata(
  page: Page,
  name: string,
  expectedValue: string,
  timeout = UI_COMMAND_TIMEOUT_MS
) {
  await expect.poll(async () => stringValue((await latestSession(page)).metadata?.[name]), {
    timeout
  }).toBe(expectedValue);
  return latestSession(page);
}

async function expectSessionMetadataContains(
  page: Page,
  name: string,
  expectedText: string,
  timeout = UI_COMMAND_TIMEOUT_MS
) {
  await expect.poll(async () => {
    const value = stringValue((await latestSession(page)).metadata?.[name]);
    return expectedText ? value.includes(expectedText) : Boolean(value);
  }, {
    timeout
  }).toBe(true);
  return latestSession(page);
}

async function writeIssueArtifacts(page: Page, {
  body,
  title
}: {
  body: string;
  title: string;
}) {
  const session = await latestSession(page);
  await writeArtifact(session, "issue_title", `${title}\n`);
  await writeArtifact(session, "issue.md", `${body}\n`);
  await page.reload({
    waitUntil: "networkidle"
  });
  await expect.poll(async () => {
    const updatedSession = await latestSession(page);
    return updatedSession.artifactReadiness?.issue_title?.nonEmpty === true &&
      updatedSession.artifactReadiness?.["issue.md"]?.nonEmpty === true;
  }, {
    timeout: 30_000
  }).toBe(true);
}

async function writePullRequestArtifact(page: Page, body: string) {
  const session = await latestSession(page);
  await writeArtifact(session, "pull_request.md", body.endsWith("\n") ? body : `${body}\n`);
  await page.reload({
    waitUntil: "networkidle"
  });
  await expect.poll(async () => {
    return (await latestSession(page)).artifactReadiness?.["pull_request.md"]?.nonEmpty === true;
  }, {
    timeout: 30_000
  }).toBe(true);
}

async function writeArtifact(session: AiStudioSession, artifactName: string, contents: string) {
  await mkdir(session.artifactsRoot, {
    recursive: true
  });
  await writeFile(path.join(session.artifactsRoot, artifactName), contents, "utf8");
}

async function markMetadata(page: Page, name: string, value: string) {
  const session = await latestSession(page);
  await mkdir(session.metadataRoot, {
    recursive: true
  });
  await writeFile(path.join(session.metadataRoot, name), `${value}\n`, "utf8");
}

async function markMetadataAndReload(page: Page, name: string, value: string) {
  await markMetadata(page, name, value);
  await page.reload({
    waitUntil: "networkidle"
  });
  await expectSessionMetadata(page, name, value, 30_000);
}

async function writeWorktreeFile(page: Page, relativePath: string, contents: string) {
  const session = await latestSession(page);
  const worktreePath = stringValue(session.metadata?.worktree_path);
  if (!worktreePath) {
    throw new Error("Cannot write a worktree file before the worktree exists.");
  }
  const absolutePath = path.join(worktreePath, relativePath);
  await mkdir(path.dirname(absolutePath), {
    recursive: true
  });
  await writeFile(absolutePath, contents, "utf8");
}

async function editIssueDraft(page: Page, {
  body,
  title
}: {
  body: string;
  title: string;
}) {
  await clickButton(page, "Edit issue");
  await page.getByLabel("Issue title").fill(title);
  await page.getByLabel("Issue body").fill(body);
  await clickButton(page, "Save");
  await expect(page.getByText("Draft saved.")).toBeVisible({
    timeout: 30_000
  });
  await closeDraftEditor(page, "Close edit issue");
}

async function editPullRequestDraft(page: Page, body: string) {
  await clickButton(page, "Edit PR");
  await page.getByLabel("Pull request body").fill(body);
  await clickButton(page, "Save");
  await expect(page.getByText("Draft saved.")).toBeVisible({
    timeout: 30_000
  });
  await closeDraftEditor(page, "Close edit pr");
}

async function closeDraftEditor(page: Page, title: string) {
  const closeButton = page.locator(`button[title="${title}"]`).first();
  await expect(closeButton).toBeVisible({
    timeout: 30_000
  });
  await closeButton.click();
}

async function reviewDiff(page: Page, expectedFileName: string) {
  await clickButton(page, "Review diff");
  const dialog = page.getByRole("dialog");
  await expect(dialog.getByText("Changes found")).toBeVisible({
    timeout: 60_000
  });
  await expect(dialog.getByText(expectedFileName, {
    exact: false
  }).first()).toBeVisible({
    timeout: 60_000
  });
  await dialog.getByRole("button", {
    exact: true,
    name: "Close"
  }).click();
}
