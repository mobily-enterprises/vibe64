import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mocks = vi.hoisted(() => ({
  beforeUnmount: [],
  realtimeOptions: [],
  requestCalls: []
}));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount(callback) {
      mocks.beforeUnmount.push(callback);
    }
  };
});

vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options) {
    mocks.realtimeOptions.push(options);
  }
}));

vi.mock("@jskit-ai/users-web/client/lib/httpClient", () => ({
  getUsersWebHttpClient() {
    return {
      async request(...args) {
        mocks.requestCalls.push(args);
        return {};
      }
    };
  }
}));

describe("useVibe64ComposerDraftSync", () => {
  beforeEach(() => {
    mocks.beforeUnmount.length = 0;
    mocks.realtimeOptions.length = 0;
    mocks.requestCalls.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T01:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes debounced composer draft changes through the session service route", async () => {
    const { PUBLISH_DEBOUNCE_MS, useVibe64ComposerDraftSync } = await import(
      "../../src/composables/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });

    sync.publishDraftChange("conversationRequest", {
      conversationRequest: "Hello",
      count: 2
    });

    expect(mocks.requestCalls).toHaveLength(0);
    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);
    await Promise.resolve();

    expect(mocks.requestCalls).toEqual([
      [
        "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
        {
          body: {
            controlId: "talk_to_codex",
            fieldName: "conversationRequest",
            fields: {
              conversationRequest: "Hello",
              count: "2"
            },
            kind: "draft",
            originId: sync.originId,
            projectSlug: "vibe64",
            text: ""
          },
          method: "POST"
        }
      ]
    ]);
  });

  it("applies matching remote drafts and ignores same-origin events", async () => {
    const appliedDrafts = [];
    const { useVibe64ComposerDraftSync } = await import(
      "../../src/composables/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      applyDraft: (draft) => appliedDrafts.push(draft),
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

    expect(realtime.matches({
      payload: {
        controlId: "talk_to_codex",
        originId: "other-tab",
        projectSlug: "vibe64",
        sessionId: "session-1"
      }
    })).toBe(true);
    expect(realtime.matches({
      payload: {
        controlId: "talk_to_codex",
        originId: sync.originId,
        projectSlug: "vibe64",
        sessionId: "session-1"
      }
    })).toBe(false);

    realtime.onEvent({
      payload: {
        fields: {
          "": "ignored",
          conversationRequest: "Remote"
        }
      }
    });

    expect(appliedDrafts).toEqual([
      {
        conversationRequest: "Remote"
      }
    ]);
  });

  it("publishes submission start immediately and cancels a pending draft publish", async () => {
    const { PUBLISH_DEBOUNCE_MS, useVibe64ComposerDraftSync } = await import(
      "../../src/composables/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });

    sync.publishDraftChange("conversationRequest", {
      conversationRequest: "Hello"
    });
    sync.publishSubmissionStart("conversationRequest", {
      conversationRequest: "Hello"
    }, {
      text: "Hello"
    });

    expect(mocks.requestCalls).toEqual([
      [
        "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
        {
          body: {
            controlId: "talk_to_codex",
            fieldName: "conversationRequest",
            fields: {
              conversationRequest: "Hello"
            },
            kind: "submission_start",
            originId: sync.originId,
            projectSlug: "vibe64",
            text: "Hello"
          },
          method: "POST"
        }
      ]
    ]);

    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);
    await Promise.resolve();
    expect(mocks.requestCalls).toHaveLength(1);
  });

  it("routes remote submission events outside the local typing grace window", async () => {
    const events = [];
    const { useVibe64ComposerDraftSync } = await import(
      "../../src/composables/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      applyDraft: (draft) => events.push(["draft", draft]),
      applySubmissionRejected: (draft) => events.push(["rejected", draft]),
      applySubmissionStart: (draft, payload) => events.push(["start", draft, payload.text]),
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

    sync.publishDraftChange("conversationRequest", {
      conversationRequest: "Local"
    });
    realtime.onEvent({
      payload: {
        fields: {
          conversationRequest: "Remote submit"
        },
        kind: "submission_start",
        text: "Remote submit"
      }
    });
    realtime.onEvent({
      payload: {
        fields: {
          conversationRequest: "Remote restore"
        },
        kind: "submission_rejected"
      }
    });
    realtime.onEvent({
      payload: {
        fields: {
          conversationRequest: "Remote draft"
        },
        kind: "draft"
      }
    });

    expect(events).toEqual([
      ["start", {
        conversationRequest: "Remote submit"
      }, "Remote submit"],
      ["rejected", {
        conversationRequest: "Remote restore"
      }]
    ]);
  });

  it("keeps local typing in control while the local edit grace window is active", async () => {
    const appliedDrafts = [];
    const { LOCAL_TYPING_GRACE_MS, useVibe64ComposerDraftSync } = await import(
      "../../src/composables/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      applyDraft: (draft) => appliedDrafts.push(draft),
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

    sync.publishDraftChange("conversationRequest", {
      conversationRequest: "Local"
    });
    realtime.onEvent({
      payload: {
        fields: {
          conversationRequest: "Remote"
        }
      }
    });

    expect(appliedDrafts).toEqual([]);

    vi.advanceTimersByTime(LOCAL_TYPING_GRACE_MS);
    realtime.onEvent({
      payload: {
        fields: {
          conversationRequest: "Later remote"
        }
      }
    });

    expect(appliedDrafts).toEqual([
      {
        conversationRequest: "Later remote"
      }
    ]);
  });
});
