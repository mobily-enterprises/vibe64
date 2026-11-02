// The Preview's frame: when a loaded page is a new one, when it is still
// opening, and the requests the editor sends to the bridge in that page.

import { PREVIEW_BRIDGE_READY_MESSAGE_TYPE } from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import { previewUrlWithoutDisplayParams } from "@/lib/vibe64PreviewAddress.js";

function previewFrameLifecycleIdentity({
  outputTargetId = "",
  sessionId = "",
  src = "",
  terminalSessionId = ""
} = {}) {
  return previewLifecycleIdentity([
    String(sessionId || "").trim(),
    String(outputTargetId || "").trim(),
    String(terminalSessionId || "").trim()
  ], src);
}

function previewIdentityLifecycleIdentity({
  outputTargetId = "",
  previewBaseUrl = "",
  projectSlug = "",
  sessionId = "",
  terminalSessionId = ""
} = {}) {
  return previewLifecycleIdentity([
    String(projectSlug || "").trim(),
    String(sessionId || "").trim(),
    String(outputTargetId || "").trim(),
    String(terminalSessionId || "").trim()
  ], previewBaseUrl);
}

function previewLifecycleIdentity(parts = [], url = "") {
  const canonicalUrl = previewUrlWithoutDisplayParams(url);
  return canonicalUrl
    ? [...parts, canonicalUrl].join("\u0000")
    : "";
}

function isPreviewBridgeReadyMessage(value = {}) {
  return String(value?.type || "") === PREVIEW_BRIDGE_READY_MESSAGE_TYPE;
}

function previewOpeningOverlayVisible({
  loadedFrameRequestId = 0,
  previewFrameRequestId = 0,
  previewUrl = ""
} = {}) {
  const requestId = Math.max(0, Number(previewFrameRequestId) || 0);
  return Boolean(
    String(previewUrl || "").trim() &&
    requestId > 0 &&
    requestId !== Math.max(0, Number(loadedFrameRequestId) || 0)
  );
}

function previewLoadingOverlayShouldShow({
  identityBusy = false,
  loadedFrameRequestId = 0,
  previewFrameRequestId = 0,
  previewUrl = ""
} = {}) {
  return Boolean(identityBusy || previewOpeningOverlayVisible({
    loadedFrameRequestId,
    previewFrameRequestId,
    previewUrl
  }));
}

function createPreviewBridgeRequestRegistry() {
  const pendingRequests = new Map();
  let sequence = 0;

  function take(requestId = "") {
    const pending = pendingRequests.get(requestId);
    if (!pending) {
      return null;
    }
    clearTimeout(pending.timeout);
    pending.signal?.removeEventListener?.("abort", pending.abortHandler);
    pendingRequests.delete(requestId);
    return pending;
  }

  function reject(requestId, error) {
    const pending = take(requestId);
    pending?.reject(error);
    return Boolean(pending);
  }

  function rejectAll(message = "The application preview changed.") {
    for (const requestId of [...pendingRequests.keys()]) {
      reject(requestId, new Error(message));
    }
  }

  function request({
    frameRequestId = 0,
    message = {},
    signal = null,
    targetOrigin = "",
    targetWindow = null,
    timeoutMessage = "The application preview did not respond in time.",
    timeoutMs = 3000
  } = {}) {
    if (!targetOrigin || !targetWindow || typeof targetWindow.postMessage !== "function") {
      return Promise.reject(new Error("The application preview is not ready."));
    }
    if (signal?.aborted) {
      const error = new Error("Preview diagnostics collection was cancelled.");
      error.name = "AbortError";
      return Promise.reject(error);
    }
    const requestId = [frameRequestId, Date.now(), ++sequence].join(":");
    const response = new Promise((resolve, rejectRequest) => {
      const abortHandler = () => {
        const error = new Error("Preview diagnostics collection was cancelled.");
        error.name = "AbortError";
        reject(requestId, error);
      };
      const timeout = setTimeout(() => {
        reject(requestId, new Error(timeoutMessage));
      }, timeoutMs);
      pendingRequests.set(requestId, {
        abortHandler,
        reject: rejectRequest,
        resolve,
        signal,
        timeout
      });
      signal?.addEventListener?.("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
      }
    });
    try {
      targetWindow.postMessage({
        ...message,
        requestId
      }, targetOrigin);
    } catch (error) {
      reject(requestId, error);
    }
    return response;
  }

  function resolve(requestId, value) {
    const pending = take(requestId);
    pending?.resolve(value);
    return Boolean(pending);
  }

  return Object.freeze({
    reject,
    rejectAll,
    request,
    resolve
  });
}

export {
  createPreviewBridgeRequestRegistry,
  isPreviewBridgeReadyMessage,
  previewFrameLifecycleIdentity,
  previewIdentityLifecycleIdentity,
  previewLoadingOverlayShouldShow,
  previewOpeningOverlayVisible
};
