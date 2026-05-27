import { execFile as execFileCallback, spawn, type ChildProcessWithoutNullStreams } from "node:child_process";
import { access, mkdir, rm, writeFile } from "node:fs/promises";
import { createServer } from "node:net";
import path from "node:path";
import process from "node:process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFileCallback);

const LIVE_E2E_FLAG = "VIBE64_LIVE_E2E";
const TARGET_ROOT_ENV = "VIBE64_E2E_TARGET_ROOT";
const EXPECTED_TARGET_REPO_NAME = "studio-ai-e2e-repo";
const COMMAND_TIMEOUT_MS = 120_000;
const SERVER_START_TIMEOUT_MS = 45_000;
const UI_COMMAND_TIMEOUT_MS = 240_000;

const appRoot = process.cwd();
const configuredTargetRoot = String(process.env[TARGET_ROOT_ENV] || "").trim();
const targetRoot = configuredTargetRoot ? path.resolve(configuredTargetRoot) : "";
const runId = `live-e2e-${Date.now()}-${process.pid}`;
const liveE2eEnabled = process.env[LIVE_E2E_FLAG] === "1";
const cleanupTasks: Array<() => Promise<void>> = [];

let baseUrl = "";

type StudioServer = {
  baseUrl: string;
  logs: () => string;
  stop: () => Promise<void>;
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

function setLiveBaseUrl(nextBaseUrl: string) {
  baseUrl = String(nextBaseUrl || "").replace(/\/+$/u, "");
}

function getLiveBaseUrl() {
  if (!baseUrl) {
    throw new Error("Live Vibe64 base URL has not been initialized.");
  }
  return baseUrl;
}

function addCleanupTask(cleanupTask: () => Promise<void>) {
  cleanupTasks.push(cleanupTask);
}

function fixtureTitle(name: string) {
  return `[vibe64 live e2e] ${name} ${runId}`;
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
      `Live Vibe64 e2e tests require ${TARGET_ROOT_ENV}.`,
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
  if (!await pathExists(path.join(targetRoot, ".vibe64", "project_type"))) {
    throw new Error(`${TARGET_ROOT_ENV} must be seeded with .vibe64/project_type.`);
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
  await rm(path.join(targetRoot, ".vibe64", "sessions"), {
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
  const generatedRoot = path.join(targetRoot, ".vibe64", "sessions");
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
      VIBE64_SKIP_STALE_TERMINAL_CLEANUP: "1",
      VIBE64_TARGET_ROOT: targetRoot,
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
      throw new Error(`Vibe64 server exited before it became ready:\n${logs()}`);
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
  throw new Error(`Vibe64 server did not become ready:\n${logs()}`);
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
    `Created by live Vibe64 e2e run ${runId}.`
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
  const branch = `vibe64-e2e/${runId}/${label}`;
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
    `Created by live Vibe64 e2e run ${runId}.`
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
    `Closed by live Vibe64 e2e cleanup ${runId}.`
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
    `Closed by live Vibe64 e2e cleanup ${runId}.`
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

export {
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
  getLiveBaseUrl,
  ghJson,
  liveE2eEnabled,
  prepareTargetRoot,
  removeGeneratedSessionState,
  runCleanupTasks,
  runId,
  setLiveBaseUrl,
  startStudioServer,
  stringValue,
  targetRoot
};

export type {
  FixtureIssue,
  FixturePullRequest,
  StudioServer
};
