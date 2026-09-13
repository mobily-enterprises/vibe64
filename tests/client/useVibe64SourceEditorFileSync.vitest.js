import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { effectScope, nextTick, ref } from "vue";

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

  it("closes, reopens and ignores obsolete events until disposal", async () => {
    const active = ref(true);
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
        active: () => active.value,
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
      first.emit("vibe64.source-editor.sync.ready", { path: path.value });
      first.emit("vibe64.source-editor.file.changed", { path: path.value });
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(1);

      active.value = false;
      await nextTick();
      expect(closeFirst).toHaveBeenCalledTimes(1);
      expect(first.closed).toBe(true);
      expect(FakeEventSource.instances).toHaveLength(1);
      first.emit("vibe64.source-editor.sync.ready", { path: path.value });
      first.emit("vibe64.source-editor.file.changed", { path: path.value });
      first.onerror();
      expect(onReady).toHaveBeenCalledTimes(1);
      expect(onChange).toHaveBeenCalledTimes(1);
      expect(onError).not.toHaveBeenCalled();

      active.value = true;
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

      expect(mocks.beforeUnmount).toHaveLength(1);
      mocks.beforeUnmount[0]();
      observationScope.stop();
      expect(closeReopened).toHaveBeenCalledTimes(1);
      expect(reopened.closed).toBe(true);
      expect(closeFirst).toHaveBeenCalledTimes(1);
      reopened.emit("vibe64.source-editor.sync.ready", { path: path.value });
      reopened.emit("vibe64.source-editor.file.changed", { path: path.value });
      reopened.onerror();
      expect(onReady).toHaveBeenCalledTimes(2);
      expect(onChange).toHaveBeenCalledTimes(2);
      expect(onError).not.toHaveBeenCalled();
      active.value = false;
      await nextTick();
      active.value = true;
      await nextTick();
      expect(FakeEventSource.instances).toHaveLength(2);
    } finally {
      observationScope.stop();
    }
  });

  it("keeps the parent and Files active bindings as source contracts", () => {
    const autopilot = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64AutopilotView.vue",
      import.meta.url
    ), "utf8");
    const files = readFileSync(new URL(
      "../../src/components/studio/vibe64-session/Vibe64SessionFiles.vue",
      import.meta.url
    ), "utf8");
    // Check the declared bindings; this does not mount or exercise the parent components.
    expect(autopilot).toMatch(
      /<Vibe64SessionFiles\b[^>]*:active="props\.active && props\.projectPane === 'dashboard' && rightPaneTab === 'editor'"/u
    );
    expect(files).toMatch(
      /<Vibe64SessionSourceEditor\b[^>]*:active="active && area === 'repo'"/u
    );
  });
});
