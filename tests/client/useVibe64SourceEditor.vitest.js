import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { nextTick, ref } from "vue";

const mocks = vi.hoisted(() => ({
  beforeUnmount: [],
  feedbackErrors: [],
  fileSyncOptions: [],
  realtimeOptions: [],
  requestCalls: [],
  requestResults: [],
  streamCalls: [],
  streamEvents: []
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

vi.mock("@jskit-ai/http-web/client/composables/useUiFeedback", () => ({
  useUiFeedback() {
    return {
      error(...args) {
        mocks.feedbackErrors.push(args);
      }
    };
  }
}));

vi.mock("@/composables/useVibe64SourceEditorFileSync.js", () => ({
  useVibe64SourceEditorFileSync(options) {
    mocks.fileSyncOptions.push(options);
  }
}));

vi.mock("@jskit-ai/http-web/client/lib/httpClient", () => ({
  getHttpWebClient() {
    return {
      async request(...args) {
        mocks.requestCalls.push(args);
        return mocks.requestResults.shift() || {};
      },
      async requestStream(...args) {
        mocks.streamCalls.push(args.slice(0, 2));
        const events = await (mocks.streamEvents.shift() || []);
        for (const event of events) {
          args[2]?.onEvent?.(event);
        }
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
  active = true,
  agentActive = false,
  currentText,
  navigateReferencedSource = null,
  openFile = true,
  projectSlug = "beepollen",
  sessionId = "session-1"
} = {}) {
  const {
    useVibe64SourceEditor
  } = await import("../../src/composables/useVibe64SourceEditor.js");
  mocks.requestResults.push(treeResponse());
  const editor = useVibe64SourceEditor({
    active,
    agentActive,
    navigateReferencedSource,
    projectSlug: ref(projectSlug),
    readCurrentText: () => currentText.value,
    sessionId: ref(sessionId),
    sessionsApiPath: ref("/api/app/vibe64/sessions")
  });
  await flushPromises();
  if (openFile) {
    mocks.requestResults.push(fileResponse());
    await editor.openFile("src/app.js");
    currentText.value = editor.text.value;
    await flushPromises();
  }
  return editor;
}

describe("useVibe64SourceEditor", () => {
  beforeEach(() => {
    mocks.beforeUnmount.length = 0;
    mocks.feedbackErrors.length = 0;
    mocks.fileSyncOptions.length = 0;
    mocks.realtimeOptions.length = 0;
    mocks.requestCalls.length = 0;
    mocks.requestResults.length = 0;
    mocks.streamCalls.length = 0;
    mocks.streamEvents.length = 0;
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.clearAllTimers();
    vi.useRealTimers();
    vi.resetModules();
  });

  it("refreshes the tree and clean selected file once the assistant finishes, without clearing the tree", async () => {
    const currentText = ref("");
    const agentActive = ref(false);
    const editor = await createLoadedEditor({ currentText, agentActive });
    const oldTree = editor.tree.value;
    const before = mocks.requestCalls.length;
    agentActive.value = true;
    await nextTick();
    expect(mocks.requestCalls.length).toBe(before);
    let releaseTree;
    mocks.requestResults.push(new Promise((resolve) => { releaseTree = resolve; }), fileResponse({ hash: "hash-2", text: "changed by assistant" }));
    agentActive.value = false;
    await nextTick();
    expect(editor.tree.value).toBe(oldTree);
    releaseTree(treeResponse());
    for (let count = 0; count < 6; count += 1) await flushPromises();
    expect(mocks.requestCalls.length).toBe(before + 2);
    expect(editor.text.value).toBe("changed by assistant");
    expect(editor.selectedPath.value).toBe("src/app.js");
  });

  it("defers completed-turn refresh while Files is hidden and preserves unsaved edits on return", async () => {
    const currentText = ref("");
    const active = ref(true);
    const agentActive = ref(true);
    const editor = await createLoadedEditor({ currentText, active, agentActive });
    currentText.value = "my unsaved changes";
    editor.updateText();
    active.value = false;
    await nextTick();
    const before = mocks.requestCalls.length;
    agentActive.value = false;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.length).toBe(before);
    mocks.requestResults.push(treeResponse(), fileResponse({ hash: "hash-2", text: "agent changes" }));
    active.value = true;
    await nextTick();
    for (let count = 0; count < 6; count += 1) await flushPromises();
    expect(mocks.requestCalls.length).toBe(before + 2);
    expect(currentText.value).toBe("my unsaved changes");
    expect(editor.dirty.value).toBe(true);
    expect(editor.saveError.value).toContain("changed");
  });

  it("refreshes only loaded directory pages and commits their replacement together", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText, openFile: false });
    editor.tree.value = { type: "directory", path: "", loaded: true, children: [
      { type: "directory", path: "src", name: "src", loaded: true, children: [{ type: "file", path: "src/old.js", name: "old.js" }] },
      { type: "directory", path: "huge", name: "huge", loaded: false, children: [] }
    ] };
    const previousTree = editor.tree.value;
    const newRoot = treeResponse();
    newRoot.tree.children = ["src", "huge"].map((path) => ({ type: "directory", name: path, path, loaded: false, children: [] }));
    let finishDirectory;
    mocks.requestResults.push(newRoot, new Promise((resolve) => { finishDirectory = resolve; }));
    const before = mocks.requestCalls.length;
    const refreshing = editor.refresh();
    await flushPromises();
    expect(editor.tree.value).toBe(previousTree);
    finishDirectory({ ok: true, tree: { type: "directory", path: "src", name: "src", loaded: true, children: [{ type: "file", path: "src/new.js", name: "new.js" }] } });
    await refreshing;
    expect(mocks.requestCalls.slice(before).map(([url]) => url)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/tree?limit=20",
      "/api/app/vibe64/sessions/session-1/source-editor/tree?path=src&limit=20"
    ]);
    expect(editor.tree.value.children[0].children.map((file) => file.path)).toEqual(["src/new.js"]);
  });

  it("does not resurrect a deleted file from the selected-file reveal cache", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText, openFile: false });
    mocks.requestResults.push(fileResponse({ revealTree: revealTreeForNestedFile("src/app.js") }));
    await editor.openFile("src/app.js");
    mocks.requestResults.push(treeResponse(), { ok: false, error: "File no longer exists" });
    await editor.refresh();
    expect(editor.tree.value.children).toEqual([]);
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.loadError.value).toContain("File no longer exists");
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

  it("coalesces concurrent saves and persists edits made during a save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    let finishFirstSave;
    mocks.requestResults.push(new Promise((resolve) => {
      finishFirstSave = resolve;
    }));
    currentText.value = "console.log('two');\n";
    editor.updateText();
    const saving = editor.saveNow();
    await flushPromises();

    currentText.value = "console.log('three');\n";
    editor.updateText();
    mocks.requestResults.push(fileResponse({
      hash: "hash-3",
      text: ""
    }));
    finishFirstSave(fileResponse({
      hash: "hash-2",
      text: ""
    }));
    await saving;

    const saveBodies = mocks.requestCalls
      .filter(([, options]) => options?.method === "PUT")
      .map(([, options]) => options.body);
    expect(saveBodies.map((body) => body.text)).toEqual([
      "console.log('two');\n",
      "console.log('three');\n"
    ]);
    expect(saveBodies[1].baseHash).toBe("hash-2");
    expect(editor.savedHash.value).toBe("hash-3");
    expect(editor.dirty.value).toBe(false);
  });

  it("preserves the last draft when unmount starts its save", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let finishSave;
    mocks.requestResults.push(new Promise((resolve) => {
      finishSave = resolve;
    }));
    currentText.value = "console.log('leaving');\n";
    editor.updateText();

    for (const beforeUnmount of mocks.beforeUnmount) {
      beforeUnmount();
    }
    const saving = editor.saveNow();
    // The component destroys CodeMirror after the composable's cleanup hook.
    currentText.value = "";
    finishSave(fileResponse({ hash: "hash-leaving", text: "" }));
    await saving;

    const saveBodies = mocks.requestCalls
      .filter(([, options]) => options?.method === "PUT")
      .map(([, options]) => options.body);
    expect(saveBodies.map((body) => body.text)).toEqual(["console.log('leaving');\n"]);
    expect(editor.savedHash.value).toBe("hash-leaving");
    expect(editor.dirty.value).toBe(false);
  });

  it.each([
    { finalText: "console.log('last edit');\n", label: "a newer draft" },
    { finalText: "", label: "an intentionally empty draft" }
  ])("preserves $label on unmount while a save is in flight", async ({ finalText }) => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let finishFirstSave;
    mocks.requestResults.push(new Promise((resolve) => {
      finishFirstSave = resolve;
    }));
    currentText.value = "console.log('saving');\n";
    editor.updateText();
    const saving = editor.saveNow();
    await flushPromises();

    currentText.value = finalText;
    editor.updateText();
    for (const beforeUnmount of mocks.beforeUnmount) {
      beforeUnmount();
    }
    currentText.value = "";
    mocks.requestResults.push(fileResponse({ hash: "hash-final", text: "" }));
    finishFirstSave(fileResponse({ hash: "hash-first", text: "" }));
    await saving;

    const saveBodies = mocks.requestCalls
      .filter(([, options]) => options?.method === "PUT")
      .map(([, options]) => options.body);
    expect(saveBodies.map((body) => body.text)).toEqual([
      "console.log('saving');\n",
      finalText
    ]);
    expect(saveBodies[1].baseHash).toBe("hash-first");
    expect(editor.savedHash.value).toBe("hash-final");
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
    expect(mocks.requestCalls.some(([url]) => url.endsWith("/source-editor/open-file"))).toBe(false);
  });

  it.each(["vibe64_source_editor_binary_file", "vibe64_source_editor_file_too_large"])(
    "keeps %s available for download outside the editable buffer",
    async (code) => {
      const currentText = ref("");
      const editor = await createLoadedEditor({ currentText });
      currentText.value = "saved before switching";
      editor.updateText();
      mocks.requestResults.push(
        fileResponse({ text: currentText.value }),
        { ok: false, code, error: "Cannot edit this file." }
      );

      expect(await editor.openFile("docs/staff guide.docx")).toBe(true);
      expect(editor.downloadOnlyFile.value.path).toBe("docs/staff guide.docx");
      expect(editor.selectedPath.value).toBe("");
      expect(editor.text.value).toBe("");
      expect(editor.savedHash.value).toBe("");
      expect(editor.dirty.value).toBe(false);
      expect(editor.loadingPath.value).toBe("");
      expect(editor.loadError.value).toBe("");
      expect(mocks.fileSyncOptions[0].path.value).toBe("");
      const writes = mocks.requestCalls.filter(([, options]) => options?.method === "PUT");
      expect(writes).toHaveLength(1);
      expect(writes[0][1].body).toMatchObject({ path: "src/app.js", text: currentText.value });

      mocks.requestResults.push(treeResponse());
      await editor.refresh();
      await editor.saveNow();
      expect(editor.downloadOnlyFile.value.path).toBe("docs/staff guide.docx");
      expect(mocks.requestCalls.filter(([, options]) => options?.method === "PUT")).toHaveLength(1);

      mocks.requestResults.push(fileResponse());
      expect(await editor.openFile("src/app.js")).toBe(true);
      expect(editor.downloadOnlyFile.value).toBeNull();
      expect(editor.selectedPath.value).toBe("src/app.js");
    }
  );

  it("does not turn access or missing-file errors into downloadable selections", async () => {
    const editor = await createLoadedEditor({ currentText: ref("") });
    for (const code of ["vibe64_source_editor_file_missing", "forbidden"]) {
      mocks.requestResults.push({ ok: false, code, error: "File unavailable." });
      expect(await editor.openFile("docs/staff.docx")).toBe(false);
      expect(editor.downloadOnlyFile.value).toBeNull();
      expect(editor.selectedPath.value).toBe("src/app.js");
      expect(editor.loadError.value).toBe("File unavailable.");
    }
  });

  it("discards a late binary response after another selection or session change", async () => {
    const sessionId = ref("session-1");
    const editor = await createLoadedEditor({ currentText: ref(""), sessionId });
    for (const changeSession of [false, true]) {
      let resolveFile;
      mocks.requestResults.push(new Promise((resolve) => { resolveFile = resolve; }));
      const opening = editor.openFile("docs/staff.docx");
      if (changeSession) {
        mocks.requestResults.push(treeResponse());
        sessionId.value = "session-2";
        await nextTick();
      } else {
        mocks.requestResults.push(fileResponse());
        await editor.openFile("src/app.js");
      }
      resolveFile({ ok: false, code: "vibe64_source_editor_binary_file", error: "Binary file." });
      expect(await opening).toBe(false);
      expect(editor.downloadOnlyFile.value).toBeNull();
      expect(editor.selectedPath.value).toBe(changeSession ? "" : "src/app.js");
    }
  });

  it("clears the downloadable selection on session change", async () => {
    const sessionId = ref("session-1");
    const editor = await createLoadedEditor({ currentText: ref(""), sessionId });
    mocks.requestResults.push({ ok: false, code: "vibe64_source_editor_binary_file", error: "Binary file." });
    await editor.openFile("docs/staff.docx");
    mocks.requestResults.push(treeResponse());
    sessionId.value = "session-2";
    await nextTick();
    expect(editor.downloadOnlyFile.value).toBeNull();
  });

  it("reloads the source tree after another tab creates a file", async () => {
    const currentText = ref("");
    await createLoadedEditor({ currentText });
    const payload = {
      operation: "created",
      originId: "other-tab",
      path: "src/new.js",
      projectSlug: "beepollen",
      sessionId: "session-1"
    };
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push(treeResponse());

    expect(realtime.matches({ payload })).toBe(true);
    realtime.onEvent({ payload });
    await flushPromises();

    expect(mocks.requestCalls.slice(requestCount)).toEqual([[
      "/api/app/vibe64/sessions/session-1/source-editor/tree?limit=20",
      {}
    ]]);
  });

  it.each([false, true])("coalesces hidden foreign creates into one tree refresh on return (selected file: %s)", async (selected) => {
    const active = ref(true);
    const currentText = ref("");
    const editor = await createLoadedEditor({ active, currentText, openFile: selected });
    if (selected) {
      currentText.value = "console.log('local draft');\n";
      editor.updateText();
    }
    const selectedPath = editor.selectedPath.value;
    const loadedVersion = editor.loadedVersion.value;
    const currentDraft = currentText.value;
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    active.value = false;
    await nextTick();
    const requestCount = mocks.requestCalls.length;
    for (const path of ["new-one.js", "new-two.js"]) {
      const payload = {
        operation: "created",
        originId: "other-tab",
        path,
        projectSlug: "beepollen",
        sessionId: "session-1"
      };
      if (realtime.enabled.value && realtime.matches({ payload })) realtime.onEvent({ payload });
    }
    await flushPromises();
    expect(mocks.requestCalls).toHaveLength(requestCount);

    const updatedTree = treeResponse();
    updatedTree.tree.children = ["new-one.js", "new-two.js"].map((path) => ({
      name: path, path, type: "file"
    }));
    mocks.requestResults.push(updatedTree);
    if (selected) mocks.requestResults.push(fileResponse());
    active.value = true;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls.slice(requestCount)).toEqual([[
      "/api/app/vibe64/sessions/session-1/source-editor/tree?limit=20", {}
    ], ...(selected ? [["/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js", {}]] : [])]);
    expect(editor.tree.value.children.map(({ path }) => path)).toEqual(["new-one.js", "new-two.js"]);
    expect(editor.selectedPath.value).toBe(selectedPath);
    expect(editor.loadedVersion.value).toBe(loadedVersion);
    expect(editor.dirty.value).toBe(selected);
    expect(currentText.value).toBe(currentDraft);

    active.value = false;
    await nextTick();
    active.value = true;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toHaveLength(requestCount + 1 + Number(selected));
    expect(editor.selectedPath.value).toBe(selectedPath);
    expect(currentText.value).toBe(currentDraft);
  });

  it.each(["session", "API path"])("discards hidden tree invalidation when the %s changes in the same batch as reactivation", async (changedContext) => {
    const active = ref(true);
    const sessionId = ref("session-1");
    const sessionsApiPath = ref("/api/app/vibe64/sessions");
    const { useVibe64SourceEditor } = await import("../../src/composables/useVibe64SourceEditor.js");
    mocks.requestResults.push(treeResponse());
    const editor = useVibe64SourceEditor({ active, projectSlug: "beepollen", sessionId, sessionsApiPath });
    await flushPromises();
    active.value = false;
    await nextTick();
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    const payload = {
      operation: "created", originId: "other-tab", path: "old-source.js",
      projectSlug: "beepollen", sessionId: "session-1"
    };
    const requestCount = mocks.requestCalls.length;
    if (realtime.enabled.value && realtime.matches({ payload })) realtime.onEvent({ payload });
    await flushPromises();
    expect(mocks.requestCalls).toHaveLength(requestCount);

    mocks.requestResults.push(treeResponse());
    if (changedContext === "session") sessionId.value = "session-2";
    else sessionsApiPath.value = "/api/next/vibe64/sessions";
    active.value = true;
    await nextTick();
    await flushPromises();
    const currentSource = `${sessionsApiPath.value}/${sessionId.value}/source-editor`;
    expect(mocks.requestCalls.slice(requestCount).map(([url]) => url)).toEqual([
      `${currentSource}/tree?limit=20`, `${currentSource}/explanations/cleanup`
    ]);
    expect(editor.tree.value.children).toEqual([]);
    expect(editor.selectedPath.value).toBe("");

    active.value = false;
    await nextTick();
    active.value = true;
    await nextTick();
    await flushPromises();
    expect(mocks.requestCalls).toHaveLength(requestCount + 2);
  });

  it("defers hidden selected-file reads to the existing file-sync readiness on return", async () => {
    const active = ref(true);
    const currentText = ref("");
    const editor = await createLoadedEditor({ active, currentText });
    const realtime = realtimeForEvent("vibe64.source-editor.file.changed");
    const fileSync = mocks.fileSyncOptions[0];
    active.value = false;
    await nextTick();
    expect(fileSync.active.value).toBe(false);
    const requestCount = mocks.requestCalls.length;
    const payload = {
      hash: "hash-2", originId: "other-tab", path: "src/app.js",
      projectSlug: "beepollen", sessionId: "session-1"
    };
    if (realtime.enabled.value && realtime.matches({ payload })) realtime.onEvent({ payload });
    await flushPromises();
    expect(mocks.requestCalls).toHaveLength(requestCount);
    expect(editor.savedHash.value).toBe("hash-1");

    active.value = true;
    await nextTick();
    expect(fileSync.active.value).toBe(true);
    expect(mocks.requestCalls).toHaveLength(requestCount);
    mocks.requestResults.push(fileResponse({ hash: "hash-2", text: "console.log('remote');\n" }));
    fileSync.onReady();
    await flushPromises();
    expect(mocks.requestCalls.slice(requestCount)).toEqual([[
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js", {}
    ]]);
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.text.value).toBe("console.log('remote');\n");
    expect(editor.dirty.value).toBe(false);
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

  it("requests source explanations without exposing raw model settings", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    const executionProfile = {
      limits: {
        maxInputCharacters: 100_000,
        maxOutputCharacters: 32_000,
        timeoutMs: 180_000
      },
      model: "gpt-5.6-luna",
      policy: {
        environmentAccess: false,
        networkAccess: false,
        repositoryWrite: false,
        tools: "none"
      },
      profileId: "economy",
      providerId: "codex",
      request: {
        allowProviderModelFallback: false,
        reasoning: true,
        summary: false
      },
      revision: "codex-economy-v1",
      thinking: "low",
      workloadId: "source_explanation"
    };
    mocks.streamEvents.push([{
      explanation: {
        agentSettings: {
          model: "legacy-source-explainer",
          providerId: "codex",
          thinking: "high"
        },
        agentThreadId: "thread-1",
        executionProfile,
        id: "exp-1",
        messages: [{
          id: "assistant-1",
          role: "assistant",
          status: "complete",
          text: "This handles startup."
        }],
        model: "gpt-5.6-luna",
        sourceRange: {
          endColumn: 12,
          endLine: 1,
          path: "src/app.js",
          scope: "selection",
          startColumn: 1,
          startLine: 1
        },
        status: "ready"
      },
      type: "source-explanation.finished"
    }]);

    await editor.explainSelection({
      endColumn: 12,
      endLine: 1,
      scope: "selection",
      startColumn: 1,
      startLine: 1
    });

    expect(mocks.streamCalls).toHaveLength(1);
    const [url, options] = mocks.streamCalls[0];
    expect(url).toBe("/api/app/vibe64/sessions/session-1/source-editor/explanations/stream");
    expect(options.body).not.toHaveProperty("agentSettings");
    expect(editor).not.toHaveProperty("explanationAgentSettings");
    expect(editor).not.toHaveProperty("updateExplanationAgentSetting");
    expect(editor.activeExplanation.value.agentSettings).toBeNull();
    expect(editor.activeExplanation.value.executionProfile).toEqual(expect.objectContaining(executionProfile));
  });

  it("retains a user-started explanation through hidden completion until explicit unmount", async () => {
    const active = ref(true);
    const currentText = ref("");
    const editor = await createLoadedEditor({ active, currentText });
    let finishExplanation;
    let unmounted = false;
    mocks.streamEvents.push(new Promise((resolve) => { finishExplanation = resolve; }));
    const generating = editor.explainSelection({ scope: "file" });
    const explanation = editor.activeExplanation.value;
    const signal = mocks.streamCalls.at(-1)[1].signal;
    const requestCount = mocks.requestCalls.length;

    try {
      expect(editor.explanationBusy.value).toBe(true);
      active.value = false;
      await nextTick();
      await flushPromises();

      expect(signal.aborted).toBe(false);
      expect(editor.activeExplanation.value).toBe(explanation);
      expect(editor.explanationBusy.value).toBe(true);
      expect(mocks.requestCalls).toHaveLength(requestCount);

      finishExplanation([{
        explanation: {
          ...explanation,
          body: "The answer completed while Preview was visible.",
          messages: explanation.messages.map((message) => message.role === "assistant"
            ? { ...message, status: "complete", text: "The answer completed while Preview was visible." }
            : message),
          status: "ready"
        },
        type: "source-explanation.finished"
      }]);
      await generating;
      const completedExplanation = editor.activeExplanation.value;
      expect(completedExplanation.id).toBe(explanation.id);
      expect(completedExplanation.status).toBe("ready");
      expect(completedExplanation.body).toBe("The answer completed while Preview was visible.");
      expect(editor.explanationBusy.value).toBe(false);

      active.value = true;
      await nextTick();
      await flushPromises();
      expect(editor.activeExplanation.value).toBe(completedExplanation);
      expect(editor.selectedPath.value).toBe("src/app.js");
      expect(editor.explanationError.value).toBe("");
      expect(signal.aborted).toBe(false);
      expect(mocks.streamCalls).toHaveLength(1);
      expect(mocks.requestCalls).toHaveLength(requestCount);

      unmounted = true;
      mocks.beforeUnmount[0]();
      await flushPromises();
      expect(mocks.requestCalls.slice(requestCount)).toEqual([[
        `/api/app/vibe64/sessions/session-1/source-editor/explanations/${explanation.id}`,
        { method: "DELETE" }
      ]]);
      expect(editor.activeExplanation.value).toBeNull();
    } finally {
      finishExplanation([]);
      await generating;
      if (!unmounted) mocks.beforeUnmount[0]();
      await flushPromises();
    }
  });

  it("sends follow-ups for a cached explanation without an agent thread", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    const cachedExplanation = {
      agentThreadId: "",
      body: "This handles startup.",
      engine: "agent-cache",
      id: "exp-cache",
      sourceRange: {
        endColumn: 12,
        endLine: 1,
        path: "src/app.js",
        scope: "selection",
        startColumn: 1,
        startLine: 1
      },
      status: "ready"
    };
    mocks.streamEvents.push([{
      cacheHit: true,
      explanation: cachedExplanation,
      type: "source-explanation.finished"
    }]);
    await editor.explainSelection(cachedExplanation.sourceRange);
    expect(editor.activeExplanation.value.agentThreadId).toBe("");

    editor.updateExplanationFollowup("   ");
    await editor.sendExplanationFollowup();
    expect(mocks.streamCalls).toHaveLength(1);

    editor.updateExplanationFollowup("  Why does startup need this?  ");
    editor.explanationBusy.value = true;
    await editor.sendExplanationFollowup();
    expect(mocks.streamCalls).toHaveLength(1);
    editor.explanationBusy.value = false;

    const continuedExplanation = {
      ...cachedExplanation,
      agentThreadId: "thread-cache-followup",
      messages: [{
        id: "assistant-followup",
        role: "assistant",
        status: "complete",
        text: "It prepares the application before startup."
      }]
    };
    mocks.streamEvents.push([{
      threadId: continuedExplanation.agentThreadId,
      type: "source-explanation.thread"
    }, {
      explanation: continuedExplanation,
      type: "source-explanation.finished"
    }]);
    await editor.sendExplanationFollowup();

    expect(mocks.streamCalls).toHaveLength(2);
    const followupPath = "/api/app/vibe64/sessions/session-1/source-editor/explanations/exp-cache/followups/stream";
    const [url, options] = mocks.streamCalls[1];
    expect(url).toBe(followupPath);
    expect(options.method).toBe("POST");
    expect(options.body).toEqual({
      assistantMessageId: expect.stringMatching(/^msg/u),
      message: "Why does startup need this?",
      userMessageId: expect.stringMatching(/^msg/u)
    });
    expect(editor.activeExplanation.value).toEqual(expect.objectContaining({
      agentThreadId: continuedExplanation.agentThreadId,
      id: cachedExplanation.id,
      messages: [expect.objectContaining(continuedExplanation.messages[0])]
    }));
    expect(editor.explanationBusy.value).toBe(false);
    expect(editor.explanationFollowup.value).toBe("");

    editor.updateExplanationFollowup("What happens next?");
    mocks.streamEvents.push([{
      explanation: continuedExplanation,
      type: "source-explanation.finished"
    }]);
    await editor.sendExplanationFollowup();
    expect(mocks.streamCalls).toHaveLength(3);
    expect(mocks.streamCalls[2][0]).toBe(followupPath);
    expect(mocks.streamCalls[2][1].body).toEqual({
      assistantMessageId: expect.stringMatching(/^msg/u),
      message: "What happens next?",
      userMessageId: expect.stringMatching(/^msg/u)
    });

    editor.closeExplanation();
    await flushPromises();
    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/explanations/exp-cache",
      { method: "DELETE" }
    ]);
    expect(editor.activeExplanation.value).toBeNull();
  });

  it("retains the cached answer and reports a rejected follow-up", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    editor.activeExplanation.value = {
      agentThreadId: "",
      body: "This handles startup.",
      engine: "agent-cache",
      id: "exp-cache",
      messages: [{
        id: "assistant-cache",
        role: "assistant",
        status: "complete",
        text: "This handles startup."
      }],
      status: "ready"
    };
    mocks.streamEvents.push([{
      error: "The selected AI connection is unavailable for this account.",
      ok: false,
      type: "source-explanation.error"
    }]);
    editor.updateExplanationFollowup("Why?");

    await editor.sendExplanationFollowup();

    expect(mocks.streamCalls).toHaveLength(1);
    expect(editor.explanationBusy.value).toBe(false);
    expect(editor.explanationError.value).toBe("The selected AI connection is unavailable for this account.");
    expect(editor.activeExplanation.value.body).toBe("This handles startup.");
    expect(editor.activeExplanation.value.status).toBe("failed");
    expect(editor.activeExplanation.value.messages.at(-1)).toEqual(expect.objectContaining({
      role: "assistant",
      status: "failed",
      text: editor.explanationError.value
    }));
  });

  it("blocks same-ID follow-ups during close while retaining failed cleanup for retry", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    const explanation = {
      agentThreadId: "",
      body: "This handles startup.",
      engine: "agent-cache",
      id: "exp-cache",
      sourceRange: { path: "src/app.js", scope: "file" },
      status: "ready"
    };
    editor.activeExplanation.value = explanation;
    let finishFirstDelete;
    let rejectFirstDelete;
    let finishRetryDelete;
    let retryClosing;
    mocks.requestResults.push(new Promise((resolve, reject) => {
      finishFirstDelete = resolve;
      rejectFirstDelete = reject;
    }));
    const deletePath = "/api/app/vibe64/sessions/session-1/source-editor/explanations/exp-cache";

    try {
      const firstClosing = editor.closeExplanation();
      expect(editor.explanationClosing.value).toBe(true);
      expect(mocks.requestCalls.at(-1)).toEqual([deletePath, { method: "DELETE" }]);
      rejectFirstDelete(new Error("Temporary explanation cleanup is unavailable."));
      expect(await firstClosing).toBe(false);
      expect(editor.activeExplanation.value).toEqual(explanation);
      expect(mocks.feedbackErrors).toEqual([[
        expect.objectContaining({ message: "Temporary explanation cleanup is unavailable." }),
        "Source explanation cleanup failed. Close it again to retry."
      ]]);
      expect(editor.explanationError.value).toBe("");
      expect(editor.explanationBusy.value).toBe(false);
      expect(editor.explanationClosing.value).toBe(false);

      mocks.requestResults.push(new Promise((resolve) => { finishRetryDelete = resolve; }));
      retryClosing = editor.closeExplanation();
      expect(editor.explanationClosing.value).toBe(true);
      expect(mocks.requestCalls.filter(([url]) => url === deletePath)).toHaveLength(2);
      expect(editor.explanationError.value).toBe("");
      editor.updateExplanationFollowup("Can this deleted conversation continue?");
      await editor.sendExplanationFollowup();
      await editor.stopExplanation();
      await editor.closeExplanation();
      await editor.explainSelection({ scope: "file" });

      expect(mocks.streamCalls).toHaveLength(0);
      expect(mocks.requestCalls.filter(([url]) => url === deletePath)).toHaveLength(2);
      expect(mocks.requestCalls.some(([url]) => url.endsWith("/stop"))).toBe(false);
      expect(editor.explanationFollowup.value).toBe("Can this deleted conversation continue?");
      finishRetryDelete({ ok: true });
      expect(await retryClosing).toBe(true);
      expect(editor.activeExplanation.value).toBeNull();
      expect(editor.explanationBusy.value).toBe(false);
      expect(editor.explanationClosing.value).toBe(false);
      expect(editor.explanationError.value).toBe("");

      mocks.streamEvents.push([{
        explanation: { ...explanation, id: "exp-next" },
        type: "source-explanation.finished"
      }]);
      await editor.explainSelection({ scope: "file" });
      expect(mocks.streamCalls).toHaveLength(1);
      expect(editor.activeExplanation.value.id).toBe("exp-next");
    } finally {
      finishFirstDelete({ ok: true });
      finishRetryDelete?.({ ok: true });
      await retryClosing;
      await flushPromises();
    }
  });

  it.each([
    { outcome: "success", reset: "session reset" },
    { outcome: "error", reset: "session reset" },
    { outcome: "success", reset: "unmount" },
    { outcome: "error", reset: "unmount" }
  ])("ignores obsolete Close $outcome after $reset without duplicate cleanup", async ({ outcome, reset }) => {
    const currentText = ref("");
    const sessionId = ref("session-1");
    const editor = await createLoadedEditor({ currentText, sessionId });
    editor.activeExplanation.value = {
      agentThreadId: "",
      body: "Old session answer.",
      engine: "agent-cache",
      id: "exp-cache",
      status: "ready"
    };
    let finishOldDelete;
    let rejectOldDelete;
    let finishCurrentDelete;
    let currentClosing;
    mocks.requestResults.push(new Promise((resolve, reject) => {
      finishOldDelete = resolve;
      rejectOldDelete = reject;
    }));
    const oldClosing = editor.closeExplanation();
    const oldDeletePath = "/api/app/vibe64/sessions/session-1/source-editor/explanations/exp-cache";

    try {
      expect(editor.explanationClosing.value).toBe(true);
      expect(mocks.requestCalls.at(-1)).toEqual([oldDeletePath, { method: "DELETE" }]);
      if (reset === "session reset") {
        mocks.requestResults.push(treeResponse());
        sessionId.value = "session-2";
        await nextTick();
        await flushPromises();
        expect(editor.activeExplanation.value).toBeNull();
        expect(editor.explanationClosing.value).toBe(false);
        editor.activeExplanation.value = {
          agentThreadId: "",
          body: "New session answer with the same explanation ID.",
          engine: "agent-cache",
          id: "exp-cache",
          status: "ready"
        };
        mocks.requestResults.push(new Promise((resolve) => { finishCurrentDelete = resolve; }));
        currentClosing = editor.closeExplanation();
        expect(editor.explanationClosing.value).toBe(true);
      } else {
        mocks.beforeUnmount[0]();
        await flushPromises();
        expect(editor.explanationClosing.value).toBe(false);
      }
      const selectedExplanation = editor.activeExplanation.value;
      expect(mocks.requestCalls.filter(([url]) => url === oldDeletePath)).toHaveLength(1);

      if (outcome === "success") {
        finishOldDelete({ ok: true });
      } else {
        rejectOldDelete(new Error("Obsolete cleanup failed."));
      }
      expect(await oldClosing).toBe(false);
      expect(editor.activeExplanation.value).toBe(selectedExplanation);
      expect(editor.explanationClosing.value).toBe(reset === "session reset");
      expect(editor.explanationError.value).toBe("");
      expect(mocks.feedbackErrors).toHaveLength(0);
      expect(mocks.requestCalls.filter(([url]) => url === oldDeletePath)).toHaveLength(1);

      if (reset === "session reset") {
        expect(mocks.requestCalls.filter(([url]) => (
          url === "/api/app/vibe64/sessions/session-2/source-editor/explanations/exp-cache"
        ))).toHaveLength(1);
        finishCurrentDelete({ ok: true });
        expect(await currentClosing).toBe(true);
        expect(editor.activeExplanation.value).toBeNull();
        expect(editor.explanationClosing.value).toBe(false);
      }
    } finally {
      finishOldDelete({ ok: true });
      finishCurrentDelete?.({ ok: true });
      await Promise.all([oldClosing, currentClosing]);
    }
  });

  it.each([
    { outcome: "success", replacement: "close" },
    { outcome: "error", replacement: "close" },
    { outcome: "success", replacement: "explanation B" },
    { outcome: "error", replacement: "explanation B" },
    { outcome: "success", replacement: "new follow-up on the same explanation" },
    { outcome: "error", replacement: "new follow-up on the same explanation" }
  ])("ignores delayed Stop $outcome after $replacement", async ({ outcome, replacement }) => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let finishInitial;
    let finishReplacement;
    let finishStop;
    let rejectStop;
    let replacing;
    mocks.streamEvents.push(new Promise((resolve) => { finishInitial = resolve; }));
    let generating;
    if (replacement === "new follow-up on the same explanation") {
      editor.activeExplanation.value = {
        agentThreadId: "",
        body: "This handles startup.",
        engine: "agent-cache",
        id: "exp-cache",
        status: "ready"
      };
      editor.updateExplanationFollowup("Why?");
      generating = editor.sendExplanationFollowup();
    } else {
      generating = editor.explainSelection({ scope: "file" });
    }
    const explanationA = editor.activeExplanation.value;
    const initialSignal = mocks.streamCalls.at(-1)[1].signal;
    mocks.requestResults.push(new Promise((resolve, reject) => {
      finishStop = resolve;
      rejectStop = reject;
    }));
    const stopping = editor.stopExplanation();

    try {
      expect(initialSignal.aborted).toBe(true);
      expect(editor.explanationBusy.value).toBe(false);
      expect(mocks.requestCalls.at(-1)).toEqual([
        `/api/app/vibe64/sessions/session-1/source-editor/explanations/${explanationA.id}/stop`,
        { method: "POST" }
      ]);
      if (replacement === "close") {
        editor.closeExplanation();
        await flushPromises();
        expect(editor.activeExplanation.value).toBeNull();
        expect(mocks.requestCalls.at(-1)).toEqual([
          `/api/app/vibe64/sessions/session-1/source-editor/explanations/${explanationA.id}`,
          { method: "DELETE" }
        ]);
      } else {
        mocks.streamEvents.push(new Promise((resolve) => { finishReplacement = resolve; }));
        if (replacement === "new follow-up on the same explanation") {
          editor.updateExplanationFollowup("What happens next?");
          replacing = editor.sendExplanationFollowup();
          expect(editor.activeExplanation.value.id).toBe(explanationA.id);
        } else {
          replacing = editor.explainSelection({ scope: "file" });
          expect(editor.activeExplanation.value.id).not.toBe(explanationA.id);
        }
        expect(editor.explanationBusy.value).toBe(true);
      }
      const selectedExplanation = editor.activeExplanation.value;

      if (outcome === "success") {
        finishStop({ explanation: { ...explanationA, status: "stopped" }, ok: true });
      } else {
        rejectStop(new Error("Stop A failed after its view changed."));
      }
      await stopping;

      expect(editor.activeExplanation.value).toBe(selectedExplanation);
      expect(editor.explanationError.value).toBe("");
      expect(mocks.feedbackErrors).toHaveLength(0);
      expect(editor.explanationBusy.value).toBe(replacement !== "close");
    } finally {
      finishInitial([]);
      finishReplacement?.([]);
      finishStop({ ok: true });
      await Promise.all([generating, stopping, replacing]);
    }
  });

  it.each(["success", "error"])("applies the current Stop %s to its explanation", async (outcome) => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    let finishInitial;
    let finishStop;
    let rejectStop;
    mocks.streamEvents.push(new Promise((resolve) => { finishInitial = resolve; }));
    const generating = editor.explainSelection({ scope: "file" });
    const explanation = editor.activeExplanation.value;
    mocks.requestResults.push(new Promise((resolve, reject) => {
      finishStop = resolve;
      rejectStop = reject;
    }));
    const stopping = editor.stopExplanation();

    try {
      if (outcome === "success") {
        finishStop({ explanation: { ...explanation, status: "stopped" }, ok: true });
      } else {
        rejectStop(new Error("The assistant could not stop this explanation."));
      }
      await stopping;

      expect(editor.activeExplanation.value.id).toBe(explanation.id);
      expect(editor.explanationBusy.value).toBe(false);
      if (outcome === "success") {
        expect(editor.activeExplanation.value.status).toBe("stopped");
        expect(editor.explanationError.value).toBe("");
        expect(mocks.feedbackErrors).toHaveLength(0);
      } else {
        expect(editor.explanationError.value).toBe("");
        expect(mocks.feedbackErrors).toEqual([[
          expect.objectContaining({ message: "The assistant could not stop this explanation." }),
          "Source explanation could not be stopped."
        ]]);
      }
    } finally {
      finishInitial([]);
      finishStop({ ok: true });
      await Promise.all([generating, stopping]);
    }
  });

  it.each([
    { operation: "initial explanation", reset: "close" },
    { operation: "cached follow-up", reset: "close" },
    { operation: "initial explanation", reset: "session reset" },
    { operation: "cached follow-up", reset: "session reset" }
  ])("clears pending $operation busy state on $reset without clearing a newer request", async ({ operation, reset }) => {
    const currentText = ref("");
    const sessionId = ref("session-1");
    const editor = await createLoadedEditor({ currentText, sessionId });
    let finishObsolete;
    let finishCurrent;
    let currentRequest;
    mocks.streamEvents.push(new Promise((resolve) => { finishObsolete = resolve; }));
    let obsoleteRequest;
    if (operation === "initial explanation") {
      obsoleteRequest = editor.explainSelection({ scope: "file" });
    } else {
      editor.activeExplanation.value = {
        agentThreadId: "",
        body: "This handles startup.",
        engine: "agent-cache",
        id: "exp-cache",
        status: "ready"
      };
      editor.updateExplanationFollowup("Why?");
      obsoleteRequest = editor.sendExplanationFollowup();
    }
    const obsoleteExplanation = editor.activeExplanation.value;
    const obsoleteSignal = mocks.streamCalls.at(-1)[1].signal;

    try {
      expect(editor.explanationBusy.value).toBe(true);
      if (reset === "close") {
        editor.closeExplanation();
      } else {
        mocks.requestResults.push({}, treeResponse());
        sessionId.value = "session-2";
        await nextTick();
      }
      await flushPromises();
      expect(obsoleteSignal.aborted).toBe(true);
      expect(editor.activeExplanation.value).toBeNull();
      expect(editor.explanationBusy.value).toBe(false);

      if (reset === "session reset") {
        mocks.requestResults.push(fileResponse());
        await editor.openFile("src/app.js");
        currentText.value = editor.text.value;
      }
      mocks.streamEvents.push(new Promise((resolve) => { finishCurrent = resolve; }));
      currentRequest = editor.explainSelection({ scope: "file" });
      const currentExplanation = editor.activeExplanation.value;
      const currentSignal = mocks.streamCalls.at(-1)[1].signal;
      expect(currentExplanation.id).not.toBe(obsoleteExplanation.id);
      expect(editor.explanationBusy.value).toBe(true);
      expect(currentSignal.aborted).toBe(false);

      finishObsolete([{
        explanation: { ...obsoleteExplanation, body: "Late obsolete answer.", status: "ready" },
        type: "source-explanation.finished"
      }]);
      await obsoleteRequest;
      expect(editor.activeExplanation.value).toBe(currentExplanation);
      expect(editor.explanationError.value).toBe("");
      expect(editor.explanationBusy.value).toBe(true);

      editor.closeExplanation();
      expect(currentSignal.aborted).toBe(true);
      expect(editor.explanationBusy.value).toBe(false);
      finishCurrent([]);
      await currentRequest;
      await flushPromises();
      expect(editor.activeExplanation.value).toBeNull();
    } finally {
      finishObsolete([]);
      finishCurrent?.([]);
      await Promise.all([obsoleteRequest, currentRequest]);
    }
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

  it("keeps selected files independent between editors without publishing open state", async () => {
    const firstEditor = await createLoadedEditor({
      currentText: ref("")
    });
    const secondEditor = await createLoadedEditor({
      currentText: ref("")
    });

    mocks.requestResults.push(fileResponse({
      hash: "hash-other",
      path: "src/other.js",
      text: "console.log('other');\n"
    }));
    await firstEditor.openFile("src/other.js");

    expect(firstEditor.selectedPath.value).toBe("src/other.js");
    expect(firstEditor.text.value).toBe("console.log('other');\n");
    expect(secondEditor.selectedPath.value).toBe("src/app.js");
    expect(realtimeForEvent("vibe64.source-editor.file.opened")).toBeUndefined();
    expect(mocks.requestCalls.some(([url]) => url.endsWith("/source-editor/open-file"))).toBe(false);
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

  it("reloads the clean open file after a direct filesystem change", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const fileSync = mocks.fileSyncOptions[0];
    mocks.requestResults.push(fileResponse({
      hash: "hash-2",
      text: "console.log('filesystem');\n"
    }));

    fileSync.onChange({
      path: "src/app.js",
      sessionId: "session-1"
    });
    await flushPromises();

    expect(mocks.requestCalls.at(-1)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js",
      {}
    ]);
    expect(editor.text.value).toBe("console.log('filesystem');\n");
    expect(editor.savedHash.value).toBe("hash-2");
    expect(editor.dirty.value).toBe(false);
  });

  it.each([false, true])("clears a recovered file refresh error without replacing the unchanged file (dirty: %s)", async (dirty) => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    if (dirty) {
      currentText.value = "console.log('local draft');\n";
      editor.updateText();
    }
    const originalText = currentText.value;
    const loadedVersion = editor.loadedVersion.value;
    const requestCount = mocks.requestCalls.length;
    const fileSync = mocks.fileSyncOptions[0];
    mocks.requestResults.push({ ok: false, error: "Temporary refresh failure." });

    fileSync.onReady();
    await flushPromises();
    expect(editor.loadError.value).toBe("Temporary refresh failure.");

    mocks.requestResults.push(fileResponse());
    fileSync.onReady();
    await flushPromises();

    expect(editor.loadError.value).toBe("");
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.savedHash.value).toBe("hash-1");
    expect(editor.text.value).toBe("console.log('one');\n");
    expect(currentText.value).toBe(originalText);
    expect(editor.loadedVersion.value).toBe(loadedVersion);
    expect(editor.dirty.value).toBe(dirty);
    expect(mocks.requestCalls.slice(requestCount)).toEqual([
      ["/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js", {}],
      ["/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js", {}]
    ]);
  });

  it.each(["another file", "the root tree"])("keeps an error from %s when the selected file revalidates successfully", async (operation) => {
    const currentText = ref("");
    const editor = await createLoadedEditor({ currentText });
    const message = `Could not load ${operation}.`;
    mocks.requestResults.push({ ok: false, error: message });
    if (operation === "another file") {
      await expect(editor.openFile("src/other.js")).resolves.toBe(false);
    } else {
      mocks.requestResults.push(fileResponse());
      await editor.refresh();
    }
    expect(editor.loadError.value).toBe(message);

    mocks.requestResults.push(fileResponse());
    mocks.fileSyncOptions[0].onReady();
    await flushPromises();

    expect(editor.loadError.value).toBe(message);
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.savedHash.value).toBe("hash-1");
    expect(currentText.value).toBe("console.log('one');\n");
  });

  it("refreshes both the file tree and a clean open file", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const requestCount = mocks.requestCalls.length;
    mocks.requestResults.push(
      treeResponse(),
      fileResponse({
        hash: "hash-2",
        text: "console.log('refreshed');\n"
      })
    );

    await editor.refresh();

    expect(mocks.requestCalls.slice(requestCount).map(([url]) => url)).toEqual([
      "/api/app/vibe64/sessions/session-1/source-editor/tree?limit=20",
      "/api/app/vibe64/sessions/session-1/source-editor/file?path=src%2Fapp.js"
    ]);
    expect(editor.text.value).toBe("console.log('refreshed');\n");
    expect(editor.savedHash.value).toBe("hash-2");
  });

  it("preserves edits made while a file revalidation is in flight", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    const {
      SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE
    } = await import("../../src/composables/useVibe64SourceEditor.js");
    const fileSync = mocks.fileSyncOptions[0];
    let resolveRefresh;
    mocks.requestResults.push(new Promise((resolve) => {
      resolveRefresh = resolve;
    }));

    fileSync.onReady();
    await flushPromises();
    currentText.value = "console.log('local');\n";
    editor.updateText();
    resolveRefresh(fileResponse({
      hash: "hash-2",
      text: "console.log('filesystem');\n"
    }));
    await flushPromises();

    expect(currentText.value).toBe("console.log('local');\n");
    expect(editor.text.value).toBe("console.log('one');\n");
    expect(editor.savedHash.value).toBe("hash-1");
    expect(editor.dirty.value).toBe(true);
    expect(editor.saveError.value).toBe(SOURCE_EDITOR_REMOTE_CHANGE_MESSAGE);
  });

  it("does not navigate away when saving the current file conflicts", async () => {
    const currentText = ref("");
    const editor = await createLoadedEditor({
      currentText
    });
    currentText.value = "console.log('local');\n";
    editor.updateText();
    mocks.requestResults.push({
      error: "This file changed on disk. Reload it before saving.",
      ok: false
    });
    const requestCount = mocks.requestCalls.length;

    await expect(editor.openFile("src/other.js")).resolves.toBe(false);

    expect(mocks.requestCalls).toHaveLength(requestCount + 1);
    expect(mocks.requestCalls.at(-1)[1]?.method).toBe("PUT");
    expect(editor.selectedPath.value).toBe("src/app.js");
    expect(editor.dirty.value).toBe(true);
    expect(editor.saveError.value).toBe("This file changed on disk. Reload it before saving.");
  });
});
