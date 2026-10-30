import assert from "node:assert/strict";
import { mkdtemp, readdir, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ACTION_LIST_SESSIONS,
  ACTION_UPDATE_CURRENT_SESSION,
  createSessionActions
} from "../../packages/vibe64-sessions/src/server/actions.js";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";

const ada = Object.freeze({ uid: 1001, username: "ada" });
const bob = Object.freeze({ uid: 1002, username: "bob" });

async function withProjects(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-last-opened-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

// A project whose runtime keeps its state under stateRoot and lists the given
// open sessions; the current-session alias accepts any listed session.
function projectService(stateRoot, { pinned = "", sessionIds = ["s1", "s2", "s3"] } = {}) {
  const project = {
    sessionIds: [...sessionIds],
    async createRuntime() {
      return {
        stateRoot,
        store: { async readAgentRuns() { return []; } },
        async listSessionSummaries() {
          return project.sessionIds.map((sessionId) => ({ sessionId, status: "active", revision: 1 }));
        },
        async updateCurrentSession(sessionId) {
          if (sessionId && !project.sessionIds.includes(sessionId)) {
            throw Object.assign(new Error(`Vibe64 session cannot be selected: ${sessionId}`), { code: "vibe64_session_not_selectable" });
          }
          return { sessionId: pinned || sessionId };
        }
      };
    },
    async developmentDatabasePolicy() { return { creation: {}, limits: {} }; }
  };
  const service = createService({
    project,
    terminals: {},
    workspaceSetupRunner: { isRunning: () => false, wait: () => null }
  });
  return { project, service };
}

async function recordFiles(stateRoot) {
  try {
    return await readdir(path.join(stateRoot, "last-opened-sessions"));
  } catch (error) {
    if (error.code === "ENOENT") return [];
    throw error;
  }
}

async function lastOpened(service, vibe64User) {
  const result = await service.listSessions(vibe64User ? { vibe64User } : {});
  assert.equal(result.ok, true);
  return result.lastOpenedSessionId;
}

test("opening or switching to a session remembers it as that person's last one", async () => {
  await withProjects(async (root) => {
    const { service } = projectService(path.join(root, "alpha"));
    assert.equal(await lastOpened(service, ada), "");
    assert.equal((await service.updateCurrentSession("s1", { vibe64User: ada })).ok, true);
    assert.equal(await lastOpened(service, ada), "s1");
    await service.updateCurrentSession("s3", { vibe64User: ada });
    assert.equal(await lastOpened(service, ada), "s3");
  });
});

test("each person keeps one record per project, independent of other people and projects", async () => {
  await withProjects(async (root) => {
    const alpha = projectService(path.join(root, "alpha")).service;
    const beta = projectService(path.join(root, "beta")).service;
    await alpha.updateCurrentSession("s3", { vibe64User: ada });
    await alpha.updateCurrentSession("s1", { vibe64User: bob });
    await beta.updateCurrentSession("s2", { vibe64User: ada });
    assert.equal(await lastOpened(alpha, ada), "s3");
    assert.equal(await lastOpened(alpha, bob), "s1");
    assert.equal(await lastOpened(beta, ada), "s2");
    assert.equal(await lastOpened(beta, bob), "");
    // The standalone editor has no signed-in person; it keeps its own record.
    assert.equal(await lastOpened(alpha), "");
    await alpha.updateCurrentSession("s2");
    assert.equal(await lastOpened(alpha), "s2");
    assert.equal(await lastOpened(alpha, ada), "s3");
    assert.equal((await recordFiles(path.join(root, "alpha"))).length, 3);
  });
});

test("a remembered session that is archived, missing or damaged is not offered", async () => {
  await withProjects(async (root) => {
    const stateRoot = path.join(root, "alpha");
    const { project, service } = projectService(stateRoot);
    await service.updateCurrentSession("s3", { vibe64User: ada });
    project.sessionIds = ["s1", "s2"];
    assert.equal(await lastOpened(service, ada), "");
    await service.updateCurrentSession("s1", { vibe64User: ada });
    assert.equal(await lastOpened(service, ada), "s1");
    const [file] = await recordFiles(stateRoot);
    await writeFile(path.join(stateRoot, "last-opened-sessions", file), "{not json");
    assert.equal(await lastOpened(service, ada), "");
  });
});

test("a refused selection is not remembered", async () => {
  await withProjects(async (root) => {
    const stateRoot = path.join(root, "alpha");
    const { service } = projectService(stateRoot);
    await service.updateCurrentSession("s2", { vibe64User: ada });
    const refused = await service.updateCurrentSession("gone", { vibe64User: ada });
    assert.equal(refused.ok, false);
    assert.equal(await lastOpened(service, ada), "s2");
    // Clearing the project's alias (no sessions left) keeps the person's record.
    await service.updateCurrentSession("", { vibe64User: ada });
    assert.equal(await lastOpened(service, ada), "s2");
  });
});

test("a pinned project still remembers the session the person opened", async () => {
  await withProjects(async (root) => {
    const { service } = projectService(path.join(root, "alpha"), { pinned: "s1" });
    const result = await service.updateCurrentSession("s3", { vibe64User: ada });
    assert.equal(result.sessionId, "s1");
    assert.equal(await lastOpened(service, ada), "s3");
  });
});

test("publishing the remembered session again does not rewrite its record", async () => {
  await withProjects(async (root) => {
    const stateRoot = path.join(root, "alpha");
    const { service } = projectService(stateRoot);
    await service.updateCurrentSession("s3", { vibe64User: ada });
    const [file] = await recordFiles(stateRoot);
    const recordPath = path.join(stateRoot, "last-opened-sessions", file);
    const before = await stat(recordPath);
    await service.updateCurrentSession("s3", { vibe64User: ada });
    const unchanged = await stat(recordPath);
    assert.equal(unchanged.ino, before.ino);
    assert.equal(unchanged.mtimeMs, before.mtimeMs);
    await service.updateCurrentSession("s2", { vibe64User: ada });
    assert.notEqual((await stat(recordPath)).ino, before.ino);
    assert.deepEqual(await recordFiles(stateRoot), [file]);
  });
});

test("the list and current-session actions pass the signed-in person to the service", async () => {
  const calls = [];
  const actions = createSessionActions({
    sessions: {
      async listSessions(input) { calls.push(["list", input.vibe64User]); return { ok: true }; },
      async updateCurrentSession(sessionId, options) { calls.push(["current", sessionId, options.vibe64User]); return { ok: true }; }
    }
  });
  const context = { vibe64Action: { user: ada, project: { slug: "alpha" } } };
  await actions.find((action) => action.id === ACTION_LIST_SESSIONS).execute({ projectSlug: "alpha" }, context);
  await actions.find((action) => action.id === ACTION_UPDATE_CURRENT_SESSION).execute({ projectSlug: "alpha", sessionId: "s3" }, context);
  assert.deepEqual(calls, [["list", ada], ["current", "s3", ada]]);
});
