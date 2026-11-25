import { describe, expect, it } from "vitest";
import { newerSavedText, savedClockText } from "../../src/lib/vibe64NewerSavedText.js";
import { summaryDetail, updateDetail } from "../../src/lib/vibe64RepositoryStatusText.js";
import {
  repositoryWorkStateDescription,
  sessionRepositoryWorkState
} from "../../src/lib/vibe64SessionRepositoryWorkState.js";

// The page says the one message for a session behind main in the person's own clock: how many newer saved versions,
// when the latest was saved, which session saved them when Save recorded it, how many files, then Update and Save.

const TIME = new Intl.DateTimeFormat(undefined, { hour: "numeric", minute: "2-digit" });
const DATE_TIME = new Intl.DateTimeFormat(undefined, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

function behindMain(savedAt = new Date().toISOString()) {
  return {
    ahead: 0,
    behind: 1,
    branch: "main",
    checkedAt: savedAt,
    incomingFileCount: 2,
    incomingVersions: [{ commit: "d".repeat(40), committedAt: savedAt, message: "Filter the list", shortCommit: "dddddddd",
      savedBy: { savedAt, sessionId: "2026-1125-0811-passes", sessionName: "Passes" } }],
    relationship: "behind",
    updateAvailable: true
  };
}

function statusState(status, unsaved) {
  return {
    changes: { error: "", loading: false, payload: { totalCount: 3, unsaved } },
    history: { loading: false, payload: null },
    repositoryStatus: status,
    sessionId: "2026-1125-0802-inbox",
    sessionUpdateLabel: "Update session from main",
    updates: { canonicalChangePending: false, checking: false, error: "", payload: status }
  };
}

describe("the newer saved versions message on the page", () => {
  it("reads the time in the person's own clock: today's as a time, earlier ones with their date", () => {
    const now = new Date(2026, 10, 25, 8, 30);
    const today = new Date(2026, 10, 25, 8, 11);
    const yesterday = new Date(2026, 10, 24, 17, 5);
    expect(savedClockText(today.toISOString(), now)).toBe(TIME.format(today));
    expect(savedClockText(yesterday.toISOString(), now)).toBe(DATE_TIME.format(yesterday));
    expect(savedClockText("never", now)).toBe("");
  });

  it("says how many, when, from which session and how many files, then names Update and Save", () => {
    const status = behindMain();
    const clock = TIME.format(new Date(status.incomingVersions[0].savedBy.savedAt));
    expect(newerSavedText(status, { unsaved: true })).toBe(
      `Main has 1 newer saved version (${clock}, from the Passes session, 2 files). ` +
      "Update this session to take it in (your unsaved work stays), then Save."
    );
    // Something newer that Vibe64 has not read yet still names Update.
    expect(newerSavedText(null, { branch: "main", fallback: true, unsaved: true })).toBe(
      "Main has newer saved work. Update this session to take it in (your unsaved work stays), then Save."
    );
    expect(newerSavedText(null, { unsaved: true })).toBe("");
  });

  it("the Changes page's summary and its Git log status give that message, and never a merge", () => {
    const status = behindMain();
    const clock = TIME.format(new Date(status.incomingVersions[0].savedBy.savedAt));
    const message = `Main has 1 newer saved version (${clock}, from the Passes session, 2 files).`;
    expect(summaryDetail(statusState(status, true))).toBe(`${message} Update this session to take it in (your unsaved work stays), then Save.`);
    expect(summaryDetail(statusState(status, false))).toBe(`${message} Update this session to take it in.`);
    expect(updateDetail(statusState(status, true))).toMatch(
      new RegExp(`^${message.replace(/[()]/gu, "\\$&")} Update this session to take it in \\(your unsaved work stays\\), then Save\\. Last checked `, "u")
    );
    expect(summaryDetail(statusState(status, true))).not.toMatch(/merge/iu);
  });

  it("the session's tab says it in its hover text, from the session's answer", () => {
    const status = behindMain();
    const clock = TIME.format(new Date(status.incomingVersions[0].savedBy.savedAt));
    const repositoryWorkState = sessionRepositoryWorkState({
      changedPaths: ["src/inbox.js"],
      checkedAt: status.checkedAt,
      newerSaved: status,
      unsaved: true,
      updateAvailable: true
    });
    expect(repositoryWorkStateDescription({ repositoryWorkState })).toBe(
      `1 change; update available: Main has 1 newer saved version (${clock}, from the Passes session, 2 files). ` +
      "Update this session to take it in (your unsaved work stays), then Save."
    );
    const saved = sessionRepositoryWorkState({ checkedAt: status.checkedAt, newerSaved: status, unsaved: false, updateAvailable: true });
    expect(repositoryWorkStateDescription({ repositoryWorkState: saved })).toBe(
      `Update available: Main has 1 newer saved version (${clock}, from the Passes session, 2 files). Update this session to take it in.`
    );
  });
});
