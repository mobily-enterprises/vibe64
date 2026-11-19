import assert from "node:assert/strict";
import { mkdtemp, mkdir, rm, symlink } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createVibe64SessionStore, VIBE64_AGENT_RUN_STATE } from "@local/vibe64-runtime/server/sessionStore";
import { vibe64AgentRunStateIsActive } from "@local/vibe64-runtime/server/sessionRecordRules";
import { resolveVibe64SessionPaths } from "@local/vibe64-runtime/server/sessionStoreLayout";
import {
  AGENT_RUNS_DIR,
  MAX_AGENT_RUN_BYTES,
  PROJECTS_DIR,
  readVibe64WorkingTurns,
  runStateIsActive
} from "@local/vibe64-runtime/server/workingTurns";
import { EXTERNAL_PROJECT_LOCAL_ROOTS_DIR } from "../../packages/vibe64-core/src/server/projectState.js";

// The working-turns reader (workingTurns.js) reads, from outside the editor, what the session list shows: the same
// run states are working, the runs are where the session store writes them, and a session's runs as the store
// writes them read as working exactly when the store's own reader says so.

const SECRET = "the-words-of-the-turn";

async function systemRoot(t) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-working-turns-"));
  t.after(() => rm(root, { recursive: true, force: true }));
  return root;
}

/** A project's session store, its runtime root where a system root keeps it. */
async function projectStore(root, projectSlug) {
  const projectRuntimeRoot = path.join(root, PROJECTS_DIR, projectSlug);
  const projectContextRoot = path.join(root, "sources", projectSlug);
  await mkdir(projectContextRoot, { recursive: true });
  const store = createVibe64SessionStore({ projectContextRoot, projectRuntimeRoot });
  const run = (sessionId, state, at, message = "") => store.writeAgentRunEvent(sessionId, "claude_stream_json", {
    event: { kind: `claude-${state}`, state, message, at },
    patch: { engineId: "claude", state, error: message, startedAt: at, updatedAt: at }
  });
  return { store, projectRuntimeRoot, run };
}

test("the reader's working run states are the session store's, a run with no state starting", () => {
  const states = [...Object.values(VIBE64_AGENT_RUN_STATE), "", "  "];
  assert.ok(states.length > 8);
  for (const state of states) assert.equal(runStateIsActive(state), vibe64AgentRunStateIsActive(state), JSON.stringify(state));
});

test("the reader finds a session's runs where the session store writes them", async (t) => {
  const root = await systemRoot(t);
  assert.equal(PROJECTS_DIR, EXTERNAL_PROJECT_LOCAL_ROOTS_DIR);
  const projectRuntimeRoot = path.join(root, PROJECTS_DIR, "demo");
  assert.equal(resolveVibe64SessionPaths({ projectRuntimeRoot, sessionId: "s1" }).agentRunsRoot,
    path.join(projectRuntimeRoot, "sessions", "active", "s1", AGENT_RUNS_DIR));
});

test("a session's Main chat reads as working exactly when the session store says, from its turn's start", async (t) => {
  const root = await systemRoot(t);
  const { store, run } = await projectStore(root, "demo");
  const sessionId = "2026-11-18_14-51-33";
  await store.createSession({ sessionId, runtimeKind: "genesis" });
  const agree = async (expected, label) => {
    assert.equal((await store.readAgentRunActivity(sessionId)).active, expected !== null, `store: ${label}`);
    const turns = await readVibe64WorkingTurns({ systemRoot: root });
    assert.deepEqual(turns, expected === null ? [] : [{ projectSlug: "demo", sessionId, startedAt: expected }], `reader: ${label}`);
    assert.equal(JSON.stringify(turns).includes(SECRET), false);
  };
  await agree(null, "no run yet");
  await run(sessionId, "starting", "2026-11-18T14:51:33.000Z");
  await agree("2026-11-18T14:51:33.000Z", "a turn starting");
  await run(sessionId, "active", "2026-11-18T14:51:35.000Z", SECRET);
  await agree("2026-11-18T14:51:33.000Z", "a turn working");
  await run(sessionId, "completed", "2026-11-18T14:53:00.000Z", SECRET);
  await agree(null, "the assistant at its prompt after the turn");
  await run(sessionId, "starting", "2026-11-18T23:10:00.000Z");
  await run(sessionId, "active", "2026-11-18T23:10:01.000Z");
  await run(sessionId, "finalizing", "2026-11-18T23:12:00.000Z");
  await agree("2026-11-18T23:10:00.000Z", "the next turn finalizing, from its own start, not the run's first");
  for (const [index, state] of ["cancelled", "failed", "interrupted", "timed_out"].entries()) {
    await run(sessionId, state, `2026-11-19T0${index}:00:00.000Z`, SECRET);
    await agree(null, state);
    await run(sessionId, "starting", `2026-11-19T0${index}:30:00.000Z`);
    await agree(`2026-11-19T0${index}:30:00.000Z`, `starting after ${state}`);
  }
});

test("each project's working sessions are listed, through no link, and a run too large to read counts as working", async (t) => {
  const root = await systemRoot(t);
  const demo = await projectStore(root, "demo");
  const other = await projectStore(root, "other");
  for (const sessionId of ["s1", "s2"]) await demo.store.createSession({ sessionId, runtimeKind: "genesis" });
  await other.store.createSession({ sessionId: "s3", runtimeKind: "genesis" });
  await demo.run("s1", "active", "2026-11-19T08:00:00.000Z");
  await demo.run("s2", "completed", "2026-11-19T08:01:00.000Z");
  await other.run("s3", "starting", "2026-11-19T08:02:00.000Z");
  const working = [
    { projectSlug: "demo", sessionId: "s1", startedAt: "2026-11-19T08:00:00.000Z" },
    { projectSlug: "other", sessionId: "s3", startedAt: "2026-11-19T08:02:00.000Z" }
  ];
  assert.deepEqual(await readVibe64WorkingTurns({ systemRoot: root }), working);
  // A linked project or session folder is not one of the system root's, and its runs are not read.
  await symlink(demo.projectRuntimeRoot, path.join(root, PROJECTS_DIR, "linked"));
  await symlink(path.join(demo.projectRuntimeRoot, "sessions/active/s1"), path.join(other.projectRuntimeRoot, "sessions/active/s9"));
  assert.deepEqual(await readVibe64WorkingTurns({ systemRoot: root }), working);
  // A run past the bound is not read; it may hold a turn, so it is not taken for ended.
  await demo.run("s2", "completed", "2026-11-19T08:03:00.000Z", "x".repeat(MAX_AGENT_RUN_BYTES));
  assert.equal((await demo.store.readAgentRunActivity("s2")).active, false);
  assert.deepEqual((await readVibe64WorkingTurns({ systemRoot: root }))[1], { projectSlug: "demo", sessionId: "s2", startedAt: null });
  await assert.rejects(readVibe64WorkingTurns({ systemRoot: "relative" }), /absolute system root/u);
});
