import { computed, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  useAiStudioAutopilotIssueDiscussion
} from "../../src/composables/useAiStudioAutopilotIssueDiscussion.js";
import {
  AUTOPILOT_ISSUE_MARKER_END,
  AUTOPILOT_ISSUE_MARKER_START,
  AUTOPILOT_ISSUE_QUESTIONS_MARKER_END,
  AUTOPILOT_ISSUE_QUESTIONS_MARKER_START
} from "../../src/lib/aiStudioAutopilotIssueMarkers.js";

describe("useAiStudioAutopilotIssueDiscussion", () => {
  beforeEach(() => {
    vi.stubGlobal("crypto", {
      randomUUID: vi.fn()
        .mockReturnValueOnce("request-1")
        .mockReturnValueOnce("request-2")
        .mockReturnValueOnce("request-3")
    });
    vi.stubGlobal("window", {
      localStorage: createMemoryStorage()
    });
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("injects an issue prompt and reviews the marked Codex result", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";

    await context.controller.submitInitialRequest();

    expect(context.codexTerminal.injectPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Initial user request:\nAdd booking reports"),
      {
        requestId: "request-1",
        sessionId: "session-1"
      }
    );
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .toContain("Add booking reports");

    context.codexOutput.value = issueMarker({
      body: "Build a report screen.",
      requestId: "request-1",
      title: "Add booking reports"
    });
    await nextTick();

    expect(context.controller.reviewing.value).toBe(true);
    expect(context.controller.statusText.value).toBe("Does this sound right?");
    expect(context.controller.draftTitle.value).toBe("Add booking reports");
    expect(context.controller.draftBody.value).toBe("Build a report screen.");
  });

  it("renders clarification questions and submits the answers back to Codex", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";

    await context.controller.submitInitialRequest();
    context.codexOutput.value = questionsMarker({
      questions: [
        "Should cancelled bookings be included?",
        "Who can see the report?"
      ],
      requestId: "request-1"
    });
    await nextTick();

    expect(context.controller.questioning.value).toBe(true);
    expect(context.controller.statusText.value).toBe("A few questions first");
    expect(context.controller.questions.value.map((question) => question.text)).toEqual([
      "Should cancelled bookings be included?",
      "Who can see the report?"
    ]);

    context.controller.questions.value[0].answer = "No.";
    context.controller.questions.value[1].answer = "Admins only.";
    await nextTick();
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .toContain("Admins only.");

    await context.controller.submitQuestionAnswers();

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

    context.codexOutput.value = [
      context.codexOutput.value,
      questionsMarker({
        questions: ["Old question"],
        requestId: "request-1"
      }),
      issueMarker({
        body: "Build admin-only booking reports.",
        requestId: "request-2",
        title: "Add booking reports"
      })
    ].join("\n");
    await nextTick();

    expect(context.controller.reviewing.value).toBe(true);
    expect(context.controller.draftBody.value).toBe("Build admin-only booking reports.");
  });

  it("can ask another clarification round after answers are submitted", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";

    await context.controller.submitInitialRequest();
    context.codexOutput.value = questionsMarker({
      questions: [
        "Should cancelled bookings be included?",
        "Who can see the report?"
      ],
      requestId: "request-1"
    });
    await nextTick();

    context.controller.questions.value[0].answer = "No.";
    context.controller.questions.value[1].answer = "Admins only.";
    await nextTick();
    await context.controller.submitQuestionAnswers();

    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .not.toContain("Admins only.");

    const outputBeforeReload = context.codexOutput.value;
    const reloadedContext = createIssueDiscussionContext();
    reloadedContext.codexOutput.value = [
      outputBeforeReload,
      questionsMarker({
        questions: [
          "Should the report include export buttons?"
        ],
        requestId: "request-2"
      })
    ].join("\n");
    await nextTick();

    expect(reloadedContext.controller.questioning.value).toBe(true);
    expect(reloadedContext.controller.questions.value).toHaveLength(1);
    expect(reloadedContext.controller.questions.value[0].text).toBe("Should the report include export buttons?");
    expect(reloadedContext.controller.questions.value[0].answer).toBe("");
  });

  it("cancels clarification questions and returns to the issue input", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";

    await context.controller.submitInitialRequest();
    context.codexOutput.value = questionsMarker({
      questions: [
        "Should cancelled bookings be included?",
        "Who can see the report?"
      ],
      requestId: "request-1"
    });
    await nextTick();

    context.controller.questions.value[0].answer = "No.";
    await nextTick();
    context.controller.cancelQuestions();

    expect(context.clearIssueArtifacts).not.toHaveBeenCalled();
    expect(context.controller.inputVisible.value).toBe(true);
    expect(context.controller.requestText.value).toBe("Add booking reports");
    expect(context.controller.questions.value).toEqual([]);
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1"))
      .not.toContain("No.");

    context.codexOutput.value = [
      context.codexOutput.value,
      "more output after the cancelled questions"
    ].join("\n");
    await nextTick();

    expect(context.controller.inputVisible.value).toBe(true);
    expect(context.controller.questioning.value).toBe(false);
  });

  it("restores a pending request as waiting instead of returning to the input form", () => {
    window.localStorage.setItem("ai-studio:autopilot:issue-discussion:session-1", JSON.stringify({
      activeRequestId: "request-1",
      rejectedRequestIds: [],
      requestText: "Create p.txt"
    }));

    const context = createIssueDiscussionContext();

    expect(context.controller.waiting.value).toBe(true);
    expect(context.controller.statusText.value).toBe("Asking Codex to define the issue...");
    expect(context.controller.requestText.value).toBe("Create p.txt");
  });

  it("does not let stored issue waiting block later workflow steps", () => {
    window.localStorage.setItem("ai-studio:autopilot:issue-discussion:session-1", JSON.stringify({
      activeRequestId: "request-1",
      rejectedRequestIds: [],
      requestText: "Create p.txt"
    }));

    const context = createIssueDiscussionContext({
      currentStep: "changes_accepted"
    });

    expect(context.controller.waiting.value).toBe(false);
    expect(context.controller.inputVisible.value).toBe(false);
    expect(context.controller.statusText.value).toBe("What would you like to do?");
  });

  it("uses the active request id to recover an answer after terminal output is trimmed", async () => {
    const ignoredOutput = "old terminal output\n";
    window.localStorage.setItem("ai-studio:autopilot:issue-discussion:session-1", JSON.stringify({
      activeRequestId: "request-from-terminal",
      outputCursor: ignoredOutput.length + 500,
      rejectedRequestIds: [],
      requestText: "Create p.txt"
    }));
    const context = createIssueDiscussionContext();

    context.codexOutput.value = issueMarker({
      body: "Create p.txt in the project root.",
      requestId: "request-from-terminal",
      title: "Create p.txt"
    });
    await nextTick();

    expect(context.controller.reviewing.value).toBe(true);
    expect(context.controller.draftTitle.value).toBe("Create p.txt");
    expect(context.controller.draftBody.value).toBe("Create p.txt in the project root.");
  });

  it("ignores markers for a different request while a request is active", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Create p.txt";

    await context.controller.submitInitialRequest();

    context.codexOutput.value = issueMarker({
      body: "Wrong request.",
      requestId: "other-request",
      title: "Wrong issue"
    });
    await nextTick();

    expect(context.controller.waiting.value).toBe(true);

    context.codexOutput.value = [
      context.codexOutput.value,
      questionsMarker({
        questions: [
          "What should the file contain?"
        ],
        requestId: "request-1"
      })
    ].join("\n");
    await nextTick();

    expect(context.controller.questioning.value).toBe(true);
    expect(context.controller.questions.value.map((question) => question.text)).toEqual([
      "What should the file contain?"
    ]);
  });

  it("writes accepted issue artifacts and advances when the workflow next step is ready", async () => {
    const context = createIssueDiscussionContext();
    context.codexOutput.value = issueMarker({
      body: "Build a report screen.",
      requestId: "request-1",
      title: "Add booking reports"
    });
    await nextTick();

    await context.controller.acceptIssueDraft();

    expect(context.saveIssueArtifacts).toHaveBeenCalledWith("session-1", {
      body: "Build a report screen.",
      title: "Add booking reports"
    });
    expect(context.actions.goNext).toHaveBeenCalledOnce();
    expect(window.localStorage.getItem("ai-studio:autopilot:issue-discussion:session-1")).toBeNull();
  });

  it("rejects a draft and returns to the issue input without reusing the same marker", async () => {
    const context = createIssueDiscussionContext();
    context.controller.requestText.value = "Add booking reports";
    context.codexOutput.value = issueMarker({
      body: "Too broad.",
      requestId: "request-1",
      title: "Reports"
    });
    await nextTick();

    context.controller.draftTitle.value = "Add booking sales report";
    context.controller.draftBody.value = "Only show booking sales totals.";
    await context.controller.rejectIssueDraft();

    expect(context.clearIssueArtifacts).toHaveBeenCalledWith("session-1");
    expect(context.codexTerminal.injectPrompt).not.toHaveBeenCalled();
    expect(context.controller.inputVisible.value).toBe(true);
    expect(context.controller.requestText.value).toBe("Add booking reports");

    context.codexOutput.value = [
      context.codexOutput.value,
      "more output after the rejected marker"
    ].join("\n");
    await nextTick();

    expect(context.controller.inputVisible.value).toBe(true);

    crypto.randomUUID.mockReset();
    crypto.randomUUID.mockReturnValue("request-2");
    await context.controller.submitInitialRequest();

    expect(context.codexTerminal.injectPrompt).toHaveBeenCalledWith(
      expect.stringContaining("Initial user request:\nAdd booking reports"),
      {
        requestId: "request-2",
        sessionId: "session-1"
      }
    );
    expect(context.controller.waiting.value).toBe(true);
  });

  it("ignores terminal markers before the stored output cursor", async () => {
    const oldOutput = issueMarker({
      body: "Use the old answer.",
      requestId: "old-request",
      title: "Old issue"
    });
    window.localStorage.setItem("ai-studio:autopilot:issue-discussion:session-1", JSON.stringify({
      activeRequestId: "new-request",
      ignoredRequestIds: [],
      outputCursor: oldOutput.length,
      requestText: "Create p.txt"
    }));
    const context = createIssueDiscussionContext();

    context.codexOutput.value = oldOutput;
    await nextTick();

    expect(context.controller.waiting.value).toBe(true);

    context.codexOutput.value = oldOutput + questionsMarker({
      questions: [
        "What should the file contain?"
      ],
      requestId: "new-request"
    });
    await nextTick();

    expect(context.controller.questioning.value).toBe(true);
    expect(context.controller.questions.value.map((question) => question.text)).toEqual([
      "What should the file contain?"
    ]);
  });
});

function createIssueDiscussionContext({
  currentStep = "issue_file_created"
} = {}) {
  const session = ref({
    artifactReadiness: {},
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
  const codexOutput = ref("");
  const codexTerminal = {
    injectPrompt: vi.fn(async () => true),
    output: codexOutput
  };
  const saveIssueArtifacts = vi.fn(async () => ({
    ok: true
  }));
  const clearIssueArtifacts = vi.fn(async () => ({
    ok: true
  }));
  const controller = useAiStudioAutopilotIssueDiscussion({
    actions,
    clearIssueArtifacts,
    codexTerminal,
    readyForIssue: computed(() => session.value.currentStep === "issue_file_created"),
    refreshSessionData: vi.fn(async () => null),
    saveIssueArtifacts,
    session
  });

  return {
    actions,
    clearIssueArtifacts,
    codexOutput,
    codexTerminal,
    controller,
    saveIssueArtifacts,
    session
  };
}

function issueMarker(payload) {
  return [
    AUTOPILOT_ISSUE_MARKER_START,
    JSON.stringify(payload),
    AUTOPILOT_ISSUE_MARKER_END
  ].join("\n");
}

function questionsMarker(payload) {
  return [
    AUTOPILOT_ISSUE_QUESTIONS_MARKER_START,
    JSON.stringify(payload),
    AUTOPILOT_ISSUE_QUESTIONS_MARKER_END
  ].join("\n");
}

function createMemoryStorage() {
  const store = new Map();
  return {
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
