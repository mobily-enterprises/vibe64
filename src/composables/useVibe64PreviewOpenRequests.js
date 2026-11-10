import { computed, onBeforeUnmount, ref, watch } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { PREVIEW_OPEN_REQUESTED_REASON } from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import { previewRouteFromUrl } from "@/lib/vibe64PreviewAddress.js";
import {
  VIBE64_SESSION_CHANGED_EVENT,
  vibe64SessionEventMatchesScope
} from "@/lib/vibe64SessionRequestConfig.js";

// Long enough to read after looking back at the Preview.
const PREVIEW_OPEN_NOTICE_MS = 10_000;
const PREVIEW_OPEN_NOTICE_PATH_LENGTH = 120;

/**
 * Pages the AI opens in this embedded Preview (`vibe64-helper preview open`):
 * the session's request arrives as a session change, the address bar opens the
 * page as if it had been typed there, a short notice above the Preview says the
 * AI opened it, and the editor answers whether its Preview moved, else why not.
 * @param {{
 *   address: import("@/types.js").Vibe64PreviewAddress,
 *   outputs: import("@/types.js").Vibe64OutputControls,
 *   projectSlug: import("vue").Ref<string>,
 *   props: { embeddedPreview?: boolean, session?: object | null }
 * }} options
 */
function useVibe64PreviewOpenRequests({ address, outputs, projectSlug, props }) {
  const { publishPreviewState } = outputs;
  const { openPreviewPath, previewDisplayedUrl } = address;
  const previewOpenNotice = ref("");
  let previewOpenNoticeTimer = null;
  let lastRequestId = "";
  const sessionId = computed(() => String(props.session?.sessionId || ""));

  function showPreviewOpenNotice(text = "") {
    clearTimeout(previewOpenNoticeTimer);
    previewOpenNotice.value = text;
    previewOpenNoticeTimer = text
      ? setTimeout(() => { previewOpenNotice.value = ""; }, PREVIEW_OPEN_NOTICE_MS)
      : null;
  }

  /**
   * Opens the requested page and answers the request once; a request already
   * answered is not opened again.
   * @param {{ path?: unknown, requestId?: unknown } | null | undefined} request
   */
  function receivePreviewOpenRequest(request) {
    const requestId = String(request?.requestId || "").trim();
    if (!requestId || requestId === lastRequestId) {
      return false;
    }
    lastRequestId = requestId;
    const path = typeof request?.path === "string" ? request.path : "";
    const result = openPreviewPath(path);
    if (result.moved) {
      showPreviewOpenNotice(`The AI opened ${path.length > PREVIEW_OPEN_NOTICE_PATH_LENGTH
        ? `${path.slice(0, PREVIEW_OPEN_NOTICE_PATH_LENGTH - 1)}…`
        : path}`);
    }
    void publishPreviewState({
      openError: result.error,
      openRequestId: requestId,
      opened: result.moved,
      // The page it now shows; one that did not move still shows its last page.
      ...(result.moved ? { route: previewRouteFromUrl(previewDisplayedUrl.value) } : {})
    });
    return result.moved;
  }

  useRealtimeEvent({
    enabled: computed(() => Boolean(props.embeddedPreview && sessionId.value)),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => (
      payload.reason === PREVIEW_OPEN_REQUESTED_REASON &&
      payload.sessionId === sessionId.value &&
      vibe64SessionEventMatchesScope(payload, { projectSlug: projectSlug.value })
    ),
    onEvent: ({ payload = {} } = {}) => {
      receivePreviewOpenRequest(payload.previewOpen);
    }
  });

  watch(sessionId, () => showPreviewOpenNotice(""));

  onBeforeUnmount(() => {
    clearTimeout(previewOpenNoticeTimer);
  });

  return {
    previewOpenNotice,
    receivePreviewOpenRequest
  };
}

export {
  useVibe64PreviewOpenRequests
};
