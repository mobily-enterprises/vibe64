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

function treeResponse() {
  return {
    ok: true,
    policy: {},
    tree: {
      children: [],
      name: "",
      path: "",
      type: "directory"
    }
  };
}

function fileResponse({
  hash = "hash-1",
  path = "src/app.js",
  text = "console.log('one');\n"
} = {}) {
  return {
    file: {
      hash,
      mtimeMs: 1,
      path,
      size: text.length,
      text
    },
    ok: true
  };
}

function realtimeForEvent(event) {
  return mocks.realtimeOptions.find((options) => options.event === event);
}

async function createLoadedEditor({
  currentText,
  projectSlug = "beepollen",
  sessionId = "session-1"
} = {}) {
  const {
    useVibe64SourceEditor
  } = await import("../../src/composables/useVibe64SourceEditor.js");
  mocks.requestResults.push(treeResponse());
  const editor = useVibe64SourceEditor({
    projectSlug: ref(projectSlug),
    readCurrentText: () => currentText.value,
    sessionId: ref(sessionId),
    sessionsApiPath: ref("/api/app/vibe64/sessions")
  });
  await flushPromises();
  mocks.requestResults.push(fileResponse());
  await editor.openFile("src/app.js");
  currentText.value = editor.text.value;
  await flushPromises();
  return editor;
}

describe("useVibe64SourceEditor", () => {
  beforeEach(() => {
    mocks.beforeUnmount.length = 0;
    mocks.realtimeOptions.length = 0;
    mocks.requestCalls.length = 0;
    mocks.requestResults.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("saves source editor files with origin and project scope", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    currentText.value = "console.log('two');\n";
    editor.updateText();
    mocks.requestResults.push(fileResponse({
      hash: "hash-2",
      text: ""
    }));

    await editor.saveNow();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file",
      {
        body: {
          baseHash: "hash-1",
          originId: expect.stringMatching(/^tab:/u),
          path: "src/app.js",
          projectSlug: "beepollen",
          text: "console.log('two');\n"
        },
        method: "PUT"
      }
    ]);
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.dirty.value).toBe(false);
  });

  it("reloads a clean open file after a matching remote save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");

    expect(realtime.matches({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    })).toBe(true);
    expect(realtime.matches({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "other",
        sessionId: "session-1"
      }
    })).toBe(false);

    mocks.requestResults.push(fileResponse({
      hash: "hash-2",
      text: "console.log('remote');\n"
    }));
    realtime.onEvent({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    });
    await flushPromises();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js",
      {}
    ]);
    expect(editor.text.value).toBe("console.log('remote');\n");
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.dirty.value).toBe(false);
  });

  it("publishes opened files and follows matching remote opened-file events", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const openPublishCall = mocks.requestCalls.find((call) => call[0].endsWith("/source-editor/open-file"));
    const realtime = realtimeForEvent("vibe64.source-editor.file.opened");

    expect(openPublishCall).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/open-file",
      {
        body: {
          originId: expect.stringMatching(/^tab:/u),
          path: "src/app.js",
          projectSlug: "beepollen"
        },
        method: "POST"
      }
    ]);
    expect(realtime.matches({
      payload: {
        originId: "other-tab",
        path: "src/other.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    })).toBe(true);
    expect(realtime.matches({
      payload: {
        originId: "other-tab",
        path: "src/other.js",
        projectSlug: "other",
        sessionId: "session-1"
      }
    })).toBe(false);

    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push(fileResponse({
      hash: "hash-other",
      path: "src/other.js",
      text: "console.log('other');\n"
    }));
    realtime.onEvent({
      payload: {
        originId: "other-tab",
        path: "src/other.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    });
    await flushPromises();

    expect(mocks.requestCalls).toHaveLength(requestCount + 1);
    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fother.js",
      {}
    ]);
    expect(editor.selectedPath.value).toBe("src/other.js");
    expect(editor.text.value).toBe("console.log('other');\n");
  });

  it("opens the selected file from session startup state without publishing it back", async () => {
    const currentText = ref("");
    const openSyncState = ref({
      originId: "other-tab",
      path: "src/other.js",
      projectSlug: "beepollen",
      sessionId: "session-1",
      updatedAt: "2026-07-02T00:00:00.000Z"
    });
    const {
      useVibe64SourceEditor
    } = await import("../../src/composables/useVibe64SourceEditor.js");
    mocks.requestResults.push(
      treeResponse(),
      fileResponse({
        hash: "hash-other",
        path: "src/other.js",
        text: "console.log('other');\n"
      })
    );

    const editor = useVibe64SourceEditor({
      openSyncState,
      projectSlug: ref("beepollen"),
      readCurrentText: () => currentText.value,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });
    await flushPromises();

    expect(editor.selectedPath.value).toBe("src/other.js");
    expect(editor.text.value).toBe("console.log('other');\n");
    expect(mocks.requestCalls.some(([url]) => url.endsWith("/source-editor/open-file"))).toBe(false);
  });

  it("warns instead of switching files when a remote open arrives during local edits", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const requestCount = mocks.requestCalls.length;
    const realtime = realtimeForEvent("vibe64.source-editor.file.opened");
    const {
      SOURCE_EDITOR_REMOTE_OPEN_MESSAGE
    } = await import("../../src/composables/useVibe64SourceEditor.js");

    currentText.value = "console.log('local');\n";
    editor.updateText();
    realtime.onEvent({
      payload: {
        originId: "other-tab",
        path: "src/other.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    });
    await flushPromises();

    expect(mocks.requestCalls).toHaveLength(requestCount);
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.saveError.value).toBe(SOURCE_EDITOR_REMOTE_OPEN_MESSAGE);
  });

  it("warns instead of overwriting a dirty file after a matching remote save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const requestCount = mocks.requestCalls.length;
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    const {
      SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE
    } = await import("../../src/composables/useVibe64SourceEditor.js");

    currentText.value = "console.log('local');\n";
    editor.updateText();
    realtime.onEvent({
      payload: {
        hash: "hash-2",
        originId: "other-tab",
        path: "src/app.js",
        projectSlug: "beepollen",
        sessionId: "session-1"
      }
    });
    await flushPromises();

    expect(mocks.requestCalls).toHaveLength(requestCount);
    expect(editor.saveError.value).toBe(SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE);
    expect(editor.dirty.value).toBe(true);
  });
});
