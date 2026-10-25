import { describe, expect, it } from "vitest";
import { sessionArchiveState } from "../../src/lib/vibe64SessionArchiveState.js";

function session(metadata = {}) {
  return { sessionId: "session-1", metadata };
}

describe("sessionArchiveState", () => {
  it("reports a running archive operation as archiving", () => {
    const operation = { status: "running", startedAt: "2026-10-25T10:00:00.000Z" };
    expect(sessionArchiveState(session({
      session_archive_operation: JSON.stringify(operation)
    }))).toEqual({ archiveError: "", archiving: true, operation });
  });

  it("reports an archived close as archiving unless the operation failed", () => {
    expect(sessionArchiveState(session({ session_closing_reason: "archived" })).archiving).toBe(true);
    const failed = sessionArchiveState(session({
      session_archive_operation: JSON.stringify({ status: "failed", error: "Disk full." }),
      session_closing_reason: "archived"
    }));
    expect(failed.archiving).toBe(false);
    expect(failed.archiveError).toBe("Disk full.");
  });

  it("treats unreadable archive metadata as a failed operation", () => {
    expect(sessionArchiveState(session({ session_archive_operation: "{" }))).toEqual({
      archiveError: "Session archive state could not be read.",
      archiving: false,
      operation: { status: "failed", error: "Session archive state could not be read." }
    });
  });

  it("reports an ordinary or missing session as not archiving", () => {
    expect(sessionArchiveState(session())).toEqual({ archiveError: "", archiving: false, operation: null });
    expect(sessionArchiveState(undefined).archiving).toBe(false);
  });
});
