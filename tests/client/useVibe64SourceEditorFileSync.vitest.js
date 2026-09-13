import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, reactive, ref } from "vue";

const mocks = vi.hoisted(() => ({ beforeUnmount: [] }));

vi.mock("vue", async (importOriginal) => {
  const actual = await importOriginal();
  return {
    ...actual,
    onBeforeUnmount(callback) {
      mocks.beforeUnmount.push(callback);
    }
  };
});

class FakeEventSource extends EventTarget {
  static instances = [];

  constructor(url, options) {
    super();
    this.closed = false;
    this.options = options;
    this.url = url;
    FakeEventSource.instances.push(this);
  }

  close() {
    this.closed = true;
  }

  emit(type, payload = {}) {
    const event = new Event(type);
    Object.defineProperty(event, "data", {
      value: JSON.stringify(payload)
    });
    this.dispatchEvent(event);
  }
}

describe("useVibe64SourceEditorFileSync", () => {
  let originalEventSource;

  beforeEach(() => {
    originalEventSource = globalThis.EventSource;
    globalThis.EventSource = FakeEventSource;
    FakeEventSource.instances.length = 0;
    mocks.beforeUnmount.length = 0;
  });

  afterEach(() => {
    mocks.beforeUnmount.forEach((callback) => callback());
    globalThis.EventSource = originalEventSource;
    vi.resetModules();
  });

  it("observes only the selected file while the Files surface is active", async () => {
    const active = ref(true);
    const path = ref("");
    const onChange = vi.fn();
    const onError = vi.fn();
    const onReady = vi.fn();
    const {
      useVibe64SourceEditorFileSync
    } = await import("../../src/composables/useVibe64SourceEditorFileSync.js");

    useVibe64SourceEditorFileSync({
      active,
      onChange,
      onError,
      onReady,
      path,
      sessionId: ref("session-1"),
      sessionsApiPath: ref("/api/app/vibe64/sessions")
    });
    expect(FakeEventSource.instances).toHaveLength(0);

    path.value = "docs/missing.md";
    await nextTick();
    const source = FakeEventSource.instances[0];
    expect(source.url).toBe(
      "/api/app/vibe64/sessions/session-1/source-editor/changes/stream?path=docs%2Fmissing.md"
    );
    expect(source.options).toEqual({
      withCredentials: true
    });

    source.emit("vibe64.source-editor.sync.ready", {
      path: "docs/missing.md"
    });
    source.emit("vibe64.source-editor.file.changed", {
      path: "docs/missing.md",
      sessionId: "session-1"
    });
    expect(onReady).toHaveBeenCalledWith({
      path: "docs/missing.md"
    });
    expect(onChange).toHaveBeenCalledWith({
      path: "docs/missing.md",
      sessionId: "session-1"
    });
    expect(onError).not.toHaveBeenCalled();

    source.emit("vibe64.source-editor.sync.error", {
      error: "File is no longer available.",
      fatal: true
    });
    expect(onError).toHaveBeenCalledWith({
      error: "File is no longer available.",
      fatal: true
    });
    expect(source.closed).toBe(true);

    active.value = false;
    await nextTick();
    expect(FakeEventSource.instances).toHaveLength(1);
  });

  it("closes and reopens observation through the actual Autopilot and file-area bindings", async () => {
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue",
      import.meta.url
    ), "utf8");
    const files = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionFiles.vue",
      import.meta.url
    ), "utf8");
    const filesTag = autopilot.match(/<Vibe64SessionFiles\b[\s\S]*?\/>/u)?.[0];
    const filesBinding = filesTag?.match(/:active="([^"]+)"/u)?.[1];
    const editorTag = files.match(/<Vibe64SessionSourceEditor\b[\s\S]*?\/>/u)?.[0];
    const editorBinding = editorTag?.match(/:active="([^"]+)"/u)?.[1];
    expect(filesBinding).toBeDefined();
    expect(editorBinding).toBeDefined();
    const filesActive = new Function("props", "rightPaneTab", `return (${filesBinding});`);
    const editorActive = new Function("active", "area", `return (${editorBinding});`);
    const props = reactive({ active: true, projectPane: "dashboard" });
    const rightPaneTab = ref("editor");
    const area = ref("repo");
    const path = ref("src/app.js");
    const onChange = vi.fn();
    const onError = vi.fn();
    const onReady = vi.fn();
    const observationScope = effectScope();
    const { useVibe64SourceEditorFileSync } = await import(
      "../../src/composables/useVibe64SourceEditorFileSync.js"
    );

    try {
      observationScope.run(() => useVibe64SourceEditorFileSync({
        active: () => editorActive(filesActive(props, rightPaneTab.value), area.value),
        onChange,
        onError,
        onReady,
        path,
        sessionId: ref("session-1"),
        sessionsApiPath: ref("/api/app/vibe64/sessions")
      }));
      expect(FakeEventSource.instances).toHaveLength(1);
      const first = FakeEventSource.instances[0];
      const closeFirst = vi.spyOn(first, "close");
      expect(first.closed).toBe(false);
      first.emit("vibe64.source-editor.sync.ready", { path: path.value });
      first.emit("vibe64.source-editor.file.changed", { path: path.value });
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(1);

      props.active = false;
      await nextTick();
      expect(closeFirst).toHaveBeenCalledTimes(1);
      expect(first.closed).toBe(true);
      expect(FakeEventSource.instances).toHaveLength(1);
      first.emit("vibe64.source-editor.sync.ready", { path: path.value });
      first.emit("vibe64.source-editor.file.changed", { path: path.value });
      first.onerror?.();
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      props.active = true;
      await nextTick();
      expect(FakeEventSource.instances).toHaveLength(2);
      const reopened = FakeEventSource.instances[1];
      const closeReopened = vi.spyOn(reopened, "close");
      expect(reopened.url).toBe(first.url);
      expect(reopened.closed).toBe(false);
      first.emit("vibe64.source-editor.sync.error", { error: "Obsolete connection.", fatal: true });
      expect(reopened.closed).toBe(false);
      expect(onError).not.toHaveBeenCalled();
      reopened.emit("vibe64.source-editor.sync.ready", { path: path.value });
      reopened.emit("vibe64.source-editor.file.changed", { path: path.value });
      expect(onReady).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledTimes(2);

      area.value = "drop-zone";
      await nextTick();
      expect(closeReopened).toHaveBeenCalledTimes(1);
      expect(reopened.closed).toBe(true);
      expect(FakeEventSource.instances).toHaveLength(2);
      area.value = "repo";
      await nextTick();
      expect(FakeEventSource.instances).toHaveLength(3);
      const returnedToRepo = FakeEventSource.instances[2];
      const closeReturnedToRepo = vi.spyOn(returnedToRepo, "close");
      expect(returnedToRepo.url).toBe(first.url);
      expect(returnedToRepo.closed).toBe(false);

      expect(mocks.beforeUnmount).toHaveLength(1);
      mocks.beforeUnmount[0]();
      observationScope.stop();
      expect(closeReturnedToRepo).toHaveBeenCalledTimes(1);
      expect(returnedToRepo.closed).toBe(true);
      expect(closeReopened).toHaveBeenCalledTimes(1);
      expect(reopened.closed).toBe(true);
      expect(closeFirst).toHaveBeenCalledTimes(1);
      props.active = false;
      await nextTick();
      props.active = true;
      await nextTick();
      expect(FakeEventSource.instances).toHaveLength(3);
    } finally {
      observationScope.stop();
    }
  });
});
