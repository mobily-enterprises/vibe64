import { afterEach, describe, expect, it, vi } from "vitest";
import { createRenderer, markRaw, nextTick, reactive, ref, unref } from "vue";

const host = vi.hoisted(() => ({ outputs: null, projectSlug: null, realtime: [] }));
vi.mock("@/composables/useVibe64OutputControls.js", async original => ({
  ...await original(), useVibe64OutputControls: () => host.outputs
}));
vi.mock("@/composables/useVibe64ProjectScope.js", () => ({ useVibe64ProjectSlug: () => host.projectSlug }));
vi.mock("@jskit-ai/realtime/client/composables/useRealtimeEvent", () => ({
  useRealtimeEvent(options = {}) {
    host.realtime.push(options);
  }
}));

import { useVibe64OutputControlsSurface } from "../../src/composables/useVibe64OutputControlsSurface.js";
import { VIBE64_LEARNING_KEY } from "../../src/lib/vibe64AssistantHost.js";
import { idleLearning } from "./helpers/learningHostParts.js";

// A page the AI opens in the person's Preview (`vibe64-helper preview open`):
// the editor gets the session's request, opens it as the address box would,
// says so above the Preview and answers whether its Preview moved.
const PREVIEW = "https://preview.example.test/?vibe64_preview_token=t";
const EDITOR = "https://studio.example.test";

const mounted = [];
afterEach(() => {
  for (const fixture of mounted.splice(0)) fixture.dispose();
  host.realtime.splice(0);
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

function mountPreview() {
  const outputs = Object.fromEntries([
    "launchButtonsDisabled", "loading", "loadError", "operationBusy", "launchError", "launchStarting", "launchWaiting",
    "outputTargetsLoaded", "terminalDisplayed", "terminalDockVisible", "terminalExpanded", "terminalCanRestart",
    "terminalCanRetry", "terminalCanStart", "terminalError", "terminalStatus", "terminalTitle", "terminalSubtitle",
    "terminalCommandPreview", "terminalIndicatorLabel", "terminalIndicatorState", "terminalVisible", "terminalIsRunning",
    "terminalPreviewRequiresProxy", "terminalWindowVisible", "terminalWindowStorageKey", "previewCanRestart", "previewCanShowLog",
    "previewCanStart", "previewStoppedIntent", "previewMessage", "previewIdentity", "outputExecution", "outputResults", "outputRuns",
    "visible", "launchStatusAttempt"
  ].map(name => [name, ref(false)]));
  const target = { id: "app", presentation: { kind: "web" } };
  Object.assign(outputs, { activeOutputTarget: ref(target), activeOutputTargetId: ref("app"), outputTargets: ref([target]),
    previewState: ref("ready"), previewTestNotice: ref(null), resourceAdmissionId: ref(""), testApproval: ref(null),
    run: vi.fn(async () => ({ ok: true })), terminal: { metadata: ref({ outputTargetId: "app" }) }, terminalSessionId: ref("terminal-a"),
    launchActions: ref([{ kind: "url", href: "http://127.0.0.1:4100/", previewHref: PREVIEW }]),
    requestPreviewIdentityGrant: vi.fn(), publishPreviewState: vi.fn(), publishPreviewDiagnostic: vi.fn(async () => true),
    refresh: vi.fn(async () => {}), restartTerminal: vi.fn(async () => ({ ok: true })) });
  host.outputs = outputs;
  host.projectSlug = ref("notes");
  const windowObject = { innerWidth: 1280, innerHeight: 800, location: new URL(`${EDITOR}/app/project/notes`),
    addEventListener() {}, removeEventListener() {} };
  const documentObject = { visibilityState: "visible", addEventListener() {}, removeEventListener() {} };
  vi.stubGlobal("window", windowObject);
  vi.stubGlobal("document", documentObject);
  const props = reactive({ embeddedPreview: true, previewDisplayed: true, windowDisplayed: true,
    session: { sessionId: "session-a" } });
  let state;
  const renderer = createRenderer({ createComment: () => ({}), insert() {}, remove() {}, parentNode: () => null, nextSibling: () => null });
  const app = renderer.createApp({ setup() {
    state = useVibe64OutputControlsSurface(props, {
      openUsage: vi.fn(), readUsageEntries: vi.fn(async () => ({ entries: [] })), recordInteraction: vi.fn(), recording: ref(null)
    });
    return () => null;
  } });
  app.provide(VIBE64_LEARNING_KEY, idleLearning());
  app.mount({});
  const fixture = {
    outputs,
    props,
    state,
    // The session change the server publishes, delivered to every listener it matches.
    request(previewOpen, { projectSlug = "notes", reason = "preview-open-requested", sessionId = "session-a" } = {}) {
      const context = { payload: { previewOpen, projectSlug, reason, sessionId } };
      for (const listener of host.realtime.filter((options) => options.event === "vibe64.session.changed")) {
        if (unref(listener.enabled) !== false && (!listener.matches || listener.matches(context))) listener.onEvent(context);
      }
    },
    answers: () => outputs.publishPreviewState.mock.calls.map(([answer]) => answer).filter((answer) => answer.openRequestId),
    dispose() {
      vi.stubGlobal("window", windowObject);
      vi.stubGlobal("document", documentObject);
      app.unmount();
    }
  };
  mounted.push(fixture);
  return fixture;
}

describe("a page the AI opens in the Preview", () => {
  it("opens as the address box would, with the Preview's token, says so and answers that it moved", async () => {
    vi.useFakeTimers();
    const f = mountPreview();
    expect(f.state.previewUrl.value).toBe(PREVIEW);

    f.request({ path: "/orders/42?tab=notes", requestId: "request-1" });
    expect(f.state.previewUrl.value).toBe("https://preview.example.test/orders/42?tab=notes&vibe64_preview_token=t");
    expect(f.state.previewWorkNotice.value).toBe("The AI opened /orders/42?tab=notes");
    expect(f.answers()).toEqual([{ openError: "", openRequestId: "request-1", opened: true, route: "/orders/42?tab=notes" }]);
    await nextTick();
    expect(f.state.previewAddressDraft.value).toBe("/orders/42?tab=notes");
    expect(f.state.previewBackAvailable.value).toBe(true);

    // Its page loads on the app's own site, so the guard for Vibe64's own page never fires.
    const frame = markRaw({ dataset: { previewFrameRequestId: String(f.state.previewFrameRequestId.value) },
      contentWindow: { get location() { throw new DOMException("Blocked a frame", "SecurityError"); }, postMessage() {} } });
    f.state.previewFrame.value = frame;
    f.state.handlePreviewFrameLoad({ currentTarget: frame });
    expect(f.outputs.publishPreviewDiagnostic).not.toHaveBeenCalledWith(expect.objectContaining({ event: "frame.left-preview" }));
    expect(f.state.previewWorkNotice.value).toBe("The AI opened /orders/42?tab=notes");

    // The same request delivered again opens nothing more.
    f.request({ path: "/orders/42?tab=notes", requestId: "request-1" });
    expect(f.answers()).toHaveLength(1);

    vi.advanceTimersByTime(9_000);
    expect(f.state.previewWorkNotice.value).not.toBe("");
    vi.advanceTimersByTime(2_000);
    expect(f.state.previewWorkNotice.value).toBe("");
  });

  it("refuses anything but a path inside the app, and leaves the Preview where it was", () => {
    const f = mountPreview();
    const refused = [
      "https://elsewhere.example/orders",
      `${EDITOR}/app`,
      "//elsewhere.example/orders",
      "javascript:alert(1)",
      "orders/42",
      "/\\elsewhere.example/orders",
      "/\t/elsewhere.example",
      "/__vibe64/preview-identity",
      "/orders?vibe64_preview_token=other",
      42
    ];
    refused.forEach((path, index) => f.request({ path, requestId: `bad-${index}` }));
    expect(f.state.previewUrl.value).toBe(PREVIEW);
    expect(f.state.previewWorkNotice.value).toBe("");
    expect(f.state.previewAddressError.value).toBe("");
    expect(f.answers()).toHaveLength(refused.length);
    for (const answer of f.answers()) {
      expect(answer.opened).toBe(false);
      expect(answer.openError).not.toBe("");
      expect(answer.route).toBeUndefined();
    }
  });

  it("answers why a suspended Preview did not move, and ignores another session's request", () => {
    const f = mountPreview();
    f.request({ path: "/orders/42", requestId: "other-session" }, { sessionId: "session-b" });
    f.request({ path: "/orders/42", requestId: "other-project" }, { projectSlug: "other" });
    expect(f.answers()).toEqual([]);

    f.state.previewSuspended.value = true;
    f.request({ path: "/orders/42", requestId: "suspended" });
    expect(f.state.previewUrl.value).toBe(PREVIEW);
    expect(f.answers()).toEqual([{
      openError: "The person's Preview is suspended; they can choose Resume preview.",
      openRequestId: "suspended",
      opened: false
    }]);
  });
});
