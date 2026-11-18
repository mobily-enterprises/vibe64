import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { promisify } from "node:util";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import {
  canonicalRepositoryInitializeScript,
  canonicalRepositoryInstallRefScript
} from "../../packages/vibe64-execution/src/server/repositoryStorage.js";
import { runVibe64AgentWriteExclusive } from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { createSessionRepositoryUpdates } from "../../packages/vibe64-sessions/src/server/sessionRepositoryUpdates.js";
import { createSessionWork } from "../../packages/vibe64-sessions/src/server/sessionWork.js";
import { createSessionWorkOperations } from "../../packages/vibe64-sessions/src/server/sessionWorkOperations.js";
import { createSessionWorkRecovery } from "../../packages/vibe64-sessions/src/server/sessionWorkRecovery.js";
import { createMainChatNote, MAIN_CHAT_NOTE_METADATA_KEY } from "../../packages/vibe64-terminals/src/server/mainChatNote.js";
import { createServiceCommandServices } from "../../packages/vibe64-terminals/src/server/serviceCommandServices.js";
import { createServiceHostSlots } from "../../packages/vibe64-terminals/src/server/serviceHostSlots.js";
import { createServiceSessionAccess } from "../../packages/vibe64-terminals/src/server/serviceSessionAccess.js";
import { createServiceSessionWork } from "../../packages/vibe64-terminals/src/server/serviceSessionWork.js";
import { createServiceSessionWorkInspection } from "../../packages/vibe64-terminals/src/server/serviceSessionWorkInspection.js";
import { createServiceState } from "../../packages/vibe64-terminals/src/server/serviceState.js";
import { createSessionSource } from "../../packages/vibe64-terminals/src/server/sessionSource.js";
import { sessionHelper } from "./agentSessionUpdateTestHelpers.js";
import { commandRunner, git } from "./connectedCopiesTestHelpers.js";

const execFileAsync = promisify(execFile);
const PERSON = { id: "person-1" };
const AFTER_PLAN = ["review", "security-pass", "data-pass", "quality-pass", "ui-pass", "deslop"];
// Save and Update run Git and a few managed jobs on small repositories; far past that, one waits for something it
// must not wait for.
const BOUND_MS = 60_000;
const short = commit => commit.slice(0, 12);

/**
 * Settles with `work`, or fails naming `waitingFor` once the bound passes.
 * @param {Promise<unknown>} work
 * @param {string} waitingFor
 */
async function bounded(work, waitingFor) {
  let timer;
  const bound = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Still waiting after ${BOUND_MS} ms: ${waitingFor}`)), BOUND_MS);
  });
  try {
    return await Promise.race([work, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * Two sessions of one project with no GitHub, its saved versions in a managed Git repository, each session's
 * source made as Vibe64 makes it and its main chat set to save automatically. Below them, the real Save, Update and
 * update check: the terminals' over Git and the managed jobs, the sessions' over those, in the terminals' slots as
 * the sessions feature fills them, and `vibe64-helper session ...` over the session command the terminals compose.
 * A session's `agentRuns` say whether its main chat turn runs; `steers` are the notes sent into a running turn.
 * @param {import("node:test").TestContext} t
 */
async function twoSessions(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-session-save-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const seed = path.join(root, "seed");
  await git(root, ["init", "--initial-branch=main", seed]);
  await writeFile(path.join(seed, "shared.txt"), "initial\n");
  await git(seed, ["add", "."]);
  await git(seed, ["commit", "-m", "initial"]);
  const canonicalRepositoryPath = path.join(root, "canonical-repository", "repository.git");
  const script = text => execFileAsync("bash", ["-lc", text], { cwd: root });
  await script(canonicalRepositoryInitializeScript({ defaultBranch: "main", repositoryPath: canonicalRepositoryPath }));
  await script(canonicalRepositoryInstallRefScript({ repositoryPath: canonicalRepositoryPath,
    sourceRef: "refs/heads/main", sourceRepository: seed, targetRef: "refs/heads/main" }));
  const projectRecord = {
    canonicalRepositoryPath,
    ownerUserKey: "owner",
    path: path.join(root, "project-cache"),
    repository: { defaultBranch: "main", mode: "managed_git" },
    repositoryMode: "managed_git",
    slug: "project"
  };
  const records = createVibe64SessionStore({
    logger: silentLogger,
    projectContextRoot: path.join(root, "authority"),
    projectRuntimeRoot: path.join(root, "runtime"),
    projectSessionSourceRoot: path.join(root, "managed")
  });
  await Promise.all(["authority", "runtime"].map(name => mkdir(path.join(root, name), { recursive: true })));
  const sessions = {};
  for (const sessionId of ["alpha", "beta"]) {
    await records.createSession({ metadata: {}, runtimeKind: "genesis", sessionId });
    const metadata = {
      assistant_routing: JSON.stringify({ mode: "auto", afterPlan: AFTER_PLAN, afterPlanDeep: [], autoSave: true }),
      assistant_routing_request: JSON.stringify({ submittedBy: PERSON })
    };
    const created = await createSessionSource({
      env: process.env,
      project: projectRecord,
      runCommand: commandRunner,
      runtime: { projectContextRoot: root, projectSessionSourceRoot: path.join(root, "sessions") },
      session: { sessionId },
      store: { mutateSession: (_id, write) => write(), writeMetadataValue: async (_id, name, value) => { metadata[name] = value; } }
    });
    sessions[sessionId] = { agentRuns: [], metadata, sessionId, sourcePath: created.sourcePath, status: "active" };
  }
  // The store's own background tasks, conversations and locks; each session and its metadata stay the fixture's.
  const store = {
    listSessionConversations: records.listSessionConversations,
    mutateSession: (_sessionId, operation) => operation(),
    readBackgroundTask: records.readBackgroundTask,
    readMetadataValue: async (sessionId, name) => sessions[sessionId].metadata[name] || "",
    readSession: async sessionId => sessions[sessionId],
    readSessionSourceDescriptor: async sessionId => sessions[sessionId],
    runSessionExclusive: records.runSessionExclusive,
    writeBackgroundTaskEvent: records.writeBackgroundTaskEvent,
    writeMetadataValue: async (sessionId, name, value) => { sessions[sessionId].metadata[name] = value; }
  };
  const runtime = {
    getSessionWithoutSource: async sessionId => sessions[sessionId],
    listSessionSummaries: async () => Object.values(sessions),
    store
  };
  const project = {
    createRuntimeWithoutSource: async () => runtime,
    readCurrentProject: async () => projectRecord,
    readRepositoryWorkflow: async () => ({ requirePullRequest: false }),
    runProjectSourceExclusive: operation => operation()
  };
  const state = createServiceState({ readClaudeAccountStatus: async () => ({ loggedIn: false }) });
  const sessionAccess = createServiceSessionAccess({ logger: silentLogger, project, publishSessionChanged: {} });
  const codexGitCommand = { sessionWorkSaveContext: async () => ({ commandOptions: {}, runCommand: commandRunner }) };
  const terminalWork = createServiceSessionWork({
    agentConversations: {},
    codexGitCommand,
    env: {},
    logger: silentLogger,
    project,
    sessionAccess,
    sessionAgent: {},
    state,
    workspacePreparation: { invalidateWorkspaceSetup: async () => {}, waitForRunningPreparation: async () => false },
    workspaceSetup: { isRunning: () => false }
  });
  const inspection = createServiceSessionWorkInspection({ codexGitCommand, env: {}, project, sessionAccess, sessionWork: terminalWork });
  const steers = [];
  const noteMainChat = createMainChatNote({
    assistantContext: { assistantSessionOptions: async (_sessionId, options) => ({ ...options, runtime }) },
    logger: silentLogger,
    async sendAgentMessage(_sessionId, message) {
      steers.push(message);
      return { delivered: true };
    },
    sessionAgent: { sessionState: async sessionId => ({ turn: { active: sessions[sessionId].agentRuns.length > 0 } }) }
  });
  const terminals = {
    checkSessionUpdates: inspection.checkSessionUpdates,
    inspectSessionUpdateFailure: inspection.inspectSessionUpdateFailure,
    inspectSessionWork: inspection.inspectSessionWork,
    noteMainChat,
    recoverSessionWorkSave: terminalWork.recoverSessionWorkSave,
    recoverSessionWorkUpdate: terminalWork.recoverSessionWorkUpdate,
    retireSessionWorkSave: terminalWork.retireSessionWorkSave,
    saveSessionWork: terminalWork.saveSessionWork,
    updateSessionWork: terminalWork.updateSessionWork
  };
  const workOperations = createSessionWorkOperations();
  const workspaceSetup = { prepareUpdatedWorkspace: async () => {} };
  const repositoryUpdates = createSessionRepositoryUpdates({ project, publishSessionChanged: async () => {}, terminals, workOperations });
  const work = createSessionWork({
    project,
    publishSessionChanged: async () => {},
    recovery: createSessionWorkRecovery({ terminals, workOperations, workspaceSetup }),
    repositoryUpdates,
    terminals,
    workOperations,
    workspaceSetup
  });
  // As the sessions feature fills the terminals' slots.
  const slots = createServiceHostSlots({ state });
  slots.setSessionUpdate(work.updateSessionWork);
  slots.setSessionSave(work.saveToCurrentDestination);
  const { agentSessionCommand } = createServiceCommandServices({
    env: {},
    inspectAssistantAccess: async () => ({}),
    logger: silentLogger,
    stagingEnvironmentProvider: {},
    project: {
      ...project,
      createSessionStore: async () => store,
      inspectWorkspaceSetup: async () => ({ diagnostics: [], status: "ready", steps: [] }),
      projectEnvironmentStatus: async () => ({ status: "ready" }),
      runInProjectContext: (_slug, operation) => operation()
    },
    projectServices: { assertOpen() {}, ensure: async () => ({}) },
    publishAgentSessionChanged: async () => {},
    publishSessionChanged: { outputTarget: async () => {} },
    recordWorkflowOutcome: async () => ({}),
    runCodexGitGatewayCommand: async () => ({}),
    savedEnvValueLinks: {},
    sendAgentMessage: async () => ({}),
    sessionAccess: {},
    state,
    workspacePreparation: {}
  });
  const helpers = {};
  for (const session of Object.values(sessions)) {
    const run = await sessionHelper(t, agentSessionCommand, session);
    helpers[session.sessionId] = async (args) => {
      const answer = await bounded(run(args), `${session.sessionId}: vibe64-helper session ${args.join(" ")}`);
      return { ...answer, json: args.includes("--json") && answer.stdout ? JSON.parse(answer.stdout) : null };
    };
  }
  return {
    canonical: ref => git(root, ["--git-dir", canonicalRepositoryPath, "rev-parse", ref]),
    canonicalFile: file => git(root, ["--git-dir", canonicalRepositoryPath, "show", `main:${file}`]),
    helpers,
    repositoryUpdates,
    runtime,
    sessions,
    steers
  };
}

test("two sessions of a project with no GitHub coordinate through its main: each saves its finished stage itself, the other updates onto it", async (t) => {
  const p = await twoSessions(t);
  const { alpha, beta } = p.sessions;
  const initial = await p.canonical("main");
  await writeFile(path.join(beta.sourcePath, "beta-notes.txt"), "beta's own work\n");

  // Alpha's AI finished and checked a stage of its plan, and saves it from inside its own turn. Routing dispatches
  // the turn under the agent-write lock and releases it once the AI accepts the message.
  await writeFile(path.join(alpha.sourcePath, "feature.txt"), "alpha's finished stage\n");
  assert.equal((await runVibe64AgentWriteExclusive(p.runtime, "alpha", async () => "accepted", { operation: "assistant-operation" })).acquired, true);
  alpha.agentRuns = [{ active: true }];
  const saved = await p.helpers.alpha(["save", "--json"]);
  const turnStillRunning = alpha.agentRuns.length > 0;
  alpha.agentRuns = [];

  assert.equal(saved.code, 0, saved.stderr || saved.stdout);
  assert.equal(turnStillRunning, true, "the answer arrived while alpha's turn was running");
  const alphaCommit = await p.canonical("main");
  assert.notEqual(alphaCommit, initial);
  assert.deepEqual(
    [saved.json.status, saved.json.repositories, saved.json.savedFiles, saved.json.onSavedVersion],
    ["saved", [{ name: "this session", commit: short(alphaCommit) }], ["feature.txt"], true]
  );
  assert.match(saved.json.next, /Tell the other sessions you are working with \(vibe64-helper session message-project\)/u);
  assert.equal(await p.canonicalFile("feature.txt"), "alpha's finished stage");
  // The command's answer told the AI: no steer interrupts the command waiting for it, and no note waits either.
  assert.deepEqual(p.steers, []);
  assert.equal(alpha.metadata[MAIN_CHAT_NOTE_METADATA_KEY], undefined);
  assert.equal((await runVibe64AgentWriteExclusive(p.runtime, "alpha", async () => "free", { operation: "assistant-operation" })).acquired, true,
    "Save released alpha's agent-write lock");
  // Saved work is not saved twice.
  alpha.agentRuns = [{ active: true }];
  const again = await p.helpers.alpha(["save", "--json"]);
  alpha.agentRuns = [];
  assert.deepEqual([again.code, again.json.status], [1, "nothing_to_save"]);

  // Beta's update check, which the project's update probe runs once main moves, finds it behind alpha's save.
  assert.equal(beta.metadata.canonical_commit, alphaCommit, "alpha's Save told beta where main is now");
  await p.repositoryUpdates.checkSessionUpdates("beta", { force: true });
  const status = await p.helpers.beta(["status", "--json"]);
  assert.equal(status.code, 0, status.stderr);
  assert.deepEqual(
    [status.json.repository.updateFirst.reason, status.json.repository.updateFirst.behind, status.json.repository.updateFirst.canonicalCommit],
    ["behind", 1, alphaCommit]
  );
  assert.equal(status.json.tools.save, "vibe64-helper session save");

  // Beta's AI tries to save before updating: Save itself refuses, and the answer names the Update.
  beta.agentRuns = [{ active: true }];
  const early = await p.helpers.beta(["save", "--json"]);
  assert.deepEqual([early.code, early.json.status, early.json.code], [1, "update_first", "vibe64_session_save_update_required"]);
  assert.match(early.json.next, /^Run vibe64-helper session update first/u);
  assert.equal(await p.canonical("main"), alphaCommit, "a refused Save publishes nothing");

  const updated = await p.helpers.beta(["update", "--json"]);
  assert.equal(updated.code, 0, updated.stderr || updated.stdout);
  assert.deepEqual([updated.json.status, updated.json.changedFiles], ["updated", ["feature.txt"]]);
  assert.equal(await readFile(path.join(beta.sourcePath, "feature.txt"), "utf8"), "alpha's finished stage\n");
  assert.equal(await readFile(path.join(beta.sourcePath, "beta-notes.txt"), "utf8"), "beta's own work\n");

  const betaSaved = await p.helpers.beta(["save", "--json"]);
  beta.agentRuns = [];
  assert.equal(betaSaved.code, 0, betaSaved.stderr || betaSaved.stdout);
  const betaCommit = await p.canonical("main");
  assert.deepEqual([betaSaved.json.repositories[0].commit, betaSaved.json.savedFiles], [short(betaCommit), ["beta-notes.txt"]]);
  assert.equal(await git(beta.sourcePath, ["rev-parse", `${betaCommit}^`]), alphaCommit, "beta's save builds on alpha's");
  assert.equal(await p.canonicalFile("feature.txt"), "alpha's finished stage");
  assert.equal(await p.canonicalFile("beta-notes.txt"), "beta's own work");
  assert.equal(alpha.metadata.canonical_commit, betaCommit, "and alpha is told in turn");
});

test("while automatic save is off the command saves nothing, through the real Save", async (t) => {
  const p = await twoSessions(t);
  const { alpha } = p.sessions;
  const initial = await p.canonical("main");
  alpha.metadata.assistant_routing = JSON.stringify({ mode: "auto", afterPlan: AFTER_PLAN, afterPlanDeep: [], autoSave: false });
  await writeFile(path.join(alpha.sourcePath, "feature.txt"), "unsaved\n");
  alpha.agentRuns = [{ active: true }];

  const refused = await p.helpers.alpha(["save", "--json"]);

  assert.deepEqual([refused.code, refused.json.status, refused.json.code], [1, "not_allowed", "vibe64_agent_session_save_off"]);
  assert.equal(await p.canonical("main"), initial);
  assert.equal(await p.runtime.store.readBackgroundTask("alpha", "save-work"), null, "no Save started");
});
