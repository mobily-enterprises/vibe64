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
  revealTree = null,
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
    ...(revealTree ? { revealTree } : {}),
    ok: true
  };
}

function revealTreeForNestedFile(filePath = "src/pages/admin/index.jsx") {
  const segments = String(filePath || "").split("/").filter(Boolean);
  let node = {
    language: "javascript",
    name: segments.at(-1) || filePath,
    path: filePath,
    size: 20,
    type: "file"
  };
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const directoryPath = segments.slice(0, index).join("/");
    node = {
      children: [node],
      name: segments[index - 1],
      path: directoryPath,
      type: "directory"
    };
  }
  return {
    children: node ? [node] : [],
    name: "",
    path: "",
    type: "directory"
  };
}

function realtimeForEvent(event) {
  return mocks.realtimeOptions.find((options) => options.event === event);
}

async function createLoadedEditor({
  currentText,
  navigateReferencedSource = null,
  projectSlug = "beepollen",
  sessionId = "session-1"
} = {}) {
  const {
    useVibe64SourceEditor
  } = await import("../../src/composables/useVibe64SourceEditor.js");
  mocks.requestResults.push(treeResponse());
  const editor = useVibe64SourceEditor({
    navigateReferencedSource,
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

  it("allows an immersive surface to intercept a resolved source reference", async () => {
    const currentText = ref("");
    const navigateReferencedSource = vi.fn(async () => true);
    const editor = await createLoadedEditor({
      currentText,
      navigateReferencedSource
    });
    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push({
      path: "src/other.js",
      resolved: true,
      target: "./other.js"
    });

    await expect(editor.openReferencedSourcePath({
      fromPath: "src/app.js",
      target: "./other.js"
    })).resolves.toBe(true);

    expect(navigateReferencedSource).toHaveBeenCalledWith({
      fromPath: "src/app.js",
      path: "src/other.js",
      target: "./other.js"
    });
    expect(mocks.requestCalls).toHaveLength(requestCount + 1);
    expect(editor.selectedPath.value).toBe("src/app.js");
  });

  it("exposes the requested path while a different file is loading", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let resolveFile;
    mocks.requestResults.push(new Promise((resolve) => {
      resolveFile = resolve;
    }));

    const opening = editor.openFile("src/other.js");
    await flushPromises();

    expect(editor.loadingFile.value).toBe(true);
    expect(editor.loadingPath.value).toBe("src/other.js");
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.text.value).toBe("console.log('one');\n");
    expect(editor.statusLabel.value).toBe("Opening...");

    resolveFile(fileResponse({
      hash: "other-hash",
      path: "src/other.js",
      text: "console.log('other');\n"
    }));
    await opening;

    expect(editor.loadingFile.value).toBe(false);
    expect(editor.loadingPath.value).toBe("");
    expect(editor.selectedPath.value).toBe("src/other.js");
    expect(editor.text.value).toBe("console.log('other');\n");
  });

  it("creates a new source file and opens it", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    mocks.requestResults.push(fileResponse({
      hash: "hash-new",
      path: "src/pages/new-view.jsx",
      revealTree: revealTreeForNestedFile("src/pages/new-view.jsx"),
      text: ""
    }));

    const created = await editor.createFile("src/pages/new-view.jsx");
    await flushPromises();

    expect(created).toBe(true);
    expect(mocks.requestCalls.find(([url, options]) => (
      url === "/api/app/vibe64/sessions/session-1/source-editor/file" &&
      options?.method === "POST"
    ))).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file",
      {
        body: {
          originId: expect.stringMatching(/^tab:/u),
          path: "src/pages/new-view.jsx",
          projectSlug: "beepollen"
        },
        method: "POST"
      }
    ]);
    expect(editor.selectedPath.value).toBe("src/pages/new-view.jsx");
    expect(editor.text.value).toBe("");
    expect(editor.savedHash.value).toBe("hash-new");
    expect(editor.dirty.value).toBe(false);
    expect(editor.revealedDirectoryPaths.value).toEqual([
      "src",
      "src/pages"
    ]);
    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/open-file",
      {
        body: {
          originId: expect.stringMatching(/^tab:/u),
          path: "src/pages/new-view.jsx",
          projectSlug: "beepollen"
        },
        method: "POST"
      }
    ]);
  });

  it("requests abandoned explanation cleanup after startup", async () => {
    const currentText = ref("");
    const {
      useVibe64SourceEditor
    } = await import("../../src/composables/useVibe64SourceEditor.js");
    mocks.requestResults.push(treeResponse());

    useVibe64SourceEditor({
      projectSlug: ref("beepollen"),
      readCurrentText: () => currentText.value,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });
    await flushPromises();

    const cleanupCall = mocks.requestCalls.find(([url]) => url.endsWith("/source-editor/explanations/cleanup"));
    expect(cleanupCall).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/explanations/cleanup",
      {
        body: {
          activeExplanationIds: [],
          originId: expect.stringMatching(/^tab:/u)
        },
        method: "POST"
      }
    ]);
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
      path: "src/pages/admin/index.jsx",
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
        path: "src/pages/admin/index.jsx",
        revealTree: revealTreeForNestedFile(),
        text: "export default null;\n"
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

    expect(editor.selectedPath.value).toBe("src/pages/admin/index.jsx");
    expect(editor.text.value).toBe("export default null;\n");
    expect(editor.revealedDirectoryPaths.value).toEqual([
      "src",
      "src/pages",
      "src/pages/admin"
    ]);
    expect(editor.tree.value.children[0].children[0].children[0].children[0].path)
      .toBe("src/pages/admin/index.jsx");
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
