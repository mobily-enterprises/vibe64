import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { newerSavedFacts, newerSavedMessage } from "@local/vibe64-core/shared";
import { savedVersionsPath } from "../../packages/vibe64-core/src/server/savedVersions.js";
import { createSessionsService as createService } from "./vibe64SessionsTestHelpers.js";

// A session behind main is told which session saved the newer versions only from Save's own record, kept when each
// Save finishes; a version without a record, or a record Vibe64 cannot read, names nobody and blocks nothing.

const SAVED = "d".repeat(40);
const UPDATE_REQUIRED = "vibe64_session_save_update_required";

async function world(t, { checkResult = {} } = {}) {
  // The refusal the next Save meets, or null for a Save that goes ahead.
  const control = { saveError: null };
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-newer-saved-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const sessions = new Map([
    ["2026-1125-0811-passes", { agentRuns: [], metadata: { label: "Passes" }, sessionId: "2026-1125-0811-passes", status: "active" }],
    ["2026-1125-0802-inbox", { agentRuns: [], metadata: { label: "Inbox" }, sessionId: "2026-1125-0802-inbox", status: "active" }]
  ]);
  const tasks = new Map();
  const runtime = {
    stateRoot: root,
    async getSession(sessionId) {
      const session = sessions.get(sessionId);
      return session && { ...session, sessionName: session.metadata.label || sessionId };
    },
    getSessionWithoutSource(sessionId) { return this.getSession(sessionId); },
    async listSessionSummaries() { return [...sessions.keys()].map((sessionId) => ({ sessionId, status: "active" })); },
    store: {
      async listSessionConversations() { return []; },
      async readBackgroundTask(sessionId, taskId) { return tasks.get(`${sessionId}/${taskId}`) || null; },
      async readMetadataValue(sessionId, name) { return sessions.get(sessionId)?.metadata?.[name] || ""; },
      async writeBackgroundTaskEvent(sessionId, taskId, input) {
        const key = `${sessionId}/${taskId}`;
        const task = { ...(input.reset ? {} : tasks.get(key)), ...input.patch, events: [...(input.reset ? [] : tasks.get(key)?.events || []), input.event], id: taskId };
        tasks.set(key, task);
        return task;
      },
      async writeMetadataValue(sessionId, name, value) {
        const session = sessions.get(sessionId);
        session.metadata = { ...session.metadata, [name]: value };
      }
    }
  };
  const committedAt = new Date(Date.now() - 20_000).toISOString();
  const service = createService({
    project: {
      async readCurrentProject() { return { slug: "compas", repository: { mode: "managed_git", defaultBranch: "main" } }; },
      async createRuntime() { return runtime; },
      createRuntimeWithoutSource(options) { return this.createRuntime(options); }
    },
    terminals: {
      async requireAssistantAccess() { return { ok: true }; },
      async saveSessionWork(_sessionId, input) {
        await input.onRepositoryWriteAcquired();
        if (control.saveError) throw control.saveError({ committedAt });
        return { changedPaths: ["src/list.js", "tests/inbox.test.js"], reconciled: true, saveCommit: SAVED, status: "saved" };
      },
      async checkSessionUpdates() {
        return {
          ahead: 0, behind: 1, branch: "main", canonicalCommit: SAVED, incomingFileCount: 2,
          incomingVersions: [{ author: "Owner", commit: SAVED, committedAt, message: "Filter the list" }],
          incomingVersionsTruncated: false, ok: true, reconciled: false, sessionHead: "e".repeat(40), updateAvailable: true,
          ...checkResult
        };
      },
      async inspectSessionWork() {
        return { behind: 1, branch: "main", canonicalCommit: SAVED, changedPaths: ["src/inbox.js"], sessionHead: "e".repeat(40),
          unsaved: true, updateAvailable: true };
      }
    }
  });
  return { control, root, service, sessions, tasks };
}

function behindRefusal({ committedAt }) {
  const error = new Error("Main has 1 newer saved version (just now, 2 files). Update this session to take it in (your unsaved work stays), then Save.");
  error.code = UPDATE_REQUIRED;
  error.details = {
    canonicalCommit: SAVED,
    newerSaved: { behind: 1, branch: "main", incomingFileCount: 2, incomingVersions: [{ commit: SAVED, committedAt }] },
    updateRequired: true
  };
  return error;
}

test("a Save records which session saved its version, so another session's check names that session, by its current name", async (t) => {
  const { root, service, sessions } = await world(t);

  const saved = await service.saveSessionWork("2026-1125-0811-passes", {});
  assert.equal(saved.ok, true, saved.error);
  const recorded = JSON.parse(await readFile(savedVersionsPath(root), "utf8"));
  assert.deepEqual(recorded.saves.map(({ commit, sessionId, sessionName }) => ({ commit, sessionId, sessionName })),
    [{ commit: SAVED, sessionId: "2026-1125-0811-passes", sessionName: "Passes" }]);

  const check = await service.checkSessionUpdates("2026-1125-0802-inbox", { force: true });
  assert.equal(check.incomingVersions[0].savedBy.sessionId, "2026-1125-0811-passes");
  assert.equal(check.incomingVersions[0].savedBy.sessionName, "Passes");
  assert.match(newerSavedMessage(newerSavedFacts(check)),
    /^Main has 1 newer saved version \(just now, from the Passes session, 2 files\)\. Update this session to take it in \(your unsaved work stays\), then Save\.$/u);
  // The stored check carries it too, so the work answer, the tab and session status read the same.
  const stored = JSON.parse(sessions.get("2026-1125-0802-inbox").metadata.repository_update_check);
  assert.equal(stored.incomingFileCount, 2);
  assert.equal(stored.incomingVersions[0].savedBy.sessionName, "Passes");
  const work = await service.inspectSessionWork("2026-1125-0802-inbox", {});
  assert.equal(work.newerSaved.incomingVersions[0].savedBy.sessionName, "Passes");
  assert.equal(work.newerSaved.incomingFileCount, 2);

  sessions.get("2026-1125-0811-passes").metadata.label = "Passes and filters";
  const renamed = await service.checkSessionUpdates("2026-1125-0802-inbox", { force: true });
  assert.equal(renamed.incomingVersions[0].savedBy.sessionName, "Passes and filters");
});

test("Save behind main answers with the session that saved the newer version, and records it for the page in its own clock", async (t) => {
  const { control, service, tasks } = await world(t);
  assert.equal((await service.saveSessionWork("2026-1125-0811-passes", {})).ok, true);
  control.saveError = behindRefusal;

  const refused = await service.saveSessionWork("2026-1125-0802-inbox", {});

  assert.equal(refused.ok, false);
  assert.equal(refused.code, UPDATE_REQUIRED);
  assert.equal(refused.error, "Main has 1 newer saved version (just now, from the Passes session, 2 files). " +
    "Update this session to take it in (your unsaved work stays), then Save.");
  assert.equal(refused.details.newerSaved.incomingVersions[0].savedBy.sessionName, "Passes");
  const task = tasks.get("2026-1125-0802-inbox/save-work");
  assert.equal(task.events.at(-1).message, refused.error);
  assert.equal(task.details.newerSaved.incomingVersions[0].savedBy.sessionName, "Passes");
});

test("a corrupt record drops only the session's name: the check still gives the time and files, and Save goes on and rewrites it", async (t) => {
  const { root, service } = await world(t);
  await writeFile(savedVersionsPath(root), "{ not json");

  const check = await service.checkSessionUpdates("2026-1125-0802-inbox", { force: true });
  assert.equal(check.ok, true, check.error);
  assert.equal(Object.hasOwn(check.incomingVersions[0], "savedBy"), false);
  assert.equal(newerSavedMessage(newerSavedFacts(check)),
    "Main has 1 newer saved version (just now, 2 files). Update this session to take it in (your unsaved work stays), then Save.");

  const saved = await service.saveSessionWork("2026-1125-0811-passes", {});
  assert.equal(saved.ok, true, saved.error);
  assert.deepEqual(JSON.parse(await readFile(savedVersionsPath(root), "utf8")).saves.map((entry) => entry.commit), [SAVED]);
});
