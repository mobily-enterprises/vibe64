import { effectScope, nextTick, ref } from "vue";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS,
  VIBE64_PROMPT_HINT_STATIC_STARTERS,
  normalizedPromptHintDraft
} from "../../packages/vibe64-runtime/src/shared/promptHints.js";

import {
  PROMPT_HINT_DEBOUNCE_MS,
  PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT,
  normalizedPromptHintSuggestions,
  promptHintConversationFingerprint,
  useVibe64PromptHints
} from "../../src/composables/useVibe64PromptHints.js";

function deferredResult() {
  let resolve;
  const promise = new Promise((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function promptHint(label, prompt) {
  return { label, prompt };
}

function createHints(overrides = {}, dependencies = {}) {
  const state = {
    active: ref(true),
    blankConversation: ref(false),
    canRequest: ref(true),
    conversationKey: ref("conversation-1"),
    draft: ref(""),
    existingProject: ref(false),
    onSelect: vi.fn(() => true),
    policy: ref({
      enabled: true,
      ready: true,
      revision: 1,
      version: 1
    }),
    sessionId: ref("session-1"),
    sessionsApiPath: ref("/api/vibe64/sessions"),
    ...overrides
  };
  const scope = effectScope();
  const hints = scope.run(() => useVibe64PromptHints(state, {
    request: vi.fn(async () => ({
      status: "ready",
      suggestions: VIBE64_PROMPT_HINT_STATIC_STARTERS.existingProject
    })),
    ...dependencies
  }));
  return { hints, scope, state };
}

describe("useVibe64PromptHints", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("asks the server about empty conversations so their Blueprint is not bypassed", async () => {
    const request = vi.fn(async () => ({
      status: "static",
      suggestions: VIBE64_PROMPT_HINT_STATIC_STARTERS.greenfield
    }));
    const greenfield = createHints({ blankConversation: ref(true) }, { request });

    expect(greenfield.hints.suggestions.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(greenfield.hints.status.value).toBe("static");
    expect(greenfield.hints.suggestions.value).toEqual([
      promptHint("Shape app idea", "Help me shape my app idea"),
      promptHint("Plan first version", "Show me the simplest useful first version"),
      promptHint("Decide first steps", "What should we decide first?")
    ]);
    expect(greenfield.hints.visible.value).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    greenfield.scope.stop();

    request.mockResolvedValue({
      status: "ready",
      suggestions: [
        promptHint("Add grooming slots", "Add grooming appointments to the calendar"),
        promptHint("Track dog visits", "Track each dog's previous visits"),
        promptHint("Show free groomers", "Show which groomers are available")
      ]
    });
    const existing = createHints({
      blankConversation: ref(true),
      existingProject: ref(true)
    }, { request });
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(existing.hints.status.value).toBe("ready");
    expect(existing.hints.suggestions.value).toEqual([
      promptHint("Add grooming slots", "Add grooming appointments to the calendar"),
      promptHint("Track dog visits", "Track each dog's previous visits"),
      promptHint("Show free groomers", "Show which groomers are available")
    ]);
    expect(request).toHaveBeenCalledTimes(2);
    existing.scope.stop();
  });

  it("waits for the enabled project policy and request availability", () => {
    const request = vi.fn();
    const policy = ref({ enabled: true, ready: false, revision: 0, version: 1 });
    const canRequest = ref(true);
    const { hints, scope } = createHints({ canRequest, policy }, { request });

    expect(hints.visible.value).toBe(false);

    policy.value = { enabled: false, ready: true, revision: 1, version: 1 };
    expect(hints.visible.value).toBe(false);

    policy.value = { enabled: true, ready: true, revision: 2, version: 1 };
    expect(hints.loading.value).toBe(true);
    canRequest.value = false;
    expect(hints.visible.value).toBe(false);
    expect(hints.loading.value).toBe(false);

    vi.advanceTimersByTime(PROMPT_HINT_DEBOUNCE_MS + 1);
    expect(request).not.toHaveBeenCalled();
    scope.stop();
  });

  it("generates on session load and keeps ready suggestions visible across blur", async () => {
    const request = vi.fn(async () => ({
      ok: true,
      status: "ready",
      suggestions: [
        promptHint("Inspect failing test", "Please inspect the failing test"),
        promptHint("Plan smallest fix", "Please plan the smallest safe fix"),
        promptHint("Review recent changes", "Please review the recent changes")
      ]
    }));
    const { hints, scope } = createHints({}, { request });

    expect(hints.loading.value).toBe(true);
    expect(request).not.toHaveBeenCalled();

    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);

    expect(request).toHaveBeenCalledTimes(1);
    expect(request.mock.calls[0][0]).toBe("/api/vibe64/sessions/session-1/prompt-hints");
    expect(request.mock.calls[0][1]).toMatchObject({
      body: {
        draft: "",
        operationId: expect.stringMatching(/^hint:/u),
        originId: expect.stringMatching(/^tab:/u)
      },
      method: "POST",
      signal: expect.any(AbortSignal)
    });
    expect(hints.loading.value).toBe(false);
    expect(hints.status.value).toBe("ready");
    expect(hints.suggestions.value).toHaveLength(3);

    hints.blurComposer();
    expect(hints.visible.value).toBe(true);
    hints.focusComposer();
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(1);
    scope.stop();
  });

  it("regenerates after each completed turn without waiting for composer focus", async () => {
    const canRequest = ref(true);
    const conversationKey = ref("conversation-1");
    const request = vi.fn(async () => ({
      ok: true,
      status: "ready",
      suggestions: [
        promptHint("Review current plan", "Review the current plan with me"),
        promptHint("Check next step", "Check the safest useful next step"),
        promptHint("Explain recent work", "Explain the most recent project work")
      ]
    }));
    const { hints, scope } = createHints({ canRequest, conversationKey }, { request });

    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(1);
    expect(hints.status.value).toBe("ready");

    hints.blurComposer();
    canRequest.value = false;
    conversationKey.value = "conversation-2";
    expect(hints.visible.value).toBe(false);

    canRequest.value = true;
    expect(hints.loading.value).toBe(true);
    expect(request).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);

    expect(request).toHaveBeenCalledTimes(2);
    expect(hints.status.value).toBe("ready");
    expect(hints.visible.value).toBe(true);
    scope.stop();
  });

  it("debounces the latest draft, cancels superseded work and ignores stale suggestions", async () => {
    const oldResult = deferredResult();
    const newResult = deferredResult();
    let generationCount = 0;
    const request = vi.fn((path) => (
      path.endsWith("/cancel")
        ? Promise.resolve({ ok: true, status: "cancelled" })
        : (++generationCount === 1 ? oldResult.promise : newResult.promise)
    ));
    const draft = ref("");
    const { hints, scope } = createHints({ draft }, { request });

    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(1);

    draft.value = "Make booking";
    await nextTick();
    expect(hints.visible.value).toBe(true);
    expect(request.mock.calls[0][1].signal.aborted).toBe(true);
    expect(request.mock.calls[1][0]).toMatch(/\/cancel$/u);
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS - 1);
    expect(generationCount).toBe(1);
    draft.value = "Make booking cancellation easier";
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS - 1);
    expect(generationCount).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(generationCount).toBe(2);
    expect(request.mock.calls[2][1].body.draft).toBe(draft.value);

    oldResult.resolve({
      ok: true,
      status: "ready",
      suggestions: [
        promptHint("Review current plan", "Review the current plan with me"),
        promptHint("Check next step", "Check the safest useful next step"),
        promptHint("Explain recent work", "Explain the most recent project work")
      ]
    });
    await Promise.resolve();
    await Promise.resolve();
    expect(hints.suggestions.value).toEqual([]);
    newResult.resolve({
      status: "ready",
      suggestions: [
        promptHint("Simplify cancellation", "Simplify cancelling a booking"),
        promptHint("Confirm cancellation", "Add a clear booking cancellation confirmation"),
        promptHint("Explain refund rules", "Show refund rules before cancelling a booking")
      ]
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(hints.suggestions.value).toHaveLength(3);
    expect(hints.suggestions.value[0].label).toBe("Simplify cancellation");
    expect(hints.previewPromptHint(hints.suggestions.value[0])).toBe(false);
    expect(hints.preview.value).toBe("");
    expect(hints.visible.value).toBe(true);
    scope.stop();
  });

  it("previews only an empty composer and inserts editable text on selection", async () => {
    const draft = ref("");
    const onSelect = vi.fn((text) => {
      draft.value = text;
      return true;
    });
    const { hints, scope } = createHints({
      blankConversation: ref(true),
      draft,
      onSelect
    });

    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    const selected = hints.suggestions.value[1];
    const malformed = { ...selected, icon: "not allowed" };
    expect(hints.previewPromptHint(malformed)).toBe(false);
    expect(hints.selectPromptHint(malformed)).toBe(false);
    expect(hints.selectPromptHint(promptHint("Review another plan", "Review a different plan"))).toBe(false);
    expect(onSelect).not.toHaveBeenCalled();
    const padded = promptHint(`  ${selected.label}  `, `  ${selected.prompt}  `);
    expect(hints.previewPromptHint(padded)).toBe(true);
    expect(hints.preview.value).toBe(selected.prompt);
    expect(hints.selectPromptHint(padded)).toBe(true);
    expect(onSelect).toHaveBeenCalledWith(selected.prompt);
    expect(draft.value).toBe(selected.prompt);
    expect(hints.preview.value).toBe("");
    expect(hints.suggestions.value).toEqual([]);
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(hints.suggestions.value).toHaveLength(3);
    expect(hints.visible.value).toBe(true);

    const replacement = hints.suggestions.value[2];
    expect(hints.previewPromptHint(replacement)).toBe(false);
    expect(hints.selectPromptHint(replacement)).toBe(true);
    expect(draft.value).toBe(replacement.prompt);
    expect(onSelect).toHaveBeenLastCalledWith(replacement.prompt);
    expect(hints.visible.value).toBe(true);
    scope.stop();
  });

  it("sends a restored draft immediately after debounce and refreshes when it is cleared", async () => {
    const draft = ref("Keep appointments, but remove payment collection");
    const request = vi.fn(async () => ({ status: "unavailable" }));
    const { scope } = createHints({ draft, blankConversation: ref(true) }, { request });
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request.mock.calls[0][1].body.draft).toBe(draft.value);
    draft.value = "";
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request.mock.calls[1][1].body.draft).toBe("");
    scope.stop();
  });

  it("bounds draft context to the newest Unicode characters without changing the composer", async () => {
    const draft = ref("old context " + "😀".repeat(VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS));
    const original = draft.value;
    const request = vi.fn(async () => ({ status: "unavailable" }));
    const { scope } = createHints({ draft }, { request });
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request.mock.calls[0][1].body.draft).toBe("😀".repeat(VIBE64_PROMPT_HINT_DRAFT_MAX_CHARACTERS));
    expect(draft.value).toBe(original);
    expect(normalizedPromptHintDraft("  a\r\nb  ")).toBe("a\nb");
    scope.stop();
  });

  it("accepts only three unique short-label and full-prompt pairs", () => {
    const valid = [
      promptHint("Review current plan", "Review the current plan with me"),
      promptHint("Check next step", "Check the safest useful next step"),
      promptHint("Explain recent work", "Explain the most recent project work")
    ];
    expect(normalizedPromptHintSuggestions(valid)).toEqual(valid);
    expect(normalizedPromptHintSuggestions([
      ...valid.slice(0, 2),
      promptHint("This label has too many words", "Explain the most recent project work")
    ])).toEqual([]);
    expect(normalizedPromptHintSuggestions([
      valid[0],
      promptHint(valid[0].label.toUpperCase(), "Use a different full prompt"),
      valid[2]
    ])).toEqual([]);
    expect(normalizedPromptHintSuggestions([
      valid[0],
      promptHint(valid[1].label, valid[0].prompt.toUpperCase()),
      valid[2]
    ])).toEqual([]);
    for (const invalid of [
      null,
      { ...valid[1], label: 42 },
      { ...valid[1], icon: "not allowed" },
      promptHint("Check next step", "Check the next\tstep"),
      promptHint("Check next step", "Check the next\u007fstep"),
      promptHint(`${"😀".repeat(23)} a`, "Check the next step"),
      promptHint("Check next step", "😀".repeat(109))
    ]) {
      expect(normalizedPromptHintSuggestions([valid[0], invalid, valid[2]])).toEqual([]);
    }
    const sparse = [...valid];
    delete sparse[1];
    expect(normalizedPromptHintSuggestions(sparse)).toEqual([]);
  });

  it("normalizes whitespace without counting Unicode surrogate pairs twice", () => {
    const expected = [
      promptHint(`${"😀".repeat(22)} a`, "😀".repeat(108)),
      promptHint("Check next step", "Check the safest useful next step"),
      promptHint("Explain recent work", "Explain the most recent project work")
    ];
    expect(normalizedPromptHintSuggestions([
      promptHint(`  ${"😀".repeat(22)}   a  `, `  ${"😀".repeat(108)}  `),
      promptHint("  Check   next step  ", "  Check  the safest useful next step  "),
      expected[2]
    ])).toEqual(expected);
  });

  it.each([
    ["null", null],
    ["malformed object", { label: "Incomplete suggestion" }]
  ])("rejects a ready response with three valid hints and an extra %s", async (_name, extra) => {
    const request = vi.fn(async () => ({
      ok: true,
      status: "ready",
      suggestions: [
        promptHint("Review current plan", "Review the current plan with me"),
        promptHint("Check next step", "Check the safest useful next step"),
        promptHint("Explain recent work", "Explain the most recent project work"),
        extra
      ]
    }));
    const { hints, scope } = createHints({}, { request });
    try {
      await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);

      expect(request).toHaveBeenCalledTimes(1);
      expect(hints.loading.value).toBe(false);
      expect(hints.suggestions.value).toEqual([]);
      expect(hints.status.value).toBe("idle");
      expect(hints.visible.value).toBe(false);
    } finally {
      scope.stop();
    }
  });

  it("dismisses on Escape until a new focus cycle or completed turn", () => {
    const { hints, scope } = createHints({ blankConversation: ref(true) });

    hints.focusComposer();
    expect(hints.visible.value).toBe(true);
    hints.dismissPromptHints();
    expect(hints.visible.value).toBe(false);

    hints.focusComposer();
    expect(hints.visible.value).toBe(false);
    hints.blurComposer();
    hints.focusComposer();
    expect(hints.visible.value).toBe(true);

    hints.dismissPromptHints();
    expect(hints.visible.value).toBe(false);
    scope.stop();

    const conversationKey = ref("conversation-1");
    const refreshed = createHints({
      blankConversation: ref(true),
      conversationKey
    });
    refreshed.hints.focusComposer();
    refreshed.hints.dismissPromptHints();
    conversationKey.value = "conversation-2";
    expect(refreshed.hints.visible.value).toBe(true);
    refreshed.scope.stop();
  });

  it("ends an inactive session's focus cycle and regenerates when it becomes active", async () => {
    const active = ref(true);
    const request = vi.fn(async () => ({
      cached: true,
      ok: true,
      status: "ready",
      suggestions: [
        promptHint("Review current plan", "Review the current plan with me"),
        promptHint("Check next step", "Check the safest useful next step"),
        promptHint("Explain recent work", "Explain the most recent project work")
      ]
    }));
    const { hints, scope } = createHints({ active }, { request });

    hints.focusComposer();
    expect(hints.composerFocused.value).toBe(true);
    active.value = false;
    await nextTick();
    expect(hints.composerFocused.value).toBe(false);
    expect(hints.visible.value).toBe(false);

    active.value = true;
    await nextTick();
    await vi.advanceTimersByTimeAsync(PROMPT_HINT_DEBOUNCE_MS);
    expect(request).toHaveBeenCalledTimes(1);
    expect(hints.status.value).toBe("ready");
    expect(hints.suggestions.value).toEqual([
      promptHint("Review current plan", "Review the current plan with me"),
      promptHint("Check next step", "Check the safest useful next step"),
      promptHint("Explain recent work", "Explain the most recent project work")
    ]);
    scope.stop();
  });

  it("fingerprints visible user and final assistant text, not object identity", () => {
    expect(promptHintConversationFingerprint([{
      assistant: { text: "Answer" },
      progressUpdates: [{ text: "Private progress" }],
      turnId: "turn-1",
      user: { text: "Question" }
    }])).toBe(JSON.stringify([{
      assistant: "Answer",
      turnId: "turn-1",
      user: "Question"
    }]));
  });

  it("fingerprints only the same recent visible-turn window used by the server", () => {
    const recentTurns = Array.from({ length: PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT }, (_, index) => ({
      assistant: { text: `Recent answer ${index}` },
      turnId: `recent-${index}`,
      user: { text: `Recent question ${index}` }
    }));
    const firstHistory = [
      { assistant: { text: "Old answer A" }, turnId: "old-a", user: { text: "Old A" } },
      ...recentTurns
    ];
    const secondHistory = [
      { assistant: { text: "Old answer B" }, turnId: "old-b", user: { text: "Old B" } },
      ...recentTurns
    ];

    const fingerprint = promptHintConversationFingerprint(firstHistory);
    expect(promptHintConversationFingerprint(secondHistory)).toBe(fingerprint);
    expect(JSON.parse(fingerprint)).toHaveLength(PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT);
    expect(fingerprint).not.toContain("Old answer");
  });
});
