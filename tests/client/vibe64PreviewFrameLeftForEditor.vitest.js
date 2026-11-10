import { effectScope, markRaw, ref } from "vue";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("../../src/composables/useVibe64LearningOrientation.js", () => ({
  useVibe64LearningOrientation: () => ({ close() {} })
}));

const { useVibe64PreviewFrame } = await import("../../src/composables/useVibe64PreviewFrame.js");
const { previewFrameLeftForEditor } = await import("../../src/lib/vibe64PreviewFrame.js");
const { previewDiagnosticInputValidator } = await import("../../packages/vibe64-terminals/src/server/inputSchemas.js");

const EDITOR = "https://studio.example";
const PREVIEW = "https://preview.example/?vibe64_preview_token=t";

// A frame the editor can read: a page on the editor's own site, reached from the app's sign-in page.
function frameOnEditorSite(requestId) {
  return {
    dataset: { previewFrameRequestId: String(requestId) },
    contentWindow: {
      location: new URL(`${EDITOR}/`),
      document: { referrer: "https://preview.example/auth/login" },
      performance: { getEntriesByType: () => [{ type: "navigate" }] }
    }
  };
}

// A frame on the Preview's own site: reading its location throws, as a browser does across origins.
function frameOnPreviewSite(requestId) {
  return {
    dataset: { previewFrameRequestId: String(requestId) },
    contentWindow: { get location() { throw new DOMException("Blocked a frame", "SecurityError"); } }
  };
}

function previewFrameHarness() {
  vi.stubGlobal("window", { location: new URL(`${EDITOR}/app/project/gym`) });
  const published = [];
  const outputs = {
    activeOutputTargetId: ref("test-app"),
    launchActions: ref([{ kind: "url", href: "http://127.0.0.1:4100/", previewHref: PREVIEW }]),
    previewState: ref("ready"),
    publishPreviewDiagnostic: (record) => {
      published.push(record);
      return Promise.resolve(true);
    },
    terminalPreviewRequiresProxy: ref(false),
    terminalSessionId: ref("terminal-1")
  };
  const scope = effectScope();
  const frame = scope.run(() => useVibe64PreviewFrame({
    followIdentityReload() {},
    identityBusy: () => false,
    identityFrameReady() {},
    outputs,
    projectSlug: ref("gym"),
    props: { embeddedPreview: true, session: { sessionId: "session-1" } },
    resourceRetryCount: () => 0
  }));
  // Vue leaves a real iframe element unwrapped in a ref; a plain fake must be marked raw to stay the same object.
  function load(target) {
    markRaw(target);
    frame.previewFrame.value = target;
    frame.handlePreviewFrameLoad({ currentTarget: target });
  }
  return { frame, load, published, stop: () => scope.stop() };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe("a Preview frame that leaves the app for the editor's own site", () => {
  it("is told apart from the app's own pages and from an editor that previews its own site", () => {
    const options = { editorOrigin: EDITOR, previewBaseUrl: PREVIEW };
    expect(previewFrameLeftForEditor(frameOnEditorSite(1), options)).toEqual({
      frameUrl: `${EDITOR}/`,
      navigationType: "navigate",
      referrer: "https://preview.example/auth/login"
    });
    expect(previewFrameLeftForEditor(frameOnPreviewSite(1), options)).toBeNull();
    const blank = { contentWindow: { location: { protocol: "about:", origin: EDITOR, href: "about:blank" } } };
    expect(previewFrameLeftForEditor(blank, options)).toBeNull();
    expect(previewFrameLeftForEditor(frameOnEditorSite(1), { editorOrigin: EDITOR, previewBaseUrl: `${EDITOR}/app` })).toBeNull();
  });

  it("is recorded and loads the app again, and a repeat within a minute empties the frame", () => {
    vi.spyOn(console, "error").mockImplementation(() => {});
    const { frame, load, published, stop } = previewFrameHarness();
    try {
      expect(frame.requestPreviewFrame({ reason: "test" })).toBe(true);
      const firstRequest = frame.previewFrameRequestId.value;
      load(frameOnPreviewSite(firstRequest));
      expect(published).toEqual([]);
      expect(frame.previewFrameRequestId.value).toBe(firstRequest);

      load(frameOnEditorSite(firstRequest));
      expect(published).toEqual([expect.objectContaining({
        event: "frame.left-preview",
        frameRequestId: firstRequest,
        frameUrl: `${EDITOR}/`,
        navigationType: "navigate",
        referrer: "https://preview.example/auth/login"
      })]);
      const { errors } = previewDiagnosticInputValidator.schema.create({ ...published[0], enabled: true });
      expect(errors).toEqual({});
      expect(frame.previewFrameRequestId.value).toBe(firstRequest + 1);
      expect(frame.previewUrl.value).toMatch(/^https:\/\/preview\.example\//u);

      load(frameOnEditorSite(frame.previewFrameRequestId.value));
      expect(published).toHaveLength(2);
      expect(frame.previewUrl.value).toBe("");
    } finally {
      stop();
    }
  });
});
