import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ref } from "vue";

const mocks = vi.hoisted(() => ({
  beforeUnmount: [],
  realtimeOptions: [],
  requestCalls: [],
  requestResults: []
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
        return mocks.requestResults.shift() || {};
      }
    };
  }
}));

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((promiseResolve, promiseReject) => {
    resolve = promiseResolve;
    reject = promiseReject;
  });
  return {
    promise,
    reject,
    resolve
  };
}

describe("useVibe64ComposerDraftSync", () => {
  beforeEach(() => {
    mocks.beforeUnmount.length = 0;
    mocks.realtimeOptions.length = 0;
    mocks.requestCalls.length = 0;
    mocks.requestResults.length = 0;
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-16T01:00:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("publishes debounced composer draft changes through the session service route", async () => {
    const { PUBLISH_DEBOUNCE_MS, useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    await flushPromises();

    expect(mocks.requestCalls).toEqual([
      [
        "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
        {
          method: "GET",
          query: {
            controlId: "talk_to_codex",
            projectSlug: "vibe64"
          }
        }
      ]
    ]);

    sync.publishDraftChange("conversationRequest", {
      conversationRequest: "Hello",
      count: 2
    });

    expect(mocks.requestCalls).toHaveLength(1);
    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);
    await Promise.resolve();

    expect(mocks.requestCalls).toHaveLength(2);
    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
      {
        body: {
          baseRevision: 0,
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
    ]);
  });

  it("does not let pre-hydration local typing overwrite an existing remote draft", async () => {
    const read = deferred();
    mocks.requestResults.push(read.promise);
    const appliedDrafts = [];
    const values = ref({
      conversationRequest: ""
    });
    const { PUBLISH_DEBOUNCE_MS, useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      applyDraft: (draft) => {
        appliedDrafts.push(draft);
        values.value = draft;
      },
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      selectedControlValues: values,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });

    values.value = {
      conversationRequest: "Local early edit"
    };
    sync.publishDraftChange("conversationRequest", values.value);
    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);

    expect(mocks.requestCalls).toHaveLength(1);

    read.resolve({
      draft: {
        controlId: "talk_to_codex",
        fieldName: "conversationRequest",
        fields: {
          conversationRequest: "Existing remote draft"
        },
        originId: "other-tab",
        projectSlug: "vibe64",
        revision: 7,
        sessionId: "session-1",
        updatedAt: "2026-06-16T00:59:59.000Z"
      }
    });
    await flushPromises();

    expect(appliedDrafts.at(-1)).toEqual({
      conversationRequest: "Existing remote draft\n\nLocal early edit"
    });

    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);
    await Promise.resolve();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
      {
        body: {
          baseRevision: 7,
          controlId: "talk_to_codex",
          fieldName: "conversationRequest",
          fields: {
            conversationRequest: "Existing remote draft\n\nLocal early edit"
          },
          kind: "draft",
          originId: sync.originId,
          projectSlug: "vibe64",
          text: ""
        },
        method: "POST"
      }
    ]);
  });

  it("hydrates the active composer draft from the session service", async () => {
    mocks.requestResults.push({
      draft: {
        controlId: "talk_to_codex",
        fieldName: "conversationRequest",
        fields: {
          conversationRequest: "Remote draft"
        },
        originId: "other-tab",
        projectSlug: "vibe64",
        revision: 4,
        sessionId: "session-1",
        updatedAt: "2026-06-16T01:00:01.000Z"
      }
    });
    const appliedDrafts = [];
    const values = ref({
      conversationRequest: ""
    });
    const { useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
    );
    useVibe64ComposerDraftSync({
      applyDraft: (draft) => {
        appliedDrafts.push(draft);
        values.value = draft;
      },
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      selectedControlValues: values,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });

    await flushPromises();

    expect(appliedDrafts).toEqual([
      {
        conversationRequest: "Remote draft"
      }
    ]);
  });

  it("does not let an unversioned stale empty snapshot overwrite a hydrated draft", async () => {
    const appliedDrafts = [];
    const values = ref({
      conversationRequest: ""
    });
    const { useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
    );
    useVibe64ComposerDraftSync({
      applyDraft: (draft) => {
        appliedDrafts.push(draft);
        values.value = draft;
      },
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      selectedControlValues: values,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

    realtime.onEvent({
      payload: {
        fieldName: "conversationRequest",
        fields: {
          conversationRequest: "Shared draft"
        },
        revision: 8,
        updatedAt: "2026-06-16T01:00:02.000Z"
      }
    });
    realtime.onEvent({
      payload: {
        fieldName: "conversationRequest",
        fields: {
          conversationRequest: ""
        },
        updatedAt: "2026-06-16T00:59:59.000Z"
      }
    });

    expect(appliedDrafts).toEqual([
      {
        conversationRequest: "Shared draft"
      }
    ]);
    expect(values.value).toEqual({
      conversationRequest: "Shared draft"
    });
  });

  it("applies matching remote drafts and ignores same-origin events", async () => {
    const appliedDrafts = [];
    const { useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
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
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
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
      submissionId: "composer:tab:test:1:1",
      text: "Hello"
    });

    expect(mocks.requestCalls).toHaveLength(2);
    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
      {
        body: {
          baseRevision: 0,
          controlId: "talk_to_codex",
          fieldName: "conversationRequest",
          fields: {
            conversationRequest: "Hello"
          },
          kind: "submission_start",
          originId: sync.originId,
          projectSlug: "vibe64",
          submissionId: "composer:tab:test:1:1",
          text: "Hello"
        },
        method: "POST"
      }
    ]);

    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);
    await Promise.resolve();
    expect(mocks.requestCalls).toHaveLength(2);
  });

  it("routes remote submission events separately from draft merging", async () => {
    const events = [];
    const { useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
    );
    useVibe64ComposerDraftSync({
      applyDraft: (draft) => events.push(["draft", draft]),
      applySubmissionRejected: (draft) => events.push(["rejected", draft]),
      applySubmissionStart: (draft, payload) => events.push(["start", draft, payload.text]),
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

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
      }],
      ["draft", {
        conversationRequest: "Remote draft"
      }]
    ]);
  });

  it("merges non-overlapping remote drafts with local typing and republishes the merged draft", async () => {
    mocks.requestResults.push({
      draft: {
        controlId: "talk_to_codex",
        fieldName: "conversationRequest",
        fields: {
          conversationRequest: "Hello world"
        },
        originId: "other-tab",
        projectSlug: "vibe64",
        revision: 1,
        sessionId: "session-1",
        updatedAt: "2026-06-16T01:00:00.000Z"
      }
    });
    const appliedDrafts = [];
    const values = ref({
      conversationRequest: "Hello world"
    });
    const { PUBLISH_DEBOUNCE_MS, useVibe64ComposerDraftSync } = await import(
      "../../src/composables/vibe64-session/composer/useVibe64ComposerDraftSync.js"
    );
    const sync = useVibe64ComposerDraftSync({
      applyDraft: (draft) => {
        appliedDrafts.push(draft);
        values.value = draft;
      },
      projectSlug: ref("vibe64"),
      selectedControl: ref({ id: "talk_to_codex" }),
      selectedControlValues: values,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/vibe64/sessions")
    });
    const realtime = mocks.realtimeOptions.at(-1);

    await flushPromises();
    values.value = {
      conversationRequest: "Hello brave world"
    };
    sync.publishDraftChange("conversationRequest", {
      conversationRequest: "Hello brave world"
    });
    realtime.onEvent({
      payload: {
        fieldName: "conversationRequest",
        fields: {
          conversationRequest: "Say Hello world"
        },
        revision: 2,
        updatedAt: "2026-06-16T01:00:02.000Z"
      }
    });

    expect(appliedDrafts.at(-1)).toEqual({
      conversationRequest: "Say Hello brave world"
    });

    vi.advanceTimersByTime(PUBLISH_DEBOUNCE_MS);
    await Promise.resolve();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/vibe64/sessions/session-1/composer-draft",
      {
        body: {
          baseRevision: 2,
          controlId: "talk_to_codex",
          fieldName: "conversationRequest",
          fields: {
            conversationRequest: "Say Hello brave world"
          },
          kind: "draft",
          originId: sync.originId,
          projectSlug: "vibe64",
          text: ""
        },
        method: "POST"
      }
    ]);
  });
});
