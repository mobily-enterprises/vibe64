import { nextTick, onBeforeUnmount, ref, watch } from "vue";
import { usePageActivity } from "@/lib/vibe64PageActivity.js";

const PREVIEW_RESOURCE_RETRY_DELAY_MS = 250;
const PREVIEW_RESOURCE_RETRY_LIMIT = 1;

/**
 * Reloading the Preview's page: once by itself after the page fails to load an
 * application resource (with a notice either way), by hand with Reload
 * preview, and when a suspended Preview resumes.
 * @param {{
 *   frame: ReturnType<typeof import("./useVibe64PreviewFrame.js").useVibe64PreviewFrame>,
 *   identity: ReturnType<typeof import("./useVibe64PreviewIdentity.js").useVibe64PreviewIdentity>,
 *   outputs: ReturnType<typeof import("./useVibe64OutputControls.js").useVibe64OutputControls>,
 *   projectSlug: import("vue").Ref<string>,
 *   props: { session?: object | null }
 * }} options
 */
function useVibe64PreviewReload({ frame, identity, outputs, projectSlug, props }) {
  const { refresh: refreshOutputs } = outputs;
  const {
    clearPreviewFrame,
    previewDebugLog,
    previewFrameRequestId,
    previewIdentityLifecycleKey,
    previewSuspended,
    previewUrl,
    requestPreviewFrame
  } = frame;
  const {
    allowResumedPreviewIdentity,
    completePreviewIdentityTransition,
    rememberPreviewIdentityForResume
  } = identity;
  // What the person did here, for a lesson's do beats.
  const reportActivity = usePageActivity();
  const previewResourceNoticeText = ref("");
  const previewResourceNoticeVisible = ref(false);
  let previewResourceRetryCount = 0;
  let previewResourceRetryLifecycle = "";
  let previewResourceRetryTimer = null;

  function cancelPreviewResourceRetry() {
    if (previewResourceRetryTimer !== null) {
      clearTimeout(previewResourceRetryTimer);
      previewResourceRetryTimer = null;
    }
  }

  function resetPreviewResourceRecovery(lifecycle = "") {
    cancelPreviewResourceRetry();
    previewResourceRetryCount = 0;
    previewResourceRetryLifecycle = String(lifecycle || "");
    previewResourceNoticeText.value = "";
    previewResourceNoticeVisible.value = false;
  }

  function showPreviewResourceNotice(message = "") {
    previewResourceNoticeText.value = String(message || "");
    previewResourceNoticeVisible.value = Boolean(previewResourceNoticeText.value);
  }

  function handlePreviewResourceFailure(message = {}) {
    const lifecycle = previewIdentityLifecycleKey.value;
    if (!lifecycle || !previewUrl.value) {
      return false;
    }
    if (previewResourceRetryLifecycle !== lifecycle) {
      resetPreviewResourceRecovery(lifecycle);
    }
    const resourceKind = String(message?.kind || "resource").trim() || "resource";
    const resourceUrl = String(message?.href || "").trim();
    const willRetry = previewResourceRetryCount < PREVIEW_RESOURCE_RETRY_LIMIT;
    previewDebugLog("resource.failed", { resourceKind, resourceUrl,
      retryCount: previewResourceRetryCount, willRetry });
    if (message.recover === false || previewResourceRetryTimer !== null) return false;
    const notice = willRetry
      ? "Preview could not load an application resource. Retrying automatically…"
      : "Preview could not load an application resource after retrying. Use Reload preview to try again.";
    showPreviewResourceNotice(notice);
    console.error(`[Vibe64 preview] ${notice}`, {
      resourceKind,
      resourceUrl
    });
    if (!willRetry) {
      return false;
    }

    previewResourceRetryCount += 1;
    const failedFrameRequestId = previewFrameRequestId.value;
    previewResourceRetryTimer = setTimeout(() => {
      previewResourceRetryTimer = null;
      if (
        previewResourceRetryLifecycle !== previewIdentityLifecycleKey.value ||
        failedFrameRequestId !== previewFrameRequestId.value
      ) {
        previewDebugLog("resource.retry.skipped");
        return;
      }
      previewDebugLog("resource.retry");
      const reloaded = requestPreviewFrame({
        force: true,
        reason: "resource-load-retry"
      });
      if (!reloaded) {
        previewDebugLog("resource.retry.unavailable");
        const failureNotice = "Preview could not be reloaded automatically. Use Reload preview to try again.";
        showPreviewResourceNotice(failureNotice);
        console.error(`[Vibe64 preview] ${failureNotice}`);
      }
    }, PREVIEW_RESOURCE_RETRY_DELAY_MS);
    return true;
  }

  function suspendPreview() {
    rememberPreviewIdentityForResume();
    previewSuspended.value = true;
    resetPreviewResourceRecovery(previewIdentityLifecycleKey.value);
    clearPreviewFrame("suspended");
    completePreviewIdentityTransition();
  }

  async function resumePreview() {
    const frameRequestId = previewFrameRequestId.value;
    const project = projectSlug.value;
    const sessionId = props.session?.sessionId;
    await refreshOutputs();
    await nextTick();
    if (project !== projectSlug.value || sessionId !== props.session?.sessionId ||
        frameRequestId !== previewFrameRequestId.value || !previewSuspended.value) return false;
    previewSuspended.value = false;
    allowResumedPreviewIdentity();
    return requestPreviewFrame({ force: true, reason: "resumed" });
  }

  async function reloadPreview() {
    if (previewSuspended.value) return false;
    resetPreviewResourceRecovery(previewIdentityLifecycleKey.value);
    const requestIdBeforeRefresh = previewFrameRequestId.value;
    await refreshOutputs();
    await nextTick();
    const reloaded = previewFrameRequestId.value !== requestIdBeforeRefresh || await requestPreviewFrame({
      force: true,
      reason: "manual-reload"
    });
    if (reloaded) reportActivity("preview-reloaded", { projectSlug: projectSlug.value, sessionId: props.session?.sessionId });
    return reloaded;
  }

  /** How many times the current page was reloaded after a failed resource. */
  function currentPreviewResourceRetryCount() {
    return previewResourceRetryCount;
  }

  // A new Preview lifecycle starts its resource retries over.
  watch(previewIdentityLifecycleKey, (lifecycle, previousLifecycle) => {
    if (lifecycle === previousLifecycle) {
      return;
    }
    resetPreviewResourceRecovery(lifecycle);
  }, {
    flush: "sync",
    immediate: true
  });

  onBeforeUnmount(cancelPreviewResourceRetry);

  return {
    cancelPreviewResourceRetry,
    currentPreviewResourceRetryCount,
    handlePreviewResourceFailure,
    previewResourceNoticeText,
    previewResourceNoticeVisible,
    reloadPreview,
    resumePreview,
    suspendPreview
  };
}

export {
  useVibe64PreviewReload
};
