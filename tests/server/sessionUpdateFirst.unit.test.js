import assert from "node:assert/strict";
import test from "node:test";
import { sessionUpdateFirst, sessionUpdateFirstRepairBrief } from "@local/vibe64-core/shared";

const saved = "a".repeat(40);
const behindCheck = {
  ahead: 1,
  behind: 7,
  canonicalCommit: saved,
  checkedAt: "2026-11-03T12:00:00.000Z",
  incomingVersions: [
    { commit: "b".repeat(40), message: "Upgrade every JSKIT package to 0.3.0\n\nWith the lockfile." },
    { commit: "c".repeat(40), message: "Port the racing pages to typed features" }
  ],
  incomingVersionsTruncated: true
};

test("Update owns a session while its Update failed, runs or is pending, and not once it is current", () => {
  assert.equal(sessionUpdateFirst(), null);
  assert.equal(sessionUpdateFirst({ updateCheck: "not json" }), null);
  assert.equal(sessionUpdateFirst({ updateCheck: { ...behindCheck, behind: 0, incomingVersions: [] } }), null);
  assert.equal(sessionUpdateFirst({ updateCheck: { behind: 0 }, updateOperation: { status: "ready" } }), null);
  assert.equal(sessionUpdateFirst({ updateCheck: JSON.stringify(behindCheck) }).reason, "behind");
  for (const status of ["queued", "running", "starting"]) {
    assert.equal(sessionUpdateFirst({ updateOperation: { status } }).reason, "running", status);
  }
  const failed = sessionUpdateFirst({ updateCheck: behindCheck, updateOperation: {
    status: "failed", error: "2 files need review.", conflictPaths: ["package.json", "", "package-lock.json"]
  } });
  assert.deepEqual({ ...failed, message: undefined }, {
    reason: "failed",
    behind: 7,
    branch: "main",
    canonicalCommit: saved,
    incomingVersions: [
      { shortCommit: "bbbbbbbb", message: "Upgrade every JSKIT package to 0.3.0\n\nWith the lockfile." },
      { shortCommit: "cccccccc", message: "Port the racing pages to typed features" }
    ],
    incomingVersionsTruncated: true,
    conflictPaths: ["package.json", "package-lock.json"],
    error: "2 files need review.",
    message: undefined
  });
});

test("a repair brief names the incoming versions, takes superseded local work from the saved version and asks no unanswerable question", () => {
  assert.equal(sessionUpdateFirstRepairBrief(null), "");
  const state = sessionUpdateFirst({ updateCheck: behindCheck });
  const setup = sessionUpdateFirstRepairBrief(state);
  assert.match(setup, /^\[Vibe64 saved version\]\nThis session is 7 versions behind main \(aaaaaaaa\)\.\n/);
  assert.match(setup, /\n- bbbbbbbb Upgrade every JSKIT package to 0\.3\.0\n- cccccccc Port the racing pages to typed features\n- …and 5 more\n/);
  assert.match(setup, /check read-only whether the saved version already contains that change \(`git log HEAD\.\.aaaaaaaaaaaa`/);
  assert.match(setup, /stale or partial dependency bump it completes, is resolved by taking the saved version/);
  assert.match(setup, /do not ask the person to choose: Vibe64's checkpoint keeps the original\. Ask only about genuine product decisions\./);
  assert.match(setup, /Update owns this session until it succeeds\. When this repair concerns project setup, workspace preparation, verification, dependencies or code the saved version may already port, do not repair it in this chat now/);
  assert.match(setup, /Any other repair continues without redoing saved work\./);
  assert.match(setup, /\n\[End Vibe64 saved version\]$/);
  const update = sessionUpdateFirstRepairBrief(sessionUpdateFirst({ updateCheck: behindCheck,
    updateOperation: { status: "failed", conflictPaths: ["package.json"], error: "1 file needs review." } }), { updateRepair: true });
  assert.match(update, /^\[Vibe64 saved version\]\nThis session's Update failed on: package\.json\. 1 file needs review\.\n/);
  assert.match(update, /Update is this repair\. Prepare it so Update succeeds; Vibe64 will check Update after the repair\./);
  assert.doesNotMatch(update, /do not repair it in this chat now/);
});

test("a session behind main is told how many newer saved versions, when, from which session and how many files, and that Update keeps its work", () => {
  const savedAt = new Date(Date.now() - 12.5 * 60_000).toISOString();
  const state = sessionUpdateFirst({ updateCheck: {
    behind: 1,
    canonicalCommit: saved,
    checkedAt: new Date().toISOString(),
    incomingFileCount: 2,
    incomingVersions: [{ commit: "d".repeat(40), committedAt: savedAt, message: "Filter the list",
      savedBy: { savedAt, sessionId: "2026-1125-0811-passes", sessionName: "Passes" } }]
  } });
  assert.equal(state.reason, "behind");
  assert.equal(state.message, "Main has 1 newer saved version (12 minutes ago, from the Passes session, 2 files). " +
    "Update this session to take it in (any unsaved work stays) before saving. Setup is checked again against the updated session.");
  // Which session saved each version is Save's own record, so the AI answers from it instead of guessing.
  assert.deepEqual(state.incomingVersions, [{ shortCommit: "dddddddd", message: "Filter the list", savedAt, savedBy: "Passes" }]);
  assert.doesNotMatch(state.message, /merge/iu);
  // A version no Save of this workspace recorded names nobody.
  const unknown = sessionUpdateFirst({ updateCheck: { ...behindCheck, incomingFileCount: 9 } });
  assert.equal(unknown.message, "Main has 7 newer saved versions (9 files). " +
    "Update this session to take them in (any unsaved work stays) before saving. Setup is checked again against the updated session.");
  assert.equal(unknown.incomingVersions.some(entry => Object.hasOwn(entry, "savedBy")), false);
});
