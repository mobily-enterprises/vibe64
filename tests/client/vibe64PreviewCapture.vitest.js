import { describe, expect, it, vi } from "vitest";
import {
  createRenderer,
  h,
  nextTick,
  ref
} from "vue";

import {
  createVibe64PreviewCaptureSession,
  PREVIEW_CAPTURE_MEDIA_OPTIONS,
  previewCaptureAvailable,
  previewCaptureCrop,
  previewCaptureErrorMessage,
  previewCaptureFileName,
  previewVisibleViewportRect,
  useVibe64PreviewCapture
} from "../../src/composables/useVibe64PreviewCapture.js";

class TestFile {
  constructor(parts, name, options = {}) {
    this.lastModified = options.lastModified;
    this.name = name;
    this.parts = parts;
    this.size = parts.reduce((total, part) => total + Number(part?.size || 0), 0);
    this.type = options.type;
  }
}

function testCaptureTrack(displaySurface = "browser") {
  const listeners = new Map();
  const track = {
    addEventListener: vi.fn((type, listener) => listeners.set(type, listener)),
    contentHint: "",
    getSettings: vi.fn(() => ({ displaySurface })),
    readyState: "live",
    removeEventListener: vi.fn((type, listener) => {
      if (listeners.get(type) === listener) {
        listeners.delete(type);
      }
    }),
    stop: vi.fn(() => {
      track.readyState = "ended";
    })
  };
  track.end = () => {
    track.readyState = "ended";
    listeners.get("ended")?.();
  };
  return track;
}

function testCaptureStream(track) {
  return {
    getTracks: () => [track],
    getVideoTracks: () => [track]
  };
}

function testCaptureDocument({
  frameHeight = 1200,
  frameWidth = 2000
} = {}) {
  const context = {
    drawImage: vi.fn()
  };
  const video = {
    cancelVideoFrameCallback: vi.fn(),
    pause: vi.fn(),
    play: vi.fn(async () => null),
    requestVideoFrameCallback: vi.fn((callback) => {
      callback();
      return 1;
    }),
    srcObject: null,
    videoHeight: frameHeight,
    videoWidth: frameWidth
  };
  const canvases = [];
  const documentObject = {
    createElement: vi.fn((tagName) => {
      if (tagName === "video") {
        return video;
      }
      const canvas = {
        getContext: vi.fn(() => context),
        height: 0,
        toBlob: vi.fn((callback) => callback(new Blob(["png"], {
          type: "image/png"
        }))),
        width: 0
      };
      canvases.push(canvas);
      return canvas;
    })
  };
  return {
    canvases,
    context,
    documentObject,
    video
  };
}

function visiblePreviewRect() {
  return previewVisibleViewportRect({
    bottom: 550,
    left: 100,
    right: 900,
    top: 50
  }, {
    height: 600,
    width: 1000
  });
}

function testRenderer() {
  return createRenderer({
    createComment: (text) => ({ text, type: "comment" }),
    createElement: (type) => ({ children: [], parent: null, type }),
    createText: (text) => ({ text, type: "text" }),
    insert: (child, parent) => {
      child.parent = parent;
      parent.children.push(child);
    },
    nextSibling: () => null,
    parentNode: (node) => node.parent,
    patchProp: () => null,
    remove: (child) => {
      const index = child.parent?.children?.indexOf(child) ?? -1;
      if (index >= 0) {
        child.parent.children.splice(index, 1);
      }
    },
    setElementText: (element, text) => {
      element.text = text;
    },
    setText: (node, text) => {
      node.text = text;
    }
  });
}

describe("Vibe64 visible preview capture", () => {
  it("requires the active loaded preview and a non-zero viewport intersection", () => {
    const ready = {
      canAttach: true,
      displayed: true,
      loaded: true,
      supported: true,
      visible: true
    };

    expect(previewCaptureAvailable(ready)).toBe(true);
    for (const key of ["displayed", "loaded", "visible"]) {
      expect(previewCaptureAvailable({
        ...ready,
        [key]: false
      })).toBe(false);
    }
  });

  it("clips the iframe rectangle to only the browser viewport", () => {
    expect(previewVisibleViewportRect({
      bottom: 700,
      left: -20,
      right: 480,
      top: 100
    }, {
      height: 600,
      width: 500
    })).toEqual({
      bottom: 600,
      height: 500,
      left: 0,
      right: 480,
      top: 100,
      viewportHeight: 600,
      viewportWidth: 500,
      width: 480
    });

    expect(previewVisibleViewportRect({
      bottom: 200,
      left: 520,
      right: 700,
      top: 0
    }, {
      height: 600,
      width: 500
    })).toBeNull();
  });

  it("maps CSS viewport pixels to the captured tab frame", () => {
    expect(previewCaptureCrop(visiblePreviewRect(), {
      height: 1200,
      width: 2000
    })).toEqual({
      height: 1000,
      sourceLeft: 200,
      sourceTop: 100,
      width: 1600
    });
  });

  it("requests the current tab without audio or surface switching", () => {
    expect(PREVIEW_CAPTURE_MEDIA_OPTIONS).toMatchObject({
      audio: false,
      monitorTypeSurfaces: "exclude",
      preferCurrentTab: true,
      selfBrowserSurface: "include",
      surfaceSwitching: "exclude",
      video: {
        displaySurface: "browser"
      }
    });
  });

  it("stops each browser-approved stream after creating a uniquely named attachment", async () => {
    const capturedAt = new Date("2026-07-15T02:03:04.567Z");
    const firstTrack = testCaptureTrack();
    const secondTrack = testCaptureTrack();
    const mediaDevices = {
      getDisplayMedia: vi.fn()
        .mockResolvedValueOnce(testCaptureStream(firstTrack))
        .mockResolvedValueOnce(testCaptureStream(secondTrack))
    };
    const {
      canvases,
      context,
      documentObject,
      video
    } = testCaptureDocument();
    const session = createVibe64PreviewCaptureSession({
      documentObject,
      fileConstructor: TestFile,
      mediaDevices,
      now: () => capturedAt
    });

    const first = await session.capture(visiblePreviewRect);
    const second = await session.capture(visiblePreviewRect);

    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(2);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledWith(PREVIEW_CAPTURE_MEDIA_OPTIONS);
    expect(documentObject.createElement).toHaveBeenCalledWith("video");
    expect(video.play).toHaveBeenCalledTimes(2);
    expect(video.pause).toHaveBeenCalledTimes(2);
    expect(context.drawImage).toHaveBeenNthCalledWith(
      1,
      video,
      200,
      100,
      1600,
      1000,
      0,
      0,
      1600,
      1000
    );
    expect(canvases.map((canvas) => [canvas.width, canvas.height])).toEqual([
      [1600, 1000],
      [1600, 1000]
    ]);
    expect(first.name).toBe("vibe64-preview-2026-07-15T02-03-04-567Z-01.png");
    expect(second.name).toBe("vibe64-preview-2026-07-15T02-03-04-567Z-02.png");
    expect(first.name).not.toBe(second.name);
    expect(first.type).toBe("image/png");

    expect(firstTrack.removeEventListener).toHaveBeenCalledTimes(1);
    expect(secondTrack.removeEventListener).toHaveBeenCalledTimes(1);
    expect(firstTrack.stop).toHaveBeenCalledTimes(1);
    expect(secondTrack.stop).toHaveBeenCalledTimes(1);
    expect(video.srcObject).toBeNull();
  });

  it("reacts to preview lifecycle gates and tears capture down with its session", async () => {
    const displayed = ref(true);
    const loaded = ref(true);
    const scopeKey = ref("session-1");
    const frame = ref({
      getBoundingClientRect: () => ({
        bottom: 550,
        left: 100,
        right: 900,
        top: 50
      })
    });
    const captureSession = {
      capture: vi.fn(async (getVisibleRect) => {
        expect(getVisibleRect()).toEqual(visiblePreviewRect());
        return {
          name: `preview-${captureSession.capture.mock.calls.length}.png`
        };
      }),
      stop: vi.fn(),
      supported: vi.fn(() => true)
    };
    const attachFile = vi.fn(async (file) => ({
      attachmentId: file.name
    }));
    const observerInstances = [];
    class TestObserver {
      constructor(callback) {
        this.callback = callback;
        this.disconnect = vi.fn();
        this.observe = vi.fn(() => callback());
        observerInstances.push(this);
      }
    }
    const windowObject = {
      IntersectionObserver: TestObserver,
      innerHeight: 600,
      innerWidth: 1000
    };
    let previewCapture = null;
    const app = testRenderer().createApp({
      setup() {
        previewCapture = useVibe64PreviewCapture({
          attachFile,
          captureSession,
          previewDisplayed: displayed,
          previewFrame: frame,
          previewLoaded: loaded,
          scopeKey,
          windowObject
        });
        return () => h("div");
      }
    });

    app.mount({
      children: []
    });
    await nextTick();
    expect(previewCapture.buttonVisible.value).toBe(true);

    displayed.value = false;
    await nextTick();
    expect(previewCapture.buttonVisible.value).toBe(false);
    displayed.value = true;
    loaded.value = false;
    await nextTick();
    expect(previewCapture.buttonVisible.value).toBe(false);
    loaded.value = true;
    await nextTick();
    expect(previewCapture.buttonVisible.value).toBe(true);

    expect(await previewCapture.capturePreview()).toBe(true);
    expect(await previewCapture.capturePreview()).toBe(true);
    expect(captureSession.capture).toHaveBeenCalledTimes(2);
    expect(attachFile.mock.calls.map(([file]) => file.name)).toEqual([
      "preview-1.png",
      "preview-2.png"
    ]);
    expect(previewCapture.noticeVisible.value).toBe(false);

    frame.value = {
      getBoundingClientRect: () => ({
        bottom: 200,
        left: 1100,
        right: 1300,
        top: 0
      })
    };
    await nextTick();
    expect(previewCapture.buttonVisible.value).toBe(false);

    scopeKey.value = "session-2";
    await nextTick();
    expect(captureSession.stop).toHaveBeenCalledTimes(1);

    app.unmount();
    expect(captureSession.stop).toHaveBeenCalledTimes(2);
    expect(observerInstances.every((observer) => observer.disconnect.mock.calls.length > 0)).toBe(true);
  });

  it("recovers when the user ends sharing while a frame is being captured", async () => {
    const firstTrack = testCaptureTrack();
    const secondTrack = testCaptureTrack();
    const mediaDevices = {
      getDisplayMedia: vi.fn()
        .mockResolvedValueOnce(testCaptureStream(firstTrack))
        .mockResolvedValueOnce(testCaptureStream(secondTrack))
    };
    const onEnded = vi.fn();
    const captureDocument = testCaptureDocument();
    captureDocument.video.play.mockImplementationOnce(async () => {
      firstTrack.end();
    });
    const session = createVibe64PreviewCaptureSession({
      documentObject: captureDocument.documentObject,
      fileConstructor: TestFile,
      mediaDevices,
      onEnded
    });

    await expect(session.capture(visiblePreviewRect))
      .rejects.toThrow("Preview capture was cancelled.");
    await session.capture(visiblePreviewRect);

    expect(onEnded).toHaveBeenCalledTimes(1);
    expect(mediaDevices.getDisplayMedia).toHaveBeenCalledTimes(2);
    expect(secondTrack.stop).toHaveBeenCalledTimes(1);
  });

  it("stops a share that resolves after its preview session was already closed", async () => {
    let resolveDisplayMedia;
    const track = testCaptureTrack();
    const { documentObject } = testCaptureDocument();
    const session = createVibe64PreviewCaptureSession({
      documentObject,
      fileConstructor: TestFile,
      mediaDevices: {
        getDisplayMedia: vi.fn(() => new Promise((resolve) => {
          resolveDisplayMedia = resolve;
        }))
      }
    });

    const capture = session.capture(visiblePreviewRect);
    session.stop();
    resolveDisplayMedia(testCaptureStream(track));

    await expect(capture).rejects.toThrow("Preview capture was cancelled.");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(documentObject.createElement).not.toHaveBeenCalled();
  });

  it("rejects window or monitor sharing before drawing any pixels", async () => {
    const track = testCaptureTrack("window");
    const { documentObject } = testCaptureDocument();
    const session = createVibe64PreviewCaptureSession({
      documentObject,
      fileConstructor: TestFile,
      mediaDevices: {
        getDisplayMedia: vi.fn(async () => testCaptureStream(track))
      }
    });

    await expect(session.capture(visiblePreviewRect))
      .rejects.toThrow("Choose the current Vibe64 tab, not a window or screen.");
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(documentObject.createElement).not.toHaveBeenCalled();
  });

  it("does not attach a frame if the preview becomes hidden during permission selection", async () => {
    const track = testCaptureTrack();
    const { context, documentObject } = testCaptureDocument();
    const session = createVibe64PreviewCaptureSession({
      documentObject,
      fileConstructor: TestFile,
      mediaDevices: {
        getDisplayMedia: vi.fn(async () => testCaptureStream(track))
      }
    });

    await expect(session.capture(() => null))
      .rejects.toThrow("The preview moved out of view before it could be captured.");
    expect(context.drawImage).not.toHaveBeenCalled();
    session.stop();
  });

  it("uses clear permission guidance and deterministic file names", () => {
    const denied = new Error("Permission denied");
    denied.name = "NotAllowedError";

    expect(previewCaptureErrorMessage(denied)).toContain("choose This Tab");
    expect(previewCaptureFileName(new Date("2026-07-15T02:03:04.567Z"), 7))
      .toBe("vibe64-preview-2026-07-15T02-03-04-567Z-07.png");
  });
});
