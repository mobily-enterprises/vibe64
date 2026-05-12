import { afterEach, describe, expect, it, vi } from "vitest";

import { useIssueSessions } from "../../src/composables/useIssueSessions.js";
import {
  listIssueSessions,
  readIssueSession
} from "@/lib/studioApi.js";

vi.mock("@/lib/studioApi.js", () => ({
  abandonIssueSession: vi.fn(),
  createIssueSession: vi.fn(),
  listIssueSessions: vi.fn(),
  readIssueSession: vi.fn(),
  runIssueSessionStep: vi.fn()
}));

describe("useIssueSessions", () => {
  afterEach(() => {
    vi.resetAllMocks();
  });

  it("patches late session fields into the selected session and visible list", async () => {
    const session = {
      currentStep: "prompt",
      sessionId: "2026-05-12_13-07-36",
      status: "running",
      worktreeReady: true
    };
    listIssueSessions.mockResolvedValue({
      sessions: [session]
    });
    readIssueSession.mockResolvedValue({
      ...session,
      needsThreadCapture: true
    });

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();

    issueSessions.patchIssueSession({
      codexThreadId: "019e1575-2458-7b93-bf9d-e7d7ffd49ad2",
      needsThreadCapture: false,
      sessionId: session.sessionId
    });

    expect(issueSessions.selectedSession.value.codexThreadId)
      .toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
    expect(issueSessions.selectedSession.value.needsThreadCapture).toBe(false);
    expect(issueSessions.issueSessions.value[0].codexThreadId)
      .toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
  });
});
