import { describe, expect, it } from "vitest";

import {
  isArchivedVibe64Session,
  isOpenVibe64Session,
  shortVibe64SessionId,
  vibe64SessionDisplayTitle,
  vibe64SessionShortLabel,
  vibe64SessionStatusColor,
  vibe64SessionStatusLabel
} from "../../src/lib/vibe64SessionViewModel.js";

describe("plain Vibe64 session view", () => {
  it("uses the explicit session label and a short-id fallback", () => {
    expect(vibe64SessionDisplayTitle({
      metadata: { label: "Improve search" },
      sessionId: "2026-session-1"
    })).toBe("Improve search");
    expect(vibe64SessionDisplayTitle({ sessionId: "2026-session-1" })).toBe("Session session-1");
    expect(vibe64SessionDisplayTitle({ sessionName: "Fix login", metadata: { label: "Old" }, sessionId: "2026-s" }))
      .toBe("Fix login");
    expect(vibe64SessionDisplayTitle({ metadata: { issue_word: "legacy" }, sessionId: "2026-session-1" }))
      .toBe("Session session-1");
    expect(vibe64SessionShortLabel({ metadata: { label: "Improve search" } })).toBe("Improve search");
    expect(vibe64SessionShortLabel({ metadata: { issue_word: "legacy" } })).toBe("");
    expect(shortVibe64SessionId("2026-session-1")).toBe("session-1");
  });

  it("distinguishes open and archived sessions", () => {
    expect(isOpenVibe64Session({ status: "active" })).toBe(true);
    expect(isArchivedVibe64Session({ status: "archived" })).toBe(true);
  });

  it("presents the small plain-session status set", () => {
    expect(vibe64SessionStatusLabel("active")).toBe("active");
    expect(vibe64SessionStatusColor("archived")).toBe("primary");
    expect(vibe64SessionStatusColor("blocked")).toBe("error");
    expect(vibe64SessionStatusColor("active")).toBe("primary");
  });
});
