import assert from "node:assert/strict";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import { runVibe64AgentWriteExclusive } from "../../packages/vibe64-runtime/src/server/agentWriteLock.js";
import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { createSessionWork } from "../../packages/vibe64-sessions/src/server/sessionWork.js";
import { createSessionWorkOperations } from "../../packages/vibe64-sessions/src/server/sessionWorkOperations.js";
import { createMainChatNote, MAIN_CHAT_NOTE_METADATA_KEY } from "../../packages/vibe64-terminals/src/server/mainChatNote.js";
import { createServiceCommandServices } from "../../packages/vibe64-terminals/src/server/serviceCommandServices.js";
import { createServiceHostSlots } from "../../packages/vibe64-terminals/src/server/serviceHostSlots.js";
import { createServiceSessionAccess } from "../../packages/vibe64-terminals/src/server/serviceSessionAccess.js";
import { createServiceState } from "../../packages/vibe64-terminals/src/server/serviceState.js";
import { sessionCommandProject, sessionHelper } from "./agentSessionUpdateTestHelpers.js";
import {
  commitInCopy,
  copyPath,
  fixture,
  git,
  githubRepository,
  prepare,
  pushPeer,
  SESSION_ID,
  sessionService
} from "./connectedCopiesTestHelpers.js";

const PERSON = { id: "person-1" };
// Update runs Git on a few small repositories; far past that, it is waiting for something it must not wait for.
const UPDATE_BOUND_MS = 30_000;

/**
 * Settles with `work`, or fails naming `waitingFor` once the bound passes.
 * @param {Promise<unknown>} work
 * @param {string} waitingFor
 */
async function bounded(work, waitingFor) {
  let timer;
  const bound = new Promise((_resolve, reject) => {
    timer = setTimeout(() => reject(new Error(`Still waiting after ${UPDATE_BOUND_MS} ms: ${waitingFor}`)), UPDATE_BOUND_MS);
  });
  try {
    return await Promise.race([work, bound]);
  } finally {
    clearTimeout(timer);
  }
}

/**
 * A session over real Git (its own repository and a connected copy `library`) with its real session store
 * records and agent-write lock; the sessions' own Update over the terminals' Update; and
 * `vibe64-helper session update` over the session command the terminals compose, with the sessions' Update in
 * its slot. `turn.active` is whether the main chat's turn runs; `steers` are the notes sent into a running turn.
 * @param {import("node:test").TestContext} t
 */
async function updatableSession(t) {
  const f = await fixture(t);
  const library = await githubRepository(f, "library");
  await prepare(f, ["library"]);
  const records = createVibe64SessionStore({
    logger: silentLogger,
    projectContextRoot: path.join(f.root, "authority"),
    projectRuntimeRoot: path.join(f.root, "runtime"),
    projectSessionSourceRoot: path.join(f.root, "managed")
  });
  await Promise.all(["authority", "runtime"].map((name) => mkdir(path.join(f.root, name), { recursive: true })));
  await records.createSession({ metadata: {}, runtimeKind: "genesis", sessionId: SESSION_ID });
  // The store's own background tasks, conversations and locks; the session and its metadata stay the fixture's.
  Object.assign(f.store, {
    listSessionConversations: records.listSessionConversations,
    readBackgroundTask: records.readBackgroundTask,
    runSessionExclusive: records.runSessionExclusive,
    writeBackgroundTaskEvent: records.writeBackgroundTaskEvent
  });
  const service = await sessionService(f, {
    sessionAccess: (runtime) => createServiceSessionAccess({
      logger: silentLogger,
      project: { createRuntimeWithoutSource: async () => runtime },
      publishSessionChanged: {}
    })
  });
  const turn = { active: false };
  const steers = [];
  const noteMainChat = createMainChatNote({
    assistantContext: { assistantSessionOptions: async (_sessionId, options) => ({ ...options, runtime: service.runtime }) },
    logger: silentLogger,
    async sendAgentMessage(_sessionId, message) {
      steers.push(message);
      return { delivered: true };
    },
    sessionAgent: { sessionState: async () => ({ turn: { active: turn.active } }) }
  });
  const work = createSessionWork({
    project: { createRuntimeWithoutSource: async () => service.runtime },
    publishSessionChanged: async () => {},
    recovery: {},
    repositoryUpdates: {},
    terminals: {
      inspectSessionWork: service.inspection.inspectSessionWork,
      noteMainChat,
      updateSessionWork: service.work.updateSessionWork
    },
    workOperations: createSessionWorkOperations(),
    workspaceSetup: { prepareUpdatedWorkspace: async () => {} }
  });
  const state = createServiceState({ readClaudeAccountStatus: async () => ({ loggedIn: false }) });
  // As the sessions feature fills the terminals' slot.
  createServiceHostSlots({ state }).setSessionUpdate(work.updateSessionWork);
  const { agentSessionCommand } = createServiceCommandServices({
    env: {},
    inspectAssistantAccess: async () => ({}),
    logger: silentLogger,
    productionEnvironmentProvider: {},
    project: sessionCommandProject(f.session, f.store),
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
  f.session.metadata.assistant_routing_request = JSON.stringify({ submittedBy: PERSON });
  return {
    f,
    helper: await sessionHelper(t, agentSessionCommand, f.session),
    library,
    own: service.own,
    runtime: service.runtime,
    steers,
    turn
  };
}

const short = commit => commit.slice(0, 12);

test("session update brings this session and its connected repository onto their saved versions, then finds them current", async (t) => {
  const s = await updatableSession(t);
  const ownSaved = await pushPeer(s.own, "peer.txt", "peer\n");
  const librarySaved = await pushPeer(s.library, "news.txt", "news\n");

  const updated = await s.helper(["update"]);

  assert.equal(updated.code, 0, updated.stderr || updated.stdout);
  assert.equal(updated.stdout.trim().split("\n")[0],
    `Updated: this session updated to ${short(ownSaved)}; library updated to ${short(librarySaved)}. ` +
    "2 files changed: peer.txt, ../connected/library/news.txt.");
  assert.match(updated.stdout, /^Next: Re-read the changed files before editing them/mu);
  assert.equal(await readFile(path.join(s.f.session.sourcePath, "peer.txt"), "utf8"), "peer\n");
  assert.equal(await readFile(path.join(copyPath(s.f, "library"), "news.txt"), "utf8"), "news\n");
  assert.equal(s.f.session.metadata.canonical_commit, ownSaved);
  assert.equal((await s.runtime.store.readBackgroundTask(SESSION_ID, "update-session")).status, "ready",
    "the session's Update record is the one its Update notice shows");

  const current = JSON.parse((await s.helper(["update", "--json"])).stdout);

  assert.deepEqual([current.ok, current.status, current.changedFileCount, current.preview], [true, "already_current", 0, { restart: false }]);
  assert.deepEqual(current.repositories.map(({ name, status }) => [name, status]),
    [["this session", "already_current"], ["library", "already_current"]]);
});

test("a conflict in a connected repository leaves it unchanged and names it, and the --resolved run applies the AI's repair", async (t) => {
  const s = await updatableSession(t);
  const before = await commitInCopy(s.f, "library", "library.txt", "session\n");
  const librarySaved = await pushPeer(s.library, "library.txt", "peer\n");
  const ownSaved = await pushPeer(s.own, "peer.txt", "peer\n");

  const conflicted = await s.helper(["update", "--json"]);
  const answer = JSON.parse(conflicted.stdout);

  assert.equal(conflicted.code, 1);
  assert.equal(answer.status, "conflict");
  assert.deepEqual(answer.conflict, {
    repository: "library",
    directory: "../connected/library",
    files: ["library.txt"],
    savedCommit: librarySaved,
    baseCommit: s.library.base,
    reviewId: answer.conflict.reviewId
  });
  assert.ok(answer.conflict.reviewId);
  assert.match(answer.next, new RegExp(`vibe64-helper session update --resolved ${answer.conflict.reviewId}, `, "u"));
  assert.match(answer.message, new RegExp(`Meanwhile this session updated to ${short(ownSaved)}\\. 1 file changed: peer\\.txt\\.`, "u"));
  assert.equal(await git(copyPath(s.f, "library"), ["rev-parse", "HEAD"]), before, "the conflicting copy is unchanged");
  assert.equal(await readFile(path.join(copyPath(s.f, "library"), "library.txt"), "utf8"), "session\n", "with no conflict markers");

  // The AI repairs the file as the answer says, then applies the repair.
  await writeFile(path.join(copyPath(s.f, "library"), "library.txt"), "peer and session\n");
  const repaired = await s.helper(["update", "--resolved", answer.conflict.reviewId]);

  assert.equal(repaired.code, 0, repaired.stderr || repaired.stdout);
  assert.match(repaired.stdout, new RegExp(`library updated to ${short(librarySaved)}`, "u"));
  assert.equal(await git(copyPath(s.f, "library"), ["rev-parse", "HEAD"]), librarySaved);
  assert.equal(await readFile(path.join(copyPath(s.f, "library"), "library.txt"), "utf8"), "peer and session\n");
});

test("the AI's own turn runs session update and gets its answer while the turn still runs, with its unsaved edits kept and no steer", async (t) => {
  const s = await updatableSession(t);
  const ownSaved = await pushPeer(s.own, "peer.txt", "peer\n");
  // The AI's unsaved work: an edited tracked file and a new one.
  await writeFile(path.join(s.f.session.sourcePath, "project.txt"), "the AI's edit\n");
  await writeFile(path.join(s.f.session.sourcePath, "draft.md"), "unsaved draft\n");
  // Routing dispatches a turn under the agent-write lock and releases it once the AI accepts the message; the turn
  // then runs, and ends only after the command it runs has answered.
  const dispatched = await runVibe64AgentWriteExclusive(s.runtime, SESSION_ID, async () => "accepted", { operation: "assistant-operation" });
  assert.equal(dispatched.acquired, true);
  s.turn.active = true;
  s.f.session.agentRuns = [{ active: true }];
  const turnEnd = (async () => {
    const answer = await s.helper(["update", "--json"]);
    const stillRunning = s.turn.active;
    s.turn.active = false;
    s.f.session.agentRuns = [];
    return { answer, stillRunning };
  })();

  const { answer, stillRunning } = await bounded(turnEnd, "session update from inside the AI's own turn");

  assert.equal(stillRunning, true, "the answer arrived while the turn was running");
  assert.equal(answer.code, 0, answer.stderr || answer.stdout);
  const result = JSON.parse(answer.stdout);
  assert.deepEqual([result.status, result.changedFiles], ["updated", ["peer.txt"]]);
  assert.equal(await git(s.f.session.sourcePath, ["merge-base", "--is-ancestor", ownSaved, "HEAD"]), "");
  assert.equal(await readFile(path.join(s.f.session.sourcePath, "project.txt"), "utf8"), "the AI's edit\n");
  assert.equal(await readFile(path.join(s.f.session.sourcePath, "draft.md"), "utf8"), "unsaved draft\n");
  assert.equal(await readFile(path.join(s.f.session.sourcePath, "peer.txt"), "utf8"), "peer\n");
  // The command's answer told the AI; a steer would interrupt the very command waiting for it. The note still
  // waits for the next main-chat message.
  assert.deepEqual(s.steers, []);
  assert.match(s.f.session.metadata[MAIN_CHAT_NOTE_METADATA_KEY], /These files changed: peer\.txt\./u);
  const released = await runVibe64AgentWriteExclusive(s.runtime, SESSION_ID, async () => "free", { operation: "assistant-operation" });
  assert.equal(released.acquired, true, "Update released the session's agent-write lock");
});
