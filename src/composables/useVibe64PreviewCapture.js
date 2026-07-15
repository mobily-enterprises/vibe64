import {
  computed,
  onBeforeUnmount,
  onMounted,
  ref,
  watch
} from "vue";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const PREVIEW_CAPTURE_FRAME_TIMEOUT_MS = 5000;
const PREVIEW_CAPTURE_MEDIA_OPTIONS = Object.freeze({
  audio: false,
  monitorTypeSurfaces: "exclude",
  preferCurrentTab: true,
  selfBrowserSurface: "include",
  surfaceSwitching: "exclude",
  video: {
    displaySurface: "browser"
  }
});

function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

function previewVisibleViewportRect(rect = {}, viewport = {}) {
  const viewportWidth = positiveNumber(viewport.width);
  const viewportHeight = positiveNumber(viewport.height);
  if (!viewportWidth || !viewportHeight) {
    return null;
  }
  const rectLeft = Number(rect.left) || 0;
  const rectTop = Number(rect.top) || 0;
  const rectRight = Number.isFinite(Number(rect.right))
    ? Number(rect.right)
    : rectLeft + positiveNumber(rect.width);
  const rectBottom = Number.isFinite(Number(rect.bottom))
    ? Number(rect.bottom)
    : rectTop + positiveNumber(rect.height);
  const left = Math.max(0, Math.min(viewportWidth, rectLeft));
  const top = Math.max(0, Math.min(viewportHeight, rectTop));
  const right = Math.max(0, Math.min(viewportWidth, rectRight));
  const bottom = Math.max(0, Math.min(viewportHeight, rectBottom));
  if (right <= left || bottom <= top) {
    return null;
  }
  return {
    bottom,
    height: bottom - top,
    left,
    right,
    top,
    viewportHeight,
    viewportWidth,
    width: right - left
  };
}

function previewCaptureCrop(visibleRect = {}, frame = {}) {
  const frameWidth = Math.floor(positiveNumber(frame.width));
  const frameHeight = Math.floor(positiveNumber(frame.height));
  const viewportWidth = positiveNumber(visibleRect.viewportWidth);
  const viewportHeight = positiveNumber(visibleRect.viewportHeight);
  if (!frameWidth || !frameHeight || !viewportWidth || !viewportHeight) {
    return null;
  }
  const scaleX = frameWidth / viewportWidth;
  const scaleY = frameHeight / viewportHeight;
  const sourceLeft = Math.max(0, Math.min(frameWidth, Math.floor(Number(visibleRect.left) * scaleX)));
  const sourceTop = Math.max(0, Math.min(frameHeight, Math.floor(Number(visibleRect.top) * scaleY)));
  const sourceRight = Math.max(sourceLeft, Math.min(frameWidth, Math.ceil(Number(visibleRect.right) * scaleX)));
  const sourceBottom = Math.max(sourceTop, Math.min(frameHeight, Math.ceil(Number(visibleRect.bottom) * scaleY)));
  const width = sourceRight - sourceLeft;
  const height = sourceBottom - sourceTop;
  return width > 0 && height > 0
    ? {
        height,
        sourceLeft,
        sourceTop,
        width
      }
    : null;
}

function previewCaptureFileName(date = new Date(), sequence = 1) {
  const captureDate = date instanceof Date ? date : new Date(date);
  const timestamp = captureDate.toISOString()
    .replace(/[:.]/gu, "-");
  return `vibe64-preview-${timestamp}-${String(sequence).padStart(2, "0")}.png`;
}

function previewCaptureError(message, code = "") {
  const error = new Error(message);
  error.code = code;
  return error;
}

function previewCaptureErrorMessage(error) {
  if (error?.name === "NotAllowedError") {
    return "Preview capture was not allowed. Click the eye again and choose This Tab.";
  }
  if (error?.name === "NotFoundError") {
    return "This browser could not find a tab that it can capture.";
  }
  if (error?.name === "NotReadableError") {
    return "The browser could not read the shared tab. Stop another screen capture and try again.";
  }
  return String(error?.message || error || "Preview capture failed.").trim() || "Preview capture failed.";
}

function previewCaptureAvailable({
  canAttach = false,
  displayed = false,
  loaded = false,
  supported = false,
  visible = false
} = {}) {
  return Boolean(canAttach && displayed && loaded && supported && visible);
}

function stopMediaStream(stream) {
  for (const track of stream?.getTracks?.() || []) {
    track?.stop?.();
  }
}

function waitForPreviewVideoFrame(video, {
  clearTimeoutFn = globalThis.clearTimeout,
  requestAnimationFrameFn = globalThis.requestAnimationFrame,
  setTimeoutFn = globalThis.setTimeout,
  timeoutMs = PREVIEW_CAPTURE_FRAME_TIMEOUT_MS
} = {}) {
  return new Promise((resolve, reject) => {
    let frameCallbackId = 0;
    let settled = false;
    const finish = (error = null) => {
      if (settled) {
        return;
      }
      settled = true;
      clearTimeoutFn(timeoutId);
      if (frameCallbackId && typeof video.cancelVideoFrameCallback === "function") {
        video.cancelVideoFrameCallback(frameCallbackId);
      }
      if (error) {
        reject(error);
        return;
      }
      resolve();
    };
    const frameReady = () => {
      if (!positiveNumber(video.videoWidth) || !positiveNumber(video.videoHeight)) {
        finish(previewCaptureError("The shared tab did not provide an image frame.", "frame_unavailable"));
        return;
      }
      finish();
    };
    const timeoutId = setTimeoutFn(() => {
      finish(previewCaptureError("The shared tab did not provide an image frame in time.", "frame_timeout"));
    }, timeoutMs);
    if (typeof video.requestVideoFrameCallback === "function") {
      frameCallbackId = video.requestVideoFrameCallback(frameReady);
      return;
    }
    const requestFrame = typeof requestAnimationFrameFn === "function"
      ? requestAnimationFrameFn
      : (callback) => setTimeoutFn(callback, 16);
    requestFrame(() => requestFrame(frameReady));
  });
}

function previewCanvasBlob(canvas) {
  return new Promise((resolve, reject) => {
    canvas.toBlob((blob) => {
      if (!blob) {
        reject(previewCaptureError("The preview image could not be encoded.", "encode_failed"));
        return;
      }
      resolve(blob);
    }, "image/png");
  });
}

function createVibe64PreviewCaptureSession({
  clearTimeoutFn = globalThis.clearTimeout,
  documentObject = globalThis.document,
  fileConstructor = globalThis.File,
  mediaDevices = globalThis.navigator?.mediaDevices,
  now = () => new Date(),
  onEnded = () => null,
  requestAnimationFrameFn = globalThis.requestAnimationFrame,
  setTimeoutFn = globalThis.setTimeout
} = {}) {
  let captureGeneration = 0;
  let captureSequence = 0;
  let captureStream = null;
  let captureTrack = null;
  let captureVideo = null;

  function supported() {
    return Boolean(
      mediaDevices?.getDisplayMedia &&
      documentObject?.createElement &&
      typeof fileConstructor === "function"
    );
  }

  function release({ stopTracks = false } = {}) {
    const stream = captureStream;
    if (captureTrack) {
      captureTrack.removeEventListener?.("ended", handleTrackEnded);
    }
    captureVideo?.pause?.();
    if (captureVideo) {
      captureVideo.srcObject = null;
    }
    captureStream = null;
    captureTrack = null;
    captureVideo = null;
    if (stopTracks) {
      stopMediaStream(stream);
    }
  }

  function handleTrackEnded() {
    captureGeneration += 1;
    release();
    onEnded();
  }

  async function ensureCaptureVideo() {
    if (captureTrack?.readyState !== "ended" && captureVideo) {
      return captureVideo;
    }
    release({ stopTracks: true });
    if (!supported()) {
      throw previewCaptureError("This browser cannot capture the visible preview.", "unsupported");
    }
    const generation = captureGeneration;
    const stream = await mediaDevices.getDisplayMedia(PREVIEW_CAPTURE_MEDIA_OPTIONS);
    if (generation !== captureGeneration) {
      stopMediaStream(stream);
      throw previewCaptureError("Preview capture was cancelled.", "capture_cancelled");
    }
    const track = stream?.getVideoTracks?.()[0] || null;
    const displaySurface = String(track?.getSettings?.().displaySurface || "");
    if (!track || track.readyState === "ended") {
      stopMediaStream(stream);
      throw previewCaptureError("The browser did not share a live tab.", "track_unavailable");
    }
    if (displaySurface && displaySurface !== "browser") {
      stopMediaStream(stream);
      throw previewCaptureError("Choose the current Vibe64 tab, not a window or screen.", "wrong_surface");
    }
    const video = documentObject.createElement("video");
    video.autoplay = false;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    if ("contentHint" in track) {
      track.contentHint = "detail";
    }
    captureStream = stream;
    captureTrack = track;
    captureVideo = video;
    track.addEventListener?.("ended", handleTrackEnded);
    return video;
  }

  async function capture(getVisibleRect) {
    const generation = captureGeneration;
    const video = await ensureCaptureVideo();
    try {
      await video.play();
      await waitForPreviewVideoFrame(video, {
        clearTimeoutFn,
        requestAnimationFrameFn,
        setTimeoutFn
      });
      if (generation !== captureGeneration) {
        throw previewCaptureError("Preview capture was cancelled.", "capture_cancelled");
      }
      const visibleRect = typeof getVisibleRect === "function" ? getVisibleRect() : null;
      if (!visibleRect) {
        throw previewCaptureError("The preview moved out of view before it could be captured.", "preview_not_visible");
      }
      const crop = previewCaptureCrop(visibleRect, {
        height: video.videoHeight,
        width: video.videoWidth
      });
      if (!crop) {
        throw previewCaptureError("The visible preview area could not be captured.", "crop_unavailable");
      }
      const canvas = documentObject.createElement("canvas");
      canvas.height = crop.height;
      canvas.width = crop.width;
      const context = canvas.getContext("2d");
      if (!context) {
        throw previewCaptureError("The browser could not create the preview image.", "canvas_unavailable");
      }
      context.drawImage(
        video,
        crop.sourceLeft,
        crop.sourceTop,
        crop.width,
        crop.height,
        0,
        0,
        crop.width,
        crop.height
      );
      const blob = await previewCanvasBlob(canvas);
      captureSequence += 1;
      const capturedAt = now();
      return new fileConstructor([
        blob
      ], previewCaptureFileName(capturedAt, captureSequence), {
        lastModified: capturedAt.getTime(),
        type: "image/png"
      });
    } finally {
      release({ stopTracks: true });
    }
  }

  function stop() {
    captureGeneration += 1;
    release({ stopTracks: true });
  }

  return {
    capture,
    stop,
    supported
  };
}

function useVibe64PreviewCapture({
  attachFile,
  captureSession = null,
  previewDisplayed,
  previewFrame,
  previewLoaded,
  scopeKey,
  windowObject = globalThis.window
} = {}) {
  const busy = ref(false);
  const noticeColor = ref("success");
  const noticeText = ref("");
  const noticeVisible = ref(false);
  const visible = ref(false);
  const session = captureSession || createVibe64PreviewCaptureSession({
    onEnded: () => {
      noticeColor.value = "info";
      noticeText.value = "Preview sharing ended. Click the eye to share this tab again.";
      noticeVisible.value = true;
    }
  });
  let intersectionObserver = null;
  let mounted = false;

  function currentVisibleRect() {
    if (
      readRefOrGetterValue(previewDisplayed) !== true ||
      readRefOrGetterValue(previewLoaded) !== true
    ) {
      return null;
    }
    const frame = readRefOrGetterValue(previewFrame);
    if (!frame?.getBoundingClientRect || !windowObject) {
      return null;
    }
    return previewVisibleViewportRect(frame.getBoundingClientRect(), {
      height: windowObject.innerHeight,
      width: windowObject.innerWidth
    });
  }

  function refreshVisibility() {
    visible.value = Boolean(currentVisibleRect());
  }

  function disconnectObserver() {
    intersectionObserver?.disconnect?.();
    intersectionObserver = null;
  }

  function observeCurrentFrame() {
    disconnectObserver();
    const frame = readRefOrGetterValue(previewFrame);
    if (!frame) {
      refreshVisibility();
      return;
    }
    if (typeof windowObject?.IntersectionObserver === "function") {
      intersectionObserver = new windowObject.IntersectionObserver(refreshVisibility, {
        threshold: 0
      });
      intersectionObserver.observe(frame);
    }
    refreshVisibility();
  }

  const supported = computed(() => session.supported());
  const buttonVisible = computed(() => previewCaptureAvailable({
    canAttach: typeof attachFile === "function",
    displayed: readRefOrGetterValue(previewDisplayed) === true,
    loaded: readRefOrGetterValue(previewLoaded) === true,
    supported: supported.value,
    visible: visible.value
  }));

  async function capturePreview() {
    if (busy.value || !currentVisibleRect() || typeof attachFile !== "function") {
      return false;
    }
    busy.value = true;
    noticeVisible.value = false;
    try {
      const file = await session.capture(currentVisibleRect);
      const result = await attachFile(file);
      const attached = Array.isArray(result) ? result.length > 0 : Boolean(result);
      if (!attached) {
        throw previewCaptureError("The preview image could not be attached to the current message.", "attach_failed");
      }
      noticeText.value = "";
      noticeVisible.value = false;
      return true;
    } catch (error) {
      if (error?.code === "capture_cancelled") {
        return false;
      }
      noticeColor.value = "error";
      noticeText.value = previewCaptureErrorMessage(error);
      noticeVisible.value = true;
      return false;
    } finally {
      busy.value = false;
      refreshVisibility();
    }
  }

  watch(() => readRefOrGetterValue(previewFrame), () => {
    if (mounted) {
      observeCurrentFrame();
    }
  }, {
    flush: "post"
  });

  watch([
    () => readRefOrGetterValue(previewDisplayed),
    () => readRefOrGetterValue(previewLoaded)
  ], refreshVisibility, {
    flush: "post"
  });

  watch(() => readRefOrGetterValue(scopeKey), (nextKey, previousKey) => {
    if (previousKey !== undefined && nextKey !== previousKey) {
      session.stop();
      noticeVisible.value = false;
    }
  });

  onMounted(() => {
    mounted = true;
    observeCurrentFrame();
  });

  onBeforeUnmount(() => {
    mounted = false;
    disconnectObserver();
    session.stop();
  });

  return {
    busy,
    buttonVisible,
    capturePreview,
    noticeColor,
    noticeText,
    noticeVisible,
    refreshVisibility,
    supported,
    visible
  };
}

export {
  createVibe64PreviewCaptureSession,
  PREVIEW_CAPTURE_MEDIA_OPTIONS,
  previewCaptureAvailable,
  previewCaptureCrop,
  previewCaptureErrorMessage,
  previewCaptureFileName,
  previewVisibleViewportRect,
  useVibe64PreviewCapture
};
