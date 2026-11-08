import assert from "node:assert/strict";
import { execFile, spawn } from "node:child_process";
import { lstat, mkdir, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";

import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { Vibe64SessionRuntime } from "@local/vibe64-runtime/server/runtime";
import { createVibe64SessionStore } from "@local/vibe64-runtime/server/sessionStore";
import { workspaceSetupStateFromMetadata } from "@local/vibe64-runtime/server/workspaceSetupState";
import { sessionConnectedCopies } from "../../packages/vibe64-core/src/server/projectRepository.js";
import {
  createSessionWorkspaceSetup,
  createTerminalsSetupRunner
} from "../../packages/vibe64-sessions/src/server/sessionWorkspaceSetup.js";
import { createCodexGitCommandService } from "../../packages/vibe64-terminals/src/server/codexGitCommand.js";
import { __testables as launchContextTestables } from "../../packages/vibe64-terminals/src/server/outputTargetLaunchContext.js";
import { createServiceSessionAccess } from "../../packages/vibe64-terminals/src/server/serviceSessionAccess.js";
import { prepareConnectedRepositories } from "../../packages/vibe64-terminals/src/server/serviceSessionConnectedCopies.js";
import { createServiceTurnPublication } from "../../packages/vibe64-terminals/src/server/serviceTurnPublication.js";
import { createServiceWorkspacePreparation } from "../../packages/vibe64-terminals/src/server/serviceWorkspacePreparation.js";
import {
  recordSessionGitCommandActor,
  sessionGitCommandActorFromMetadata
} from "../../packages/vibe64-terminals/src/server/sessionGitCommandActor.js";
import { createWorkspaceSetupRunner } from "../../packages/vibe64-terminals/src/server/workspaceSetup.js";
import { endChildInput } from "./childInputTestHelpers.js";
import { projectRuntimeRoot, sourceMetadata, sourcePath, withTemporaryRoot } from "./vibe64TestHelpers.js";

// A hosted session (user account mode) whose vibe64.connections.json lists
// example/library, which it has no copy of yet. Its GitHub URL reaches a local
// bare repository through Git's URL rewriting. The session's Git commands run
// through the real Git command service; only the gateway is replaced, so each
// GitHub sign-in read names the person it reads, and returns that person's
// token. The owner is this machine's own user: the service resolves the
// owner's real home, as it does on a hosted VPS.

const execFileAsync = promisify(execFile);
const ENV = Object.freeze({ VIBE64_GITHUB_ACCOUNT_MODE: "user" });
const IDENTITY = {
  GIT_AUTHOR_EMAIL: "vibe64@example.test",
  GIT_AUTHOR_NAME: "Vibe64 Test",
  GIT_COMMITTER_EMAIL: "vibe64@example.test",
  GIT_COMMITTER_NAME: "Vibe64 Test"
};
const LOGGER = Object.freeze({ debug() {}, error() {}, info() {}, level: "info", warn() {} });
const OWNER = os.userInfo().username;
const SESSION_ID = "owned-session";
// Someone other than the session's owner: no such account exists, so nothing may read their sign-in.
const VISITOR = Object.freeze({ gid: 4242, home: "/home/vibe64-visitor", uid: 4242, username: "vibe64-visitor" });
const WAITING = "Select Prepare workspace to copy this session's connected repositories with your GitHub account.";

function spawnCommand(request = {}, env = {}) {
  return new Promise((resolve) => {
    const child = spawn(request.command, request.args || [], {
      cwd: request.cwd,
      env: { ...process.env, ...IDENTITY, GIT_CONFIG_NOSYSTEM: "1", ...env }
    });
    let stderr = "";
    let stdout = "";
    child.stderr.setEncoding("utf8");
    child.stdout.setEncoding("utf8");
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.once("error", (error) => resolve({ code: "git_failed", error: error.message, ok: false, output: stderr, stderr, stdout }));
    child.once("close", (code) => resolve({ ...(code === 0 ? {} : { code: "git_failed" }), ok: code === 0, output: stdout, stderr, stdout }));
    endChildInput(child, request.input ?? undefined);
  });
}

function readySetup() {
  return {
    components: ["jskit"],
    connectedDevelopment: { inputsHash: "sha256:connected" },
    diagnostics: [],
    recipeHash: "sha256:recipe",
    runtimeRequirements: ["nodejs"],
    source: "project",
    stackHash: "sha256:stack",
    status: "ready",
    steps: [{ argv: ["npm", "install"], label: "Install JavaScript dependencies", runtimeRequirements: ["nodejs"], workdir: "." }]
  };
}

/**
 * The session, its project, the Git command service and the workspace preparation the service runs,
 * wired as the terminals service wires them. `gatewayRequests` lists every command the Git command
 * service ran.
 */
async function hostedSession(targetRoot) {
  const githubConfig = path.join(targetRoot, "github.gitconfig");
  const plainConfig = path.join(targetRoot, "plain.gitconfig");
  await writeFile(githubConfig, `[url "${path.join(targetRoot, "github")}/"]\n\tinsteadOf = https://github.com/\n`);
  await writeFile(plainConfig, "");
  const bare = path.join(targetRoot, "github", "example", "library.git");
  const seed = path.join(targetRoot, "seed");
  const git = (cwd, args) => execFileAsync("git", args, { cwd, env: { ...process.env, ...IDENTITY } });
  await git(targetRoot, ["init", "--bare", "--initial-branch=main", bare]);
  await git(targetRoot, ["init", "--initial-branch=main", seed]);
  await writeFile(path.join(seed, "library.txt"), "initial\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "initial"]);
  await git(seed, ["push", bare, "HEAD:main"]);

  const gatewayRequests = [];
  const gateway = async (request = {}) => {
    gatewayRequests.push(request);
    if (request.command === "gh") return { ok: true, stdout: `token-of-${request.userKey}\n` };
    return spawnCommand(request, { GIT_CONFIG_GLOBAL: githubConfig });
  };
  const plain = (request = {}) => spawnCommand(request, { GIT_CONFIG_GLOBAL: plainConfig });

  await mkdir(sourcePath(targetRoot, SESSION_ID), { recursive: true });
  const store = createVibe64SessionStore({ projectContextRoot: targetRoot, projectRuntimeRoot: projectRuntimeRoot(targetRoot) });
  const runtime = new Vibe64SessionRuntime({
    projectContextRoot: targetRoot,
    projectRuntimeRoot: projectRuntimeRoot(targetRoot),
    store
  });
  await runtime.store.createSession({
    metadata: {
      ...sourceMetadata(targetRoot, SESSION_ID),
      repository_mode: "github",
      source_remote_url: "https://github.com/example/project.git"
    },
    runtimeKind: "genesis",
    sessionId: SESSION_ID
  });

  const project = {
    async createRuntimeWithoutSource() { return runtime; },
    async inspectConnectedDevelopmentInputs() { return { inputsHash: "sha256:connected", sourceRoots: [] }; },
    inspectWorkspaceSetup: () => readySetup(),
    async listProjects() { return { projects: [] }; },
    async prepareConnectedDevelopmentInputs() { return { inputsHash: "sha256:connected" }; },
    async projectEnvironmentStatus() { return { status: "ready" }; },
    async projectExecutionEnvironment() { return { environment: {}, resourceConfigurationFingerprint: "c".repeat(64) }; },
    async readCurrentProject() { return { githubRepository: { fullName: "example/project" } }; },
    async readSessionConnectedRepositories() { return [{ fullName: "example/library" }]; }
  };
  const codexGitCommand = createCodexGitCommandService({ env: ENV, logger: LOGGER, project, runGatewayCommand: gateway });
  const connectedPreparation = options => prepareConnectedRepositories({
    ...options,
    codexGitCommand,
    env: ENV,
    project,
    runCommand: plain
  });
  const workspaceSetup = createWorkspaceSetupRunner({
    async startWorkflow() { return { ok: true, workflow: { id: "6f0a9a54-2a43-4d7b-9a3e-6c1b4c0b8f11" } }; },
    async finishWorkflow() {},
    connectedPreparation,
    project,
    async runCommand() { return { exitCode: 0, ok: true, output: "" }; }
  });
  const publishSessionChanged = { agentTerminal: async () => {} };
  const sessionAccess = createServiceSessionAccess({ logger: LOGGER, project, publishSessionChanged });
  const workspacePreparation = createServiceWorkspacePreparation({
    project,
    publishSessionChanged,
    restartPreviewAfterSetup: async () => ({ ok: true }),
    sessionAccess,
    workspaceSetup
  });
  return {
    connectedPreparation,
    copyPath: path.join(path.dirname(sourcePath(targetRoot, SESSION_ID)), "connected", "library"),
    gatewayRequests,
    runtime,
    session: () => runtime.getSessionWithoutSource(SESSION_ID),
    workspacePreparation
  };
}

/** The session's owner, recorded as each message to its AI records them. */
async function recordOwner(hosted, username = OWNER) {
  const session = await hosted.session();
  const recorded = await recordSessionGitCommandActor({
    env: ENV,
    overwrite: true,
    reason: "codex-prompt",
    runtime: hosted.runtime,
    session,
    sourceRoot: sessionSourcePath(session),
    vibe64User: { username },
    workdir: sessionSourcePath(session)
  });
  assert.equal(recorded.ok, true, "the owner is recorded");
}

/** Whose GitHub sign-in was read, and the token each Git command that reached GitHub carried. */
function githubAccess(hosted) {
  const reachedGithub = hosted.gatewayRequests.filter(request => request.command === "git" &&
    ["clone", "fetch", "ls-remote"].includes(request.args?.[0]));
  return {
    signInsRead: hosted.gatewayRequests.filter(request => request.command === "gh").map(request => request.userKey),
    tokens: [...new Set(reachedGithub.map(request => request.gitAuthToken))]
  };
}

async function storedSetup(hosted) {
  return workspaceSetupStateFromMetadata((await hosted.runtime.store.readSession(SESSION_ID)).metadata);
}

async function assertCopiedAsOwner(hosted, message) {
  assert.ok((await lstat(hosted.copyPath)).isDirectory(), `${message}: the copy is made`);
  assert.deepEqual(sessionConnectedCopies(await hosted.session()).map(copy => copy.repository), ["example/library"],
    `${message}: the copy is recorded`);
  assert.deepEqual(githubAccess(hosted), { signInsRead: [OWNER], tokens: [`token-of-${OWNER}`] },
    `${message}: only the session owner's GitHub access is used`);
  assert.equal((await storedSetup(hosted)).status, "succeeded", `${message}: preparation finishes`);
}

async function assertWaitsForPerson(hosted, message) {
  const setup = await storedSetup(hosted);
  assert.equal(setup.status, "required", `${message}: preparation waits instead of failing`);
  assert.equal(setup.currentLabel, "Prepare connected repositories");
  assert.equal(setup.diagnostic, WAITING);
  assert.ok(setup.transcript.endsWith(WAITING), `${message}: the output says what to do`);
  assert.equal(await lstat(hosted.copyPath).catch(() => null), null, `${message}: nothing is copied`);
  assert.deepEqual(githubAccess(hosted), { signInsRead: [], tokens: [] }, `${message}: nobody's GitHub access is used`);
  assert.equal(launchContextTestables.workspaceSetupLaunchDisabledReason({ workspaceSetup: setup }, {
    recipeHash: "sha256:recipe",
    status: "ready"
  }), WAITING, `${message}: Preview waits too and says why`);
}

/** Every way a preparation starts that no person asked for, as each one starts it. */
const UNATTENDED_STARTS = Object.freeze([
  ["after an AI turn", async (hosted) => {
    const work = [];
    const { publishAgentSessionChanged } = createServiceTurnPublication({
      afterRoutedTurn: async () => {},
      afterTemporaryTurn: async () => {},
      cancelGoalIfMainAiChanged: async () => {},
      conversationTurns: { settled: async () => {} },
      finishInterruptedCloses: async () => {},
      logger: LOGGER,
      providerUsage: { observe() {} },
      publishSessionChanged: { agentTerminal: async () => {} },
      state: { lifecycle: { closing: false }, trackShutdownWork: (promise) => { work.push(promise); } },
      workspacePreparation: hosted.workspacePreparation
    });
    await publishAgentSessionChanged(SESSION_ID, { reason: "claude-stream-turn-idle" });
    await Promise.all(work);
    await hosted.workspacePreparation.waitForWorkspaceSetup(SESSION_ID);
  }],
  ["by the AI's own retry", async (hosted) => {
    const setup = await hosted.workspacePreparation.prepareWorkspaceSetup(SESSION_ID, { publish: true, retry: true });
    await setup.completion;
  }],
  ["by a Preview start", async (hosted) => {
    await hosted.workspacePreparation.prepareWorkspaceSetup(SESSION_ID, {
      publish: true,
      rerunFailed: true,
      waitForCompletion: true
    });
  }]
]);

/** The preparation that follows Update, for the person who asked for the Update. */
async function prepareAfterUpdate(hosted, vibe64User) {
  const { workspacePreparation } = hosted;
  const workspaceSetup = createSessionWorkspaceSetup({
    project: { createRuntimeWithoutSource: async () => hosted.runtime },
    publishSessionChanged: async () => {},
    setupRunner: createTerminalsSetupRunner({
      terminals: {
        prepareRenewalWorkspaceSetup: workspacePreparation.prepareRenewalWorkspaceSetup,
        prepareWorkspaceSetup: workspacePreparation.prepareWorkspaceSetup,
        waitForWorkspaceSetup: workspacePreparation.waitForWorkspaceSetup,
        workspaceSetupIsRunning: workspacePreparation.workspaceSetupIsRunning
      }
    })
  });
  await workspaceSetup.prepareUpdatedWorkspace(hosted.runtime, SESSION_ID, { vibe64User, wait: true });
}

for (const [start, run] of UNATTENDED_STARTS) {
  test(`a preparation started ${start} copies a missing connected repository with the session owner's GitHub access`, async () => {
    await withTemporaryRoot(async (targetRoot) => {
      const hosted = await hostedSession(targetRoot);
      await recordOwner(hosted);
      await run(hosted);
      await assertCopiedAsOwner(hosted, start);
    });
  });

  test(`a preparation started ${start} in a session with no owner waits for a person instead of failing`, async () => {
    await withTemporaryRoot(async (targetRoot) => {
      const hosted = await hostedSession(targetRoot);
      await run(hosted);
      await assertWaitsForPerson(hosted, start);
    });
  });
}

test("the preparation after Update copies with the session owner's GitHub access, never the access of the person who updated", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const hosted = await hostedSession(targetRoot);
    await recordOwner(hosted);
    await prepareAfterUpdate(hosted, VISITOR);
    await assertCopiedAsOwner(hosted, "after Update");
    assert.equal(sessionGitCommandActorFromMetadata(await hosted.session()).actorUserKey, OWNER, "the owner stays the owner");
  });
});

test("the preparation after Update of a session with no owner copies as the person who updated, who becomes its owner", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const hosted = await hostedSession(targetRoot);
    await prepareAfterUpdate(hosted, { username: OWNER });
    await assertCopiedAsOwner(hosted, "after Update");
    const owner = sessionGitCommandActorFromMetadata(await hosted.session());
    assert.equal(owner.ok, true);
    assert.equal(owner.actorUserKey, OWNER, "the person who updated is recorded as the session's owner");
    assert.equal(owner.actorReason, "workspace-preparation");
  });
});

test("Prepare workspace by a person who does not own the session still copies with its owner's access", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const hosted = await hostedSession(targetRoot);
    await recordOwner(hosted);
    const prepared = await hosted.connectedPreparation({
      mode: "prepare",
      runtime: hosted.runtime,
      session: await hosted.session(),
      vibe64User: VISITOR
    });
    assert.ok(prepared.lines.some(line => line.startsWith("[Connected] library copied at ")));
    assert.deepEqual(githubAccess(hosted), { signInsRead: [OWNER], tokens: [`token-of-${OWNER}`] });
  });
});

test("Prepare workspace selected in a session that waits for a person copies as them and prepares the workspace", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const hosted = await hostedSession(targetRoot);
    await hosted.workspacePreparation.prepareWorkspaceSetup(SESSION_ID, { publish: true, waitForCompletion: true });
    await assertWaitsForPerson(hosted, "before Prepare workspace");
    const retried = await hosted.workspacePreparation.prepareWorkspaceSetup(SESSION_ID, {
      publish: true,
      retry: true,
      vibe64User: { username: OWNER }
    });
    await retried.completion;
    await assertCopiedAsOwner(hosted, "Prepare workspace");
  });
});
