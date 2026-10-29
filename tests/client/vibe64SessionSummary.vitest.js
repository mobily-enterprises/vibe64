import { describe, expect, it } from "vitest";
import { createSessionChangedPublisher } from "../../packages/vibe64-core/src/server/sessionRealtimeEvents.js";
import { sessionListRealtimeShouldRefresh } from "../../src/composables/useVibe64SessionData.js";
import { agentTurnRealtimeOverlayFromPayload } from "../../src/lib/vibe64AgentTurnRealtimeOverlay.js";
import { mountedSessionRealtimeShouldRefresh } from "../../src/lib/vibe64MountedSessionState.js";
import {
  REPOSITORY_UPDATE_CHECK_FAILED_REASON,
  repositoryStatusRealtimeShouldRefresh
} from "../../src/lib/vibe64RepositoryRealtime.js";

// Project pages (the session list and its activity, archive and renewal state,
// repository status, approval notices) read only the summary of a change.
// Each must find in it what it needs from the full change.
async function summaryOf(sessionId, change) {
  const published = [];
  await createSessionChangedPublisher({ async publish(event) { published.push(event); return event; } })(sessionId, change);
  return published.find(({ realtime }) => realtime.event === "vibe64.session.summary.changed")?.realtime.payload;
}

const session = (sessionId, extra = {}) => ({ sessionId, projectSlug: "alpha", revision: 5, status: "active", ...extra });

describe("session summaries", () => {
  it("refresh the session list unless the change excludes it", async () => {
    const renamed = await summaryOf("s1", { reason: "session-renamed", session: session("s1") });
    expect(sessionListRealtimeShouldRefresh({ payload: renamed }, "alpha")).toBe(true);
    expect(sessionListRealtimeShouldRefresh({ payload: renamed }, "beta")).toBe(false);
    const turnActive = await summaryOf("s1", { reason: "codex-app-server-turn-active", session: session("s1"),
      payload: { agentSession: { thread: { id: "t" }, turn: { active: true, id: "turn-1", items: ["long"] } } } });
    expect(sessionListRealtimeShouldRefresh({ payload: turnActive }, "alpha")).toBe(false);
    expect(mountedSessionRealtimeShouldRefresh({ payload: turnActive }, "s1")).toBe(false);
    expect(mountedSessionRealtimeShouldRefresh({ payload: renamed }, "s1")).toBe(true);
  });

  it("carry each listed session's turn activity", async () => {
    const started = await summaryOf("s1", { reason: "claude-stream-turn-active", session: session("s1", { revision: 9 }),
      payload: { agentRun: { active: true, runId: "run-1" }, agentSession: { turn: { active: true, id: "turn-1" } } } });
    expect(agentTurnRealtimeOverlayFromPayload(started, "s1")).toMatchObject({ active: true, revision: 9 });
    const finished = await summaryOf("s1", { reason: "claude-stream-turn-idle", session: session("s1", { revision: 10 }),
      payload: { agentRun: { active: false, runId: "run-1" }, agentSession: { turn: { active: false, id: "turn-1" } } } });
    expect(agentTurnRealtimeOverlayFromPayload(finished, "s1")).toMatchObject({ active: false, revision: 10 });
  });

  it("carry archive, repository and approval notices", async () => {
    expect((await summaryOf("s1", { reason: "session-archiving", session: session("s1") })).reason).toBe("session-archiving");
    const check = { canonicalCommit: "a".repeat(40), checkedAt: "2026-10-29T00:00:00.000Z", updateAvailable: true };
    const checked = await summaryOf("s1", { reason: "session-repository-checked", session: session("s1"),
      payload: { repositoryUpdateCheck: check } });
    expect(repositoryStatusRealtimeShouldRefresh(checked)).toBe(true);
    expect(checked.repositoryUpdateCheck).toEqual(check);
    const error = { code: "vibe64_session_update_check_failed", message: "GitHub is unavailable." };
    const failed = await summaryOf("s1", { reason: REPOSITORY_UPDATE_CHECK_FAILED_REASON, session: session("s1"),
      payload: { repositoryUpdateCheckError: error } });
    expect(failed.repositoryUpdateCheckError).toEqual(error);
    const canonical = await summaryOf("s1", { reason: "repository-canonical-changed", session: session("s1"),
      payload: { canonicalCommit: "b".repeat(40) } });
    expect(canonical.canonicalCommit).toBe("b".repeat(40));
    const queued = await summaryOf("s1", { reason: "main-chat-approval-queued", session: session("s1"),
      payload: { approvalId: "approval-1", approvalSender: "Bob", message: "Please deploy" } });
    expect(queued).toMatchObject({ approvalId: "approval-1", approvalSender: "Bob", projectSlug: "alpha", sessionId: "s1" });
    expect(queued.message).toBeUndefined();
  });

  it("are not sent for streamed work", async () => {
    for (const reason of ["claude-stream-message", "opencode-server-progress", "output-target-started"]) {
      expect(await summaryOf("s1", { reason, session: session("s1") })).toBeUndefined();
    }
  });
});
