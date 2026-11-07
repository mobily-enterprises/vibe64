// The open-sessions list asks each session whether an agent run is active, on
// every refresh. Agent-run files are never pruned while a session lives, so a
// list that read them all would cost more with every session and every run.
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import { syncBuiltinESMExports } from "node:module";
import path from "node:path";
import test from "node:test";

import { createVibe64SessionStore } from "../../packages/vibe64-runtime/src/server/sessionStore.js";
import { createSessionsService as createService } from "./vibe64SessionsTestHelpers.js";
import { projectRuntimeRoot, withTemporaryRoot } from "./vibe64TestHelpers.js";

const RUNS_PER_SESSION = 4;
const AGENT_RUNS = `${path.sep}agent-runs`;

async function listCounts(t, sessionCount) {
  return withTemporaryRoot(async (targetRoot) => {
    const store = createVibe64SessionStore({ projectContextRoot: targetRoot, projectRuntimeRoot: projectRuntimeRoot(targetRoot) });
    const sessionIds = Array.from({ length: sessionCount }, (_value, index) => `listed-${index}`);
    for (const sessionId of sessionIds) {
      await store.createSession({ runtimeKind: "genesis", sessionId });
      for (let run = 0; run < RUNS_PER_SESSION; run += 1) {
        await store.writeAgentRunEvent(sessionId, `run_${run}`, { patch: { state: "completed" } });
      }
    }
    const service = createService({
      project: {
        async createRuntimeWithoutSource() {
          return { listSessionSummaries: store.listSessionSummaries, store };
        },
        async developmentDatabasePolicy() { return { creation: {}, limits: {} }; }
      },
      terminals: {},
      setupRunner: { isRunning: () => false, wait: () => null }
    });

    let runFileReads = 0;
    const originalOpen = fs.open;
    const originalReadFile = fs.readFile;
    t.mock.method(fs, "open", async (...args) => {
      if (String(args[0]).includes(AGENT_RUNS)) runFileReads += 1;
      return originalOpen(...args);
    });
    t.mock.method(fs, "readFile", async (...args) => {
      if (String(args[0]).includes(AGENT_RUNS)) runFileReads += 1;
      return originalReadFile(...args);
    });
    syncBuiltinESMExports();
    const restore = () => { t.mock.restoreAll(); syncBuiltinESMExports(); };
    t.after(restore);
    try {
      const activity = async () => Object.fromEntries((await service.listSessions({})).sessions
        .map((session) => [session.sessionId, session.agentActivity.active]));
      const first = await activity();
      const firstReads = runFileReads;
      const second = await activity();
      const secondReads = runFileReads - firstReads;
      assert.deepEqual(first, Object.fromEntries(sessionIds.map((sessionId) => [sessionId, false])));
      assert.deepEqual(second, first);

      // A run written through the store shows at the next refresh.
      await store.writeAgentRunEvent(sessionIds[0], "run_active", { patch: { state: "active" } });
      const afterWrite = runFileReads;
      const third = await activity();
      assert.equal(third[sessionIds[0]], true);
      assert.equal(sessionIds.slice(1).every((sessionId) => third[sessionId] === false), true);
      return { firstReads, secondReads, writtenSessionReads: runFileReads - afterWrite };
    } finally {
      restore();
    }
  });
}

test("the open-sessions list reads each session's runs once, and a refresh reads none at 2 and at 20 sessions", async (t) => {
  const small = await listCounts(t, 2);
  const large = await listCounts(t, 20);
  assert.equal(small.firstReads, 2 * RUNS_PER_SESSION, "the first list reads each run file once");
  assert.equal(large.firstReads, 20 * RUNS_PER_SESSION, "the first list reads each run file once");
  assert.deepEqual([small.secondReads, large.secondReads], [0, 0], "a refresh must not read run files again");
  assert.deepEqual(
    [small.writtenSessionReads, large.writtenSessionReads],
    [RUNS_PER_SESSION + 1, RUNS_PER_SESSION + 1],
    "a run write rereads only its own session's runs"
  );
});
