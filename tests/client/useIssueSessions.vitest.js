import { afterEach, describe, expect, it, vi } from "vitest";

import { useIssueSessions } from "../../src/composables/useIssueSessions.js";
import { issueSessionFacts } from "../../src/lib/issueSessionViewModel.js";
import {
  listAiStudioSessions,
  readAiStudioSession,
  runAiStudioSessionAction
} from "@/lib/studioApi.js";

const SELECTED_SESSION_STORAGE_KEY = "jskit-ai-studio:selected-issue-session-id";

vi.mock("@/lib/studioApi.js", () => ({
  abandonAiStudioSession: vi.fn(),
  advanceAiStudioSession: vi.fn(),
  createAiStudioSession: vi.fn(),
  listAiStudioSessions: vi.fn(),
  readAiStudioSession: vi.fn(),
  runAiStudioSessionAction: vi.fn()
}));

describe("useIssueSessions", () => {
  afterEach(() => {
    vi.resetAllMocks();
    vi.unstubAllGlobals();
  });

  function stubSessionStorage(initialValues = {}) {
    const values = { ...initialValues };
    const sessionStorage = {
      getItem: vi.fn((key) => Object.prototype.hasOwnProperty.call(values, key) ? values[key] : null),
      removeItem: vi.fn((key) => {
        delete values[key];
      }),
      setItem: vi.fn((key, value) => {
        values[key] = String(value);
      })
    };
    vi.stubGlobal("window", {
      sessionStorage
    });
    return sessionStorage;
  }

  it("restores the selected issue session across browser reloads", async () => {
    const olderSession = {
      currentStep: "plan_made",
      createdAt: "2026-05-15T06:38:24.000Z",
      sessionId: "2026-05-15_14-38-24",
      status: "running"
    };
    const selectedSession = {
      currentStep: "issue_created",
      createdAt: "2026-05-15T07:36:02.000Z",
      sessionId: "2026-05-15_15-36-02",
      status: "running"
    };
    const sessionStorage = stubSessionStorage({
      [SELECTED_SESSION_STORAGE_KEY]: selectedSession.sessionId
    });
    listAiStudioSessions.mockResolvedValue({
      sessions: [olderSession, selectedSession]
    });
    readAiStudioSession.mockImplementation(async (sessionId) => {
      return sessionId === selectedSession.sessionId ? selectedSession : olderSession;
    });

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();

    expect(readAiStudioSession).toHaveBeenCalledWith(selectedSession.sessionId);
    expect(issueSessions.selectedSession.value.currentStep).toBe("issue_created");
    expect(sessionStorage.setItem)
      .toHaveBeenCalledWith(SELECTED_SESSION_STORAGE_KEY, selectedSession.sessionId);
  });

  it("defaults to the newest visible session when no remembered selection exists", async () => {
    const olderSession = {
      currentStep: "plan_made",
      createdAt: "2026-05-15T06:38:24.000Z",
      sessionId: "2026-05-15_14-38-24",
      status: "running"
    };
    const newestSession = {
      currentStep: "issue_created",
      createdAt: "2026-05-15T07:36:02.000Z",
      sessionId: "2026-05-15_15-36-02",
      status: "running"
    };
    stubSessionStorage();
    listAiStudioSessions.mockResolvedValue({
      sessions: [olderSession, newestSession]
    });
    readAiStudioSession.mockImplementation(async (sessionId) => {
      return sessionId === newestSession.sessionId ? newestSession : olderSession;
    });

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();

    expect(readAiStudioSession).toHaveBeenCalledWith(newestSession.sessionId);
    expect(issueSessions.selectedSession.value.currentStep).toBe("issue_created");
  });

  it("patches late session fields into the selected session and visible list", async () => {
    const session = {
      currentStep: "prompt",
      sessionId: "2026-05-12_13-07-36",
      status: "running",
      worktreeReady: true
    };
    listAiStudioSessions.mockResolvedValue({
      sessions: [session]
    });
    readAiStudioSession.mockResolvedValue({
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
    expect(issueSessionFacts(issueSessions.selectedSession.value)
      .find((fact) => fact.key === "codex")?.value)
      .toBe("019e1575-2458-7b93-bf9d-e7d7ffd49ad2");
  });

  it("runs the selected runtime action and refreshes the visible list", async () => {
    const session = {
      currentStep: "plan_made",
      sessionId: "2026-05-12_13-07-36",
      workflowId: "default",
      status: "running"
    };
    const actionResponse = {
      ...session,
      actionResult: {
        actionId: "make_plan",
        status: "prompt_ready"
      }
    };
    listAiStudioSessions
      .mockResolvedValueOnce({ sessions: [session] })
      .mockResolvedValueOnce({ sessions: [actionResponse] });
    readAiStudioSession.mockResolvedValue(session);
    runAiStudioSessionAction.mockResolvedValue(actionResponse);

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();
    const response = await issueSessions.runSelectedAction("make_plan");

    expect(runAiStudioSessionAction).toHaveBeenCalledWith(session.sessionId, "make_plan", {});
    expect(response.actionResult.actionId).toBe("make_plan");
    expect(issueSessions.selectedSession.value.actionResult.actionId).toBe("make_plan");
    expect(issueSessions.issueSessions.value[0].actionResult.actionId).toBe("make_plan");
    expect(issueSessions.issueSessionsError.value).toBe("");
  });

  it("reports that runtime rewind is not wired yet", async () => {
    const session = {
      currentStep: "plan_executed",
      sessionId: "2026-05-12_13-07-36",
      status: "running"
    };
    listAiStudioSessions.mockResolvedValue({ sessions: [session] });
    readAiStudioSession.mockResolvedValue(session);

    const issueSessions = useIssueSessions();
    await issueSessions.loadIssueSessions();
    const response = await issueSessions.rewindSelectedSession("worktree_created");

    expect(response.ok).toBe(false);
    expect(issueSessions.issueSessionsError.value)
      .toBe("AI Studio runtime rewind is not wired yet.");
  });
});
