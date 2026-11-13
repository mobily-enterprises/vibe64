import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { silentLogger } from "@jskit-ai/kernel/server/runtime/logger";

import { createAgentSessionCommandService } from "../../packages/vibe64-terminals/src/server/agentSessionCommand.js";
import { sessionCommandProject, sessionHelper } from "./agentSessionUpdateTestHelpers.js";

const PERSON = { id: "person-1" };
const OWN_COMMIT = "a".repeat(40);
const LIBRARY_COMMIT = "b".repeat(40);
const SAVED_COMMIT = "c".repeat(40);
const BASE_COMMIT = "d".repeat(40);

/**
 * A finished Update's result: its top level is the update check made afterwards (each copy's `behind` only), and
 * what the Update moved is its `updated`.
 * @param {object} updated
 */
function finished(updated) {
  return {
    ok: true,
    canonicalCommit: updated.canonicalCommit,
    connected: (updated.connected || []).map(({ name }) => ({ behind: 0, canonicalCommit: "", name })),
    updateAvailable: false,
    updated
  };
}

/**
 * The helper over a scripted Update: each call takes the next result, and records what the command asked for.
 * @param {import("node:test").TestContext} t
 */
async function scriptedUpdate(t, { previewRunning = false, results = [], setupStatus = "succeeded" } = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-agent-session-update-"));
  t.after(() => rm(root, { force: true, recursive: true }));
  const session = {
    metadata: { source_kind: "session_clone", source_path_authority: "managed_session_source" },
    sessionId: "session-1",
    sourcePath: path.join(root, "sessions", "active", "session-1", "source")
  };
  session.metadata.source_path = session.sourcePath;
  await mkdir(session.sourcePath, { recursive: true });
  const metadata = {
    assistant_routing_request: JSON.stringify({ submittedBy: PERSON }),
    workspace_setup: JSON.stringify({ status: setupStatus })
  };
  const calls = [];
  const previewChecks = [];
  const commandService = createAgentSessionCommandService({
    logger: silentLogger,
    previewStartedBefore: (sessionId, time) => {
      previewChecks.push({ sessionId, time });
      return previewRunning;
    },
    project: sessionCommandProject(session, { readMetadataValue: async (_sessionId, name) => metadata[name] || "" }),
    publishSessionChanged: async () => {},
    async updateSessionWork(sessionId, input) {
      calls.push({ calledAt: new Date().toISOString(), input, sessionId });
      const next = results.shift();
      if (next instanceof Error) throw next;
      return next;
    }
  });
  return { calls, helper: await sessionHelper(t, commandService, session), previewChecks };
}

test("session update runs the session's own Update for the person the AI works for, and says what moved and what follows", async (t) => {
  const f = await scriptedUpdate(t, {
    previewRunning: true,
    results: [finished({
      status: "updated",
      canonicalCommit: OWN_COMMIT,
      updatedPathCount: 2,
      updatedPaths: ["src/app.js", "README.md"],
      connected: [{ name: "library", status: "updated", canonicalCommit: LIBRARY_COMMIT, updatedPathCount: 1, updatedPaths: ["../connected/library/index.js"] }]
    })],
    setupStatus: "running"
  });

  const updated = await f.helper(["update"]);

  assert.equal(updated.code, 0, updated.stderr);
  assert.deepEqual(f.calls.map(({ input, sessionId }) => ({ input, sessionId })), [{
    input: { requestedByAgent: true, vibe64User: PERSON },
    sessionId: "session-1"
  }]);
  // Preview counts as running old code only when its process started before this Update began.
  assert.equal(f.previewChecks.length, 1);
  assert.ok(f.previewChecks[0].time <= f.calls[0].calledAt);
  assert.deepEqual(updated.stdout.trim().split("\n"), [
    `Updated: this session updated to ${OWN_COMMIT.slice(0, 12)}; library updated to ${LIBRARY_COMMIT.slice(0, 12)}. ` +
      "3 files changed: src/app.js, README.md, ../connected/library/index.js.",
    "Next: Re-read the changed files before editing them, and re-run any checks that touch them. " +
      "Workspace preparation is running for them: read vibe64-helper session status --json until workspaceSetup.status is no longer running before running checks. " +
      "Preview still runs the code from before Update: run vibe64-helper preview restart --wait."
  ]);
});

test("session update --json says when everything was already current, with nothing to re-read or restart", async (t) => {
  const f = await scriptedUpdate(t, {
    previewRunning: true,
    results: [finished({
      status: "already_current",
      canonicalCommit: OWN_COMMIT,
      updatedPathCount: 0,
      updatedPaths: [],
      connected: [{ name: "library", status: "already_current", canonicalCommit: LIBRARY_COMMIT, updatedPathCount: 0, updatedPaths: [] }]
    })]
  });

  const current = await f.helper(["update", "--json"]);

  assert.equal(current.code, 0, current.stderr);
  assert.deepEqual(JSON.parse(current.stdout), {
    sessionId: "session-1",
    ok: true,
    status: "already_current",
    message: "Already current: this session and its connected repositories have their saved versions. No file changed.",
    next: "",
    repositories: [
      { name: "this session", status: "already_current", commit: OWN_COMMIT.slice(0, 12) },
      { name: "library", status: "already_current", commit: LIBRARY_COMMIT.slice(0, 12) }
    ],
    changedFileCount: 0,
    changedFiles: [],
    preview: { restart: false }
  });
});

test("a connected repository's conflict names that repository and its files, how to repair them, and the --resolved run that applies the repair", async (t) => {
  const recovery = {
    baseCommit: BASE_COMMIT,
    canonicalCommit: SAVED_COMMIT,
    conflictPaths: ["../connected/library/index.js"],
    connectedRepository: "library",
    reviewId: "review-1"
  };
  const f = await scriptedUpdate(t, {
    results: [{
      ok: false,
      code: "vibe64_session_update_conflict",
      error: "1 file in connected repository library needs review before this session can update.",
      details: {
        conflictPaths: recovery.conflictPaths,
        conflictRecovery: recovery,
        connectedRepository: "library",
        undone: true,
        updated: { canonicalCommit: OWN_COMMIT, connected: [], status: "updated", updatedPathCount: 1, updatedPaths: ["src/app.js"] }
      }
    }, finished({
      status: "already_current",
      canonicalCommit: OWN_COMMIT,
      updatedPathCount: 0,
      updatedPaths: [],
      connected: [{ name: "library", status: "updated", canonicalCommit: SAVED_COMMIT, updatedPathCount: 1, updatedPaths: ["../connected/library/index.js"] }]
    })]
  });

  const conflicted = await f.helper(["update"]);

  assert.equal(conflicted.code, 1, "a conflict is not a finished Update");
  assert.deepEqual(conflicted.stdout.trim().split("\n"), [
    "Conflict: 1 file in connected repository library (../connected/library) conflicts with its saved version, so that repository was left unchanged: index.js. " +
      `Meanwhile this session updated to ${OWN_COMMIT.slice(0, 12)}. 1 file changed: src/app.js.`,
    "Next: In ../connected/library, each listed file still holds this session's version. Compare it with the saved version " +
      `(git show ${SAVED_COMMIT.slice(0, 12)}:<file>) and their common base (git show ${BASE_COMMIT.slice(0, 12)}:<file>), ` +
      "and edit it to keep both sides' intended changes. Then run vibe64-helper session update --resolved review-1, " +
      "which applies Update with the files as you left them. Re-read the changed files before editing them, and re-run any checks that touch them."
  ]);

  const repaired = JSON.parse((await f.helper(["update", "--resolved", "review-1", "--json"])).stdout);

  assert.deepEqual(f.calls[1].input, { requestedByAgent: true, reviewedConflictId: "review-1", vibe64User: PERSON });
  assert.equal(repaired.status, "updated");
  assert.deepEqual(repaired.changedFiles, ["../connected/library/index.js"]);
});

test("every other refusal or failure is failed, with Update's own message and one next step", async (t) => {
  const f = await scriptedUpdate(t, {
    results: [
      { ok: false, code: "vibe64_agent_write_mode_busy", error: "This session is being saved. Try again when Save finishes.", retryable: true },
      { ok: false, code: "vibe64_session_update_history_diverged", error: "This session's history was rewritten." },
      { ok: false, code: "vibe64_session_update_ignored_file", error: "Update would overwrite the ignored file .env." },
      // A finished Update that does not say what it moved is not "already current".
      { ok: true, connected: [], updateAvailable: false },
      new Error("The active Vibe64 session source is unavailable.")
    ]
  });

  const answers = [];
  for (let index = 0; index < 4; index += 1) {
    const answer = await f.helper(["update", "--json"]);
    assert.equal(answer.code, 1);
    answers.push(JSON.parse(answer.stdout));
  }

  const next = "Read what it says. If something else is running, run vibe64-helper session update again in a moment. " +
    "If the cause is in this session's files, fix it and run it again. Otherwise tell the person what it says.";
  assert.deepEqual(answers.map(({ code, message, next: step, status }) => ({ code, message, next: step, status })), [
    { code: "vibe64_agent_write_mode_busy", message: "This session is being saved. Try again when Save finishes.", next, status: "failed" },
    { code: "vibe64_session_update_history_diverged", message: "This session's history was rewritten.", next, status: "failed" },
    { code: "vibe64_session_update_ignored_file", message: "Update would overwrite the ignored file .env.", next, status: "failed" },
    { code: "", message: "Update finished without saying what it moved.", next, status: "failed" }
  ]);
  // A command that never reached Update reports its own failure.
  const unreached = await f.helper(["update"]);
  assert.deepEqual([unreached.code, unreached.stdout, unreached.stderr.trim()], [1, "", "The active Vibe64 session source is unavailable."]);
});

test("session update refuses arguments it does not take before running Update", async (t) => {
  const f = await scriptedUpdate(t);
  for (const args of [["update", "now"], ["update", "--resolved"], ["update", "--resolved", "--json"], ["update", "--json", "--json"]]) {
    const refused = await f.helper(args);
    assert.equal(refused.code, 2, args.join(" "));
    assert.match(refused.stderr, /update \[--resolved <review-id>\] \[--json\]/u);
  }
  assert.deepEqual(f.calls, []);
});
