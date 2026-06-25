import { expect, type Page } from "@playwright/test";
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  UI_COMMAND_TIMEOUT_MS,
  getLiveBaseUrl,
  stringValue
} from "./environment";

type Vibe64Session = {
  actionResults?: Array<Record<string, unknown>>;
  actions?: Array<Record<string, unknown>>;
  artifactReadiness?: Record<string, { nonEmpty?: boolean }>;
  artifactsRoot: string;
  currentStep: string;
  metadata?: Record<string, string>;
  metadataRoot: string;
  sessionId: string;
  status: string;
  stepMachine?: {
    status?: string;
  };
};

async function gotoSessions(page: Page) {
  await waitForCurrentAppReady(page);
  await page.goto(`${getLiveBaseUrl()}/home`, {
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
      "Vibe64 current app did not become ready before opening Sessions.",
      JSON.stringify(lastReadiness, null, 2),
      String((error as Error)?.message || error)
    ].join("\n"));
  }
}

async function readCurrentAppReadiness(page: Page) {
  const response = await page.request.get(`${getLiveBaseUrl()}/api/studio/current-app`);
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
  const makeImprovementsDefinition = page.getByText("Make improvements", {
    exact: true
  });
  if (await makeImprovementsDefinition.isVisible().catch(() => false)) {
    await makeImprovementsDefinition.click();
  }
  await expectButtonEnabled(page, "New issue");
  await expectButtonEnabled(page, "Existing PR");
  const session = await onlyActiveSession(page);
  expect(session.currentStep).toBe("work_source_selected");
  return session;
}

async function createNewBranchSessionAtIssueStep(page: Page) {
  await createSession(page);
  await chooseNewBranch(page);
  await runCommandAndWaitForMetadata(page, "Create session clone", "worktree_path");
  await goNextToStep(page, "dependencies_installed");
  await runCommandAndWaitForMetadata(page, "Install dependencies", "dependencies_installed", UI_COMMAND_TIMEOUT_MS);
  await goNextToStep(page, "issue_file_created");
}

async function chooseNewBranch(page: Page) {
  await clickButton(page, "New issue");
  await expectSessionMetadata(page, "work_source", "new_issue");
  await expectStep(page, "worktree_created");
}

async function chooseExistingPr(page: Page, prRef: string) {
  await clickButton(page, "Existing PR");
  await fillInlineWorkflowInput(page, "PR URL or number", prRef, "Existing PR");
  const session = await expectSessionMetadata(page, "work_source", "existing_pr");
  expect(session.metadata?.source_pr_url || "").toContain("/pull/");
  await expectStep(page, "worktree_created");
}

async function useExistingIssue(page: Page, issueRef: string) {
  await clickButton(page, "Solve existing issue");
  await fillInlineWorkflowInput(page, "Issue URL or number", issueRef, "Solve existing issue");
  const session = await expectSessionMetadataContains(page, "issue_url", "/issues/");
  expect(session.metadata?.issue_source).toBe("existing");
  await expectButtonEnabled(page, "Next step");
}

async function fillInlineWorkflowInput(page: Page, label: string, value: string, submitLabel: string) {
  await page.getByLabel(label).fill(value);
  await page.getByRole("button", {
    exact: true,
    name: submitLabel
  }).click();
}

async function goNextToStep(page: Page, stepId: string) {
  await clickButton(page, "Next step");
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

async function runCommandAndWaitForMetadata(
  page: Page,
  buttonLabel: string,
  metadataName: string,
  timeout = UI_COMMAND_TIMEOUT_MS
) {
  await clickButton(page, buttonLabel);
  await expectSessionMetadataContains(page, metadataName, "", timeout);
  await expectButtonEnabled(page, "Next step");
}

async function awaitSessions(page: Page) {
  const response = await page.request.get(`${getLiveBaseUrl()}/api/vibe64/sessions?limit=20`);
  expect(response.ok()).toBe(true);
  return response.json();
}

async function runSessionAction(page: Page, actionId: string, input: Record<string, unknown> = {}) {
  const session = await latestSession(page);
  const response = await page.request.post(
    `${getLiveBaseUrl()}/api/vibe64/sessions/${encodeURIComponent(session.sessionId)}/actions/${encodeURIComponent(actionId)}`,
    {
      data: input
    }
  );
  expect(response.ok()).toBe(true);
  const payload = await response.json();
  expect(payload.sessionId).toBe(session.sessionId);
  expect(payload.actionResult?.actionId).toBe(actionId);
  return payload as Vibe64Session;
}

async function onlyActiveSession(page: Page): Promise<Vibe64Session> {
  await expect.poll(async () => {
    const payload = await awaitSessions(page);
    const activeSessions = payload.sessions.filter((session: Vibe64Session) => session.status === "active");
    return activeSessions.length;
  }, {
    timeout: 60_000
  }).toBe(1);
  const payload = await awaitSessions(page);
  return payload.sessions.find((session: Vibe64Session) => session.status === "active");
}

async function latestSession(page: Page): Promise<Vibe64Session> {
  const payload = await awaitSessions(page);
  const sessions = payload.sessions as Vibe64Session[];
  if (sessions.length < 1) {
    throw new Error("Expected at least one Vibe64 session.");
  }
  return sessions.slice().sort((left, right) => left.sessionId.localeCompare(right.sessionId)).at(-1) as Vibe64Session;
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
  title,
  word = title
}: {
  body: string;
  title: string;
  word?: string;
}) {
  await submitCurrentStepInput(page, {
    body,
    title,
    word
  });
  await page.reload({
    waitUntil: "networkidle"
  });
  await expect.poll(async () => {
    const updatedSession = await latestSession(page);
    return updatedSession.artifactReadiness?.issue_title?.nonEmpty === true &&
      updatedSession.artifactReadiness?.issue_word?.nonEmpty === true &&
      updatedSession.artifactReadiness?.["issue.md"]?.nonEmpty === true;
  }, {
    timeout: 30_000
  }).toBe(true);
}

async function writePullRequestArtifact(page: Page, body: string) {
  await submitCurrentStepInput(page, {
    title: firstMarkdownHeading(body) || "Vibe64 pull request",
    body
  });
  await page.reload({
    waitUntil: "networkidle"
  });
  await expect.poll(async () => {
    const session = await latestSession(page);
    return session.artifactReadiness?.["tmp/create_and_merge_pull_request.title.txt"]?.nonEmpty === true &&
      session.artifactReadiness?.["tmp/create_and_merge_pull_request.body.md"]?.nonEmpty === true;
  }, {
    timeout: 30_000
  }).toBe(true);
}

function firstMarkdownHeading(markdown: string) {
  return String(markdown || "")
    .split("\n")
    .map((line) => line.replace(/^#+\s*/u, "").trim())
    .find(Boolean) || "";
}

async function submitCurrentStepInput(page: Page, fields: Record<string, string>) {
  const session = await latestSession(page);
  const stepStatus = String(session.stepMachine?.status || "");
  const response = await page.request.post(
    `${getLiveBaseUrl()}/api/vibe64/sessions/${encodeURIComponent(session.sessionId)}/current-step/input`,
    {
      data: {
        fields,
        kind: "ready",
        source: stepStatus === "awaiting_agent_result" ? "codex" : "ui",
        stepId: session.currentStep,
        stepStatus
      }
    }
  );
  expect(response.ok()).toBe(true);
  return response.json();
}

async function writeReportArtifact(page: Page, body: string) {
  const session = await latestSession(page);
  await writeArtifact(session, "report.md", body.endsWith("\n") ? body : `${body}\n`);
  await page.reload({
    waitUntil: "networkidle"
  });
  await expect.poll(async () => {
    return (await latestSession(page)).artifactReadiness?.["report.md"]?.nonEmpty === true;
  }, {
    timeout: 30_000
  }).toBe(true);
}

async function writeArtifact(session: Vibe64Session, artifactName: string, contents: string) {
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

async function reviewDiff(page: Page, expectedFileName: string) {
  await clickButton(page, "Diff");
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

export {
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
  useExistingIssue,
  submitCurrentStepInput,
  writeIssueArtifacts,
  writePullRequestArtifact,
  writeReportArtifact,
  writeWorktreeFile
};

export type {
  Vibe64Session
};
