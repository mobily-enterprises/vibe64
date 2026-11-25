import assert from "node:assert/strict";
import test from "node:test";
import { newerSavedFacts, newerSavedMessage, newerSavedSource, savedAgoText } from "@local/vibe64-core/shared";

const NOW = Date.parse("2026-11-25T00:23:00.000Z");
const passes = { savedAt: "2026-11-25T00:11:00.000Z", sessionId: "2026-1125-0811-passes", sessionName: "Passes" };
const inbox = { savedAt: "2026-11-25T00:05:00.000Z", sessionId: "2026-1125-0750-inbox", sessionName: "Inbox" };
const version = (savedBy, committedAt = "2026-11-25T00:10:50.000Z") => ({ commit: "d".repeat(40), committedAt, ...(savedBy ? { savedBy } : {}) });
const clock = () => "8:11 AM";

test("one newer saved version says when, from which session and how many files, then names Update and Save", () => {
  const facts = newerSavedFacts({ behind: 1, branch: "main", incomingFileCount: 2, incomingVersions: [version(passes)] });
  assert.equal(newerSavedMessage(facts, { savedAtText: clock }),
    "Main has 1 newer saved version (8:11 AM, from the Passes session, 2 files). " +
    "Update this session to take it in (your unsaved work stays), then Save.");
  // A reader whose clock Vibe64 does not know reads how long ago, from Save's own record of when it saved.
  assert.equal(newerSavedMessage(facts, { savedAtText: (at) => savedAgoText(at, NOW) }),
    "Main has 1 newer saved version (12 minutes ago, from the Passes session, 2 files). " +
    "Update this session to take it in (your unsaved work stays), then Save.");
});

test("a version Save did not record names no session, and neither does a list with any such version", () => {
  const unknown = newerSavedFacts({ behind: 1, incomingFileCount: 1, incomingVersions: [version(null)] });
  assert.equal(newerSavedMessage(unknown, { savedAtText: (at) => savedAgoText(at, NOW) }),
    "Main has 1 newer saved version (12 minutes ago, 1 file). Update this session to take it in (your unsaved work stays), then Save.");
  const partial = newerSavedFacts({ behind: 2, incomingFileCount: 3, incomingVersions: [version(passes), version(null)] });
  assert.deepEqual(partial.savedBy, []);
  // Five listed of seven: the two not listed may be anyone's.
  const truncated = newerSavedFacts({ behind: 7, incomingVersions: Array.from({ length: 5 }, () => version(passes)) });
  assert.deepEqual(truncated.savedBy, []);
});

test("several newer versions give the latest time and every session that saved them", () => {
  const facts = newerSavedFacts({ behind: 3, incomingFileCount: 7,
    incomingVersions: [version(passes), version(inbox), version(passes)] });
  assert.equal(newerSavedMessage(facts, { savedAtText: clock }),
    "Main has 3 newer saved versions (latest 8:11 AM, from the Passes and Inbox sessions, 7 files). " +
    "Update this session to take them in (your unsaved work stays), then Save.");
  const unnamed = newerSavedFacts({ behind: 1, incomingVersions: [version({ ...passes, sessionName: "" })] });
  assert.match(newerSavedMessage(unnamed, { savedAtText: clock }), /\(8:11 AM, from session 1125-0811-passes\)/u);
  assert.match(newerSavedMessage(newerSavedFacts({ behind: 1, incomingVersions: [version(passes)] }),
    { savedAtText: clock, selfSessionId: passes.sessionId }), /\(8:11 AM, from this session\)/u);
});

test("a session with nothing unsaved is told to Update only, and one Vibe64 knows less about still names Update", () => {
  const facts = newerSavedFacts({ behind: 1, incomingVersions: [version(passes)] });
  assert.equal(newerSavedMessage(facts, { savedAtText: clock, unsaved: false }),
    "Main has 1 newer saved version (8:11 AM, from the Passes session). Update this session to take it in.");
  assert.equal(newerSavedMessage(facts, { savedAtText: clock, unsaved: null }),
    "Main has 1 newer saved version (8:11 AM, from the Passes session). Update this session to take it in (any unsaved work stays) before saving.");
  // Only a count, as a session's own reading of its saved branch gives it, or not even that.
  assert.equal(newerSavedMessage(newerSavedFacts({ behind: 2 })),
    "Main has 2 newer saved versions. Update this session to take them in (your unsaved work stays), then Save.");
  assert.equal(newerSavedMessage(newerSavedFacts({ branch: "develop" })),
    "Branch develop has newer saved work. Update this session to take it in (your unsaved work stays), then Save.");
  assert.equal(newerSavedMessage(null), "");
});

test("a connected copy behind its main is named, and the session's own repository comes first", () => {
  const check = { behind: 0, connected: [{ behind: 0, name: "genesis" }, { behind: 2, name: "jskit-ai" }] };
  assert.deepEqual(newerSavedSource(check), { behind: 2, name: "jskit-ai", repository: "jskit-ai" });
  assert.equal(newerSavedMessage(newerSavedFacts(newerSavedSource(check))),
    "In connected repository jskit-ai, main has 2 newer saved versions. Update this session to take them in (your unsaved work stays), then Save.");
  const own = { ...check, behind: 1 };
  assert.equal(newerSavedSource(own), own);
  assert.equal(newerSavedSource({ behind: 0, connected: [] }), null);
});

test("the message never suggests a merge", () => {
  for (const facts of [
    newerSavedFacts({ behind: 1, incomingFileCount: 2, incomingVersions: [version(passes)] }),
    newerSavedFacts({ behind: 4 }),
    newerSavedFacts({ behind: 1, repository: "jskit-ai" })
  ]) {
    for (const unsaved of [true, false, null]) {
      assert.doesNotMatch(newerSavedMessage(facts, { unsaved }), /merge|rebase|pull/iu);
    }
  }
});

test("how long ago reads in minutes, hours or days, and a time Vibe64 cannot read gives none", () => {
  assert.equal(savedAgoText("2026-11-25T00:22:40.000Z", NOW), "just now");
  assert.equal(savedAgoText("2026-11-25T00:22:00.000Z", NOW), "1 minute ago");
  assert.equal(savedAgoText("2026-11-24T21:23:00.000Z", NOW), "3 hours ago");
  assert.equal(savedAgoText("2026-11-23T00:23:00.000Z", NOW), "2 days ago");
  assert.equal(savedAgoText("not a time", NOW), "");
  assert.equal(newerSavedMessage(newerSavedFacts({ behind: 1, incomingVersions: [{ committedAt: "" }] })),
    "Main has 1 newer saved version. Update this session to take it in (your unsaved work stays), then Save.");
});

test("Fix it with AI's Save check gives Save's own words when main moved on, so the person reads Update, then Save", async () => {
  const { saveCheckResult } = await import("../../packages/vibe64-ai-tasks/src/server/kinds/save.js");
  const error = "Main has 1 newer saved version (12 minutes ago, 2 files). Update this session to take it in (your unsaved work stays), then Save.";
  const result = saveCheckResult({ ok: false, code: "vibe64_session_save_update_required", error });
  assert.equal(result.passed, false);
  assert.equal(result.message, `${error} Cancel this fix first.`);
  assert.equal(result.retryKey, "");
});
