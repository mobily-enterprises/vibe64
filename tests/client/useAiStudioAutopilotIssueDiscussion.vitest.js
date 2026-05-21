import { computed, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAiStudioAutopilotIssueDiscussion
} from "../../src/composables/useAiStudioAutopilotIssueDiscussion.js";
import {
  useAiStudioCodexQuestionExchange
} from "../../src/composables/useAiStudioCodexQuestionExchange.js";

describe("useAiStudioAutopilotIssueDiscussion", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("request-1")
        .mockReturnValueOnce("request-2")
        .mockReturnValueOnce("request-3")
    });
    vi.stubGlobal("window", {
      clearTimeout: globalThis.clearTimeout,
      localStorage: createMemoryStorage(),
      setTimeout: globalThis.setTimeout
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects the hidden issue prompt and reviews issue-draft.json", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";

    await context.controller.submitInitialRequest();

    expect(context.clearAutopilotArtifacts).toHaveBeenCalledWith("session-1");
    expect(context.codexTerminal.injectPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Initial user request:\nAdd booking reports"),
      {
        requestId: "request-1",
        sessionId: "session-1"
      }
    );
    expect(context.codexTerminal.injectPrompt.mock.calls[0][0]).toContain("/tmp/session/artifacts/issue-draft.json");
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .toContain("Add booking reports");

    context.autopilotArtifacts.value = {
      issueDraft: {
        body: "Build a report screen.",
        requestId: "request-1",
        title: "Add booking reports",
        word: "Reports"
      },
      ok: true,
      promptDone: null,
      questions: null,
      sessionId: "session-1"
    };
    await nextTick();

    expect(context.controller.reviewing.value).toBe(true);
    expect(context.controller.statusText.value).toBe("Does this sound right?");
    expect(context.controller.draftTitle.value).toBe("Add booking reports");
    expect(context.controller.draftWord.value).toBe("Reports");
    expect(context.controller.draftBody.value).toBe("Build a report screen.");
  });

  it("renders questions.json and submits answers back to Codex", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";

    await context.controller.submitInitialRequest();
    context.autopilotArtifacts.value = {
      issueDraft: null,
      ok: true,
      promptDone: null,
      questions: {
        questions: [
          {
            id: "q1",
            text: "Should cancelled bookings be included?"
          },
          {
            id: "q2",
            text: "Who can see the report?"
          }
        ],
        requestId: "request-1"
      },
      sessionId: "session-1"
    };
    await nextTick();

    expect(context.questionExchange.hasQuestions.value).toBe(true);
    expect(context.controller.statusText.value).toBe("A few questions first");
    expect(context.questionExchange.questions.value.map((question) => question.text)).toEqual([
      "Should cancelled bookings be included?",
      "Who can see the report?"
    ]);

    context.questionExchange.setAnswer("q1", "No.");
    context.questionExchange.setAnswer("q2", "Admins only.");
    await nextTick();
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .toContain("Admins only.");

    await context.questionExchange.submitAnswers();

    expect(context.clearAutopilotArtifacts).toHaveBeenCalledTimes(2);
    expect(context.codexTerminal.injectPrompt).toHaveBeenLastCalledWith(
      expect.stringContaining("Q1: Should cancelled bookings be included?\nA1: No."),
      {
        requestId: "request-2",
        sessionId: "session-1"
      }
    );
    expect(context.codexTerminal.injectPrompt).toHaveBeenLastCalledWith(
      expect.stringContaining("Q2: Who can see the report?\nA2: Admins only."),
      {
        requestId: "request-2",
        sessionId: "session-1"
      }
    );
    expect(context.controller.waiting.value).toBe(true);

    context.autopilotArtifacts.value = {
      issueDraft: {
        body: "Build admin-only booking reports.",
        requestId: "request-2",
        title: "Add booking reports",
        word: "Reports"
      },
      ok: true,
      promptDone: null,
      questions: null,
      sessionId: "session-1"
    };
    await nextTick();

    expect(context.controller.reviewing.value).toBe(true);
    expect(context.controller.draftWord.value).toBe("Reports");
    expect(context.controller.draftBody.value).toBe("Build admin-only booking reports.");
  });

  it("cancels clarification questions and ignores that request id", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Create p.txt";

    await context.controller.submitInitialRequest();
    context.autopilotArtifacts.value = {
      issueDraft: null,
      ok: true,
      promptDone: null,
      questions: {
        questions: [
          {
            id: "q1",
            text: "What should p.txt contain?"
          }
        ],
        requestId: "request-1"
      },
      sessionId: "session-1"
    };
    await nextTick();

    context.questionExchange.setAnswer("q1", "hello");
    context.questionExchange.cancel();
    await nextTick();

    expect(context.controller.inputVisible.value).toBe(true);
    expect(context.controller.requestText.value).toBe("Create p.txt");
    expect(context.questionExchange.hasQuestions.value).toBe(false);
    expect(context.clearIssueArtifacts).not.toHaveBeenCalled();
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .not.toContain("hello");

    context.autopilotArtifacts.value = {
      issueDraft: {
        body: "Stale answer.",
        requestId: "request-1",
        title: "Stale",
        word: "Stale"
      },
      ok: true,
      promptDone: null,
      questions: null,
      sessionId: "session-1"
    };
    await nextTick();

    expect(context.controller.inputVisible.value).toBe(true);
    expect(context.controller.reviewing.value).toBe(false);
  });

  it("writes accepted issue artifacts and advances when the workflow next step is ready", async () => {
    const context = createIssueDiscussionContext({
      initialAutopilotArtifacts: {
        issueDraft: {
          body: "Build a report screen.",
          requestId: "request-from-file",
          title: "Add booking reports",
          word: "Reports"
        },
        ok: true,
        promptDone: null,
        questions: null,
        sessionId: "session-1"
      }
    });
    await nextTick();

    await expect(context.controller.acceptIssueDraft()).resolves.toBe(true);

    expect(context.saveIssueArtifacts).toHaveBeenCalledWith("session-1", {
      body: "Build a report screen.",
      title: "Add booking reports",
      word: "Reports"
    });
    expect(context.clearAutopilotArtifacts).toHaveBeenCalledWith("session-1");
    expect(context.actions.goNext).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1")).toBeNull();
  });
});

function createIssueDiscussionContext({
  currentStep = "issue_file_created",
  initialAutopilotArtifacts = {
    issueDraft: null,
    ok: true,
    promptDone: null,
    questions: null,
    sessionId: "session-1"
  }
} = {}) {
  const session = ref({
    artifactReadiness: {},
    artifactsRoot: "/tmp/session/artifacts",
    currentStep,
    metadata: {},
    sessionId: "session-1"
  });
  const currentNext = ref({
    enabled: true,
    stepId: "issue_submitted",
    visible: true
  });
  const actions = {
    currentNext,
    goNext: vi.fn(async () => {
      session.value = {
        ...session.value,
        currentStep: "issue_submitted"
      };
    })
  };
  const autopilotArtifacts = ref(initialAutopilotArtifacts);
  const codexTerminal = {
    injectPrompt: vi.fn(async () => true),
    promptInjectionError: ref("")
  };
  const questionExchange = useAiStudioCodexQuestionExchange({
    codexTerminal
  });
  const saveIssueArtifacts = vi.fn(async () => ({
    ok: true
  }));
  const clearIssueArtifacts = vi.fn(async () => ({
    ok: true
  }));
  const clearAutopilotArtifacts = vi.fn(async () => {
    autopilotArtifacts.value = {
      issueDraft: null,
      ok: true,
      promptDone: null,
      questions: null,
      sessionId: "session-1"
    };
    return {
      ok: true
    };
  });
  const controller = useAiStudioAutopilotIssueDiscussion({
    actions,
    autopilotArtifacts,
    clearAutopilotArtifacts,
    clearIssueArtifacts,
    codexTerminal,
    questionExchange,
    readyForIssue: computed(() => session.value.currentStep === "issue_file_created"),
    refreshSessionData: vi.fn(async () => null),
    saveIssueArtifacts,
    session
  });

  return {
    actions,
    autopilotArtifacts,
    clearAutopilotArtifacts,
    clearIssueArtifacts,
    codexTerminal,
    controller,
    questionExchange,
    saveIssueArtifacts,
    session
  };
}

function createMemoryStorage() {
  const store = new Map();
  return {
    clear() {
      store.clear();
    },
    getItem(key) {
      return store.has(key) ? store.get(key) : null;
    },
    removeItem(key) {
      store.delete(key);
    },
    setItem(key, value) {
      store.set(key, String(value));
    }
  };
}
