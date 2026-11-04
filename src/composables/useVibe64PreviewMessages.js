import { onBeforeMount, onBeforeUnmount } from "vue";
import { normalizeObject } from "@jskit-ai/kernel/shared/support/normalize";
import {
  PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
  PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
  PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
  PREVIEW_INTERACTION_MESSAGE_TYPE,
  PREVIEW_LOCATION_MESSAGE_TYPE,
  PREVIEW_PICK_RESULT_MESSAGE_TYPE,
  PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
} from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import { isOrientationAnnouncement } from "@/composables/useVibe64LearningOrientation.js";
import {
  previewRouteFromUrl,
  previewUrlWithoutDisplayParams
} from "@/lib/vibe64PreviewAddress.js";

/**
 * The messages the embedded Preview's page posts to the editor. Only messages
 * from the frame's own window and the Preview's origins are read; each goes to
 * the concern that owns it: bridge readiness, Click in Preview, recording,
 * resource failures, bridge request answers, Learning's orientation, and the
 * page's location (published as the session's Preview state).
 * @param {{
 *   address: import("@/types.js").Vibe64PreviewAddress,
 *   frame: import("@/types.js").Vibe64PreviewFrame,
 *   outputs: import("@/types.js").Vibe64OutputControls,
 *   pick: import("@/types.js").Vibe64PreviewPick,
 *   reload: import("@/types.js").Vibe64PreviewReload
 * }} options
 */
function useVibe64PreviewMessages({ address, frame, outputs, pick, reload }) {
  const { launchActions, publishPreviewState } = outputs;
  const {
    orientation,
    previewBaseUrl,
    previewBridgeRequests,
    previewDebugLog,
    previewDisplayBaseUrl,
    previewFrame,
    previewSuspended,
    receivePreviewBridgeMessage
  } = frame;
  const { recordPreviewVisit } = address;
  const { finishPreviewPick, forwardPreviewInteraction, publishPreviewRecording } = pick;
  const { handlePreviewResourceFailure } = reload;

  function previewMessageUrl(data = {}) {
    if (
      !data ||
      typeof data !== "object" ||
      data.type !== PREVIEW_LOCATION_MESSAGE_TYPE
    ) {
      return "";
    }
    const href = String(data.href || data.url || "").trim();
    const baseUrl = String(previewDisplayBaseUrl.value || previewBaseUrl.value || "").trim();
    if (!href || !baseUrl) {
      return "";
    }
    try {
      const url = new URL(href, baseUrl);
      const baseOrigin = new URL(baseUrl).origin;
      if (url.origin === baseOrigin) {
        return previewUrlWithoutDisplayParams(url.toString());
      }
      const mappedUrl = previewMessageTargetUrlToPreviewUrl(url);
      return mappedUrl ? previewUrlWithoutDisplayParams(mappedUrl) : "";
    } catch {
      return "";
    }
  }

  function previewMessageTargetUrlToPreviewUrl(targetUrl) {
    const previewBase = String(previewBaseUrl.value || "").trim();
    if (!previewBase || !targetUrl) {
      return "";
    }
    const matchingAction = launchActions.value.find((action) => {
      try {
        return new URL(String(action?.href || "")).origin === targetUrl.origin &&
          String(action?.previewHref || "").trim();
      } catch {
        return false;
      }
    });
    if (!matchingAction) {
      return "";
    }
    try {
      const previewUrl = new URL(previewBase);
      previewUrl.pathname = targetUrl.pathname;
      previewUrl.search = targetUrl.search;
      previewUrl.hash = targetUrl.hash;
      return previewUrl.toString();
    } catch {
      return "";
    }
  }

  function previewMessageOriginAllowed(event) {
    const origins = [
      previewBaseUrl.value,
      previewDisplayBaseUrl.value
    ].map((value) => {
      try {
        return value ? new URL(value).origin : "";
      } catch {
        return "";
      }
    }).filter(Boolean);
    return origins.length < 1 || origins.includes(String(event?.origin || ""));
  }

  /** A posted message's type; any window can post anything, null included. */
  function previewMessageType(value) {
    return String(normalizeObject(value).type || "");
  }

  function isPreviewBridgeMessage(value = {}) {
    return [
      PREVIEW_BRIDGE_READY_MESSAGE_TYPE,
      PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE,
      PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE,
      PREVIEW_INTERACTION_MESSAGE_TYPE,
      PREVIEW_LOCATION_MESSAGE_TYPE,
      PREVIEW_PICK_RESULT_MESSAGE_TYPE,
      PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE
    ].includes(previewMessageType(value));
  }

  function handlePreviewBridgeMessage(event) {
    if (previewSuspended.value) return;
    const orientationAvailable = isOrientationAnnouncement(event?.data);
    if (!orientationAvailable && !isPreviewBridgeMessage(event?.data)) {
      return;
    }
    if (event?.source !== previewFrame.value?.contentWindow) {
      previewDebugLog("message.ignored", {
        messageType: previewMessageType(event?.data),
        origin: String(event?.origin || ""),
        reason: "source_mismatch"
      });
      return;
    }
    if (!previewMessageOriginAllowed(event)) {
      previewDebugLog("message.ignored", {
        messageType: previewMessageType(event?.data),
        origin: String(event?.origin || ""),
        reason: "origin_not_allowed"
      });
      return;
    }
    if (orientationAvailable) {
      orientation.announce(event);
      return;
    }
    const messageType = previewMessageType(event.data);
    if (receivePreviewBridgeMessage(event)) {
      publishPreviewRecording();
      return;
    }
    if (messageType === PREVIEW_PICK_RESULT_MESSAGE_TYPE) {
      void finishPreviewPick(event.data);
      return;
    }
    if (messageType === PREVIEW_INTERACTION_MESSAGE_TYPE) {
      void forwardPreviewInteraction(event.data);
      return;
    }
    if (messageType === PREVIEW_RESOURCE_FAILURE_MESSAGE_TYPE) {
      handlePreviewResourceFailure(event.data);
      return;
    }
    if (messageType === PREVIEW_DIAGNOSTICS_RESPONSE_MESSAGE_TYPE) {
      const requestId = String(event.data?.requestId || "");
      previewBridgeRequests.resolve(requestId, event.data?.diagnostics || {});
      return;
    }
    if (messageType === PREVIEW_IDENTITY_RESPONSE_MESSAGE_TYPE) {
      const requestId = String(event.data?.requestId || "");
      if (event.data?.ok === true) {
        previewBridgeRequests.resolve(requestId, {
          identity: event.data?.identity || null
        });
      } else {
        previewBridgeRequests.reject(requestId, Object.assign(new Error(String(
          event.data?.error || "Preview identity exchange failed."
        )), {
          code: String(event.data?.code || "vibe64_preview_identity_exchange_failed"),
          signedOut: event.data?.signedOut === true
        }));
      }
      return;
    }
    const frameUrl = previewMessageUrl(event.data);
    previewDebugLog("message.received", {
      frameUrl,
      href: String(event?.data?.href || event?.data?.url || ""),
      messageType: previewMessageType(event?.data),
      origin: String(event?.origin || ""),
      reason: String(event?.data?.reason || "")
    });
    if (frameUrl) {
      recordPreviewVisit(frameUrl, {
        reason: String(event?.data?.reason || "")
      });
      void publishPreviewState({
        route: previewRouteFromUrl(frameUrl),
        title: String(event?.data?.title || "")
      });
    }
  }

  onBeforeMount(() => {
    window.addEventListener("message", handlePreviewBridgeMessage);
  });

  onBeforeUnmount(() => {
    window.removeEventListener("message", handlePreviewBridgeMessage);
  });
}

export {
  useVibe64PreviewMessages
};
