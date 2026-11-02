import { computed, ref, watch } from "vue";
import {
  defaultPreviewIdentitySelection,
  normalizeConfiguredPreviewIdentities,
  previewIdentityFromExchange,
  previewIdentityLabelText,
  previewIdentityTitleText
} from "@/lib/vibe64PreviewIdentity.js";

/**
 * The application identity the embedded Preview is signed in as. Switching
 * asks the server for a grant, exchanges it in the page through the bridge and
 * reloads the frame; each new Preview lifecycle starts in the default identity
 * once its page is ready.
 * @param {{
 *   frame: ReturnType<typeof import("./useVibe64PreviewFrame.js").useVibe64PreviewFrame>,
 *   outputs: ReturnType<typeof import("./useVibe64OutputControls.js").useVibe64OutputControls>,
 *   props: { embeddedPreview?: boolean }
 * }} options
 */
function useVibe64PreviewIdentity({ frame, outputs, props }) {
  const {
    previewIdentity: previewIdentityCapability,
    requestPreviewIdentityGrant
  } = outputs;
  const {
    cancelPreviewBridgeRequests,
    orientation,
    previewFrameLoaded,
    previewFrameRequestId,
    previewIdentityLifecycleKey,
    previewSuspended,
    requestPreviewFrame,
    requestPreviewIdentityExchange
  } = frame;
  const previewIdentityBusy = ref(false);
  const previewIdentityCurrent = ref(null);
  const previewIdentityError = ref("");
  const previewIdentityRequested = ref(null);
  let previewIdentityAutomaticAttempt = "";
  let previewIdentityResumeSelection = null;
  let previewIdentityLifecycle = "";
  let previewIdentityReloadRequestId = 0;
  const previewIdentityAvailable = computed(() => Boolean(
    props.embeddedPreview &&
    previewIdentityCapability.value?.available === true
  ));
  const previewIdentityConfigured = computed(() => normalizeConfiguredPreviewIdentities(
    previewIdentityCapability.value?.identities
  ));
  const previewIdentityLabel = computed(() => previewIdentityLabelText({
    busy: previewIdentityBusy.value,
    identity: previewIdentityCurrent.value
  }));
  const previewIdentityTitle = computed(() => previewIdentityTitleText({
    busy: previewIdentityBusy.value,
    error: previewIdentityError.value,
    identity: previewIdentityCurrent.value
  }));
  const previewIdentitySelectionDisabled = computed(() => Boolean(
    previewIdentityBusy.value || !previewFrameLoaded.value
  ));

  function completePreviewIdentityTransition() {
    previewIdentityBusy.value = false;
    previewIdentityRequested.value = null;
    previewIdentityReloadRequestId = 0;
  }

  function resetPreviewIdentityState() {
    completePreviewIdentityTransition();
    previewIdentityCurrent.value = null;
    previewIdentityError.value = "";
  }

  function reloadPreviewForIdentity(reason = "identity-changed") {
    const requested = requestPreviewFrame({
      force: true,
      reason
    });
    if (!requested) {
      completePreviewIdentityTransition();
      return false;
    }
    previewIdentityReloadRequestId = previewFrameRequestId.value;
    return true;
  }

  async function selectPreviewIdentity(selection = {}) {
    if (
      previewIdentitySelectionDisabled.value ||
      !previewIdentityAvailable.value
    ) {
      return false;
    }
    const frameRequestId = previewFrameRequestId.value;
    const current = () => !previewSuspended.value && frameRequestId === previewFrameRequestId.value;
    const mode = String(selection.mode || "identity").trim();
    const identityName = String(selection.identityName || "").trim().toLowerCase();
    const requested = mode === "identity"
      ? {
          identityName,
          mode
        }
      : {
          mode: "guest"
        };
    previewIdentityBusy.value = true;
    previewIdentityError.value = "";
    previewIdentityRequested.value = requested;
    let pendingSelection = previewIdentityRequested.value;
    function retireSelection() {
      if (previewIdentityRequested.value === pendingSelection) completePreviewIdentityTransition();
      return false;
    }
    try {
      const grantResult = await requestPreviewIdentityGrant(requested);
      if (!current()) return retireSelection();
      const grant = String(grantResult?.grant || "").trim();
      if (!grant || grantResult?.ok === false) {
        throw new Error(
          String(grantResult?.error || "Vibe64 could not authorize the preview identity exchange.")
        );
      }
      const requestedIdentity = grantResult.requestedIdentity || requested;
      previewIdentityRequested.value = requestedIdentity;
      pendingSelection = previewIdentityRequested.value;
      const exchangeResult = await requestPreviewIdentityExchange(grant);
      if (!current()) return retireSelection();
      previewIdentityCurrent.value = previewIdentityFromExchange(exchangeResult, requestedIdentity);
      reloadPreviewForIdentity("identity-selected");
      return true;
    } catch (error) {
      if (!current()) return retireSelection();
      const message = String(error?.message || error || "Preview identity exchange failed.");
      previewIdentityError.value = message;
      if (error?.signedOut === true) {
        previewIdentityCurrent.value = {
          mode: "guest"
        };
        previewIdentityRequested.value = {
          mode: "guest"
        };
        reloadPreviewForIdentity("identity-exchange-signed-out");
      } else {
        completePreviewIdentityTransition();
      }
      return false;
    }
  }

  function selectPreviewConfiguredIdentity(identity = {}) {
    const identityName = String(identity?.name || "").trim();
    if (!identityName) {
      return false;
    }
    return selectPreviewIdentity({
      identityName,
      mode: "identity"
    });
  }

  function selectPreviewGuest() {
    return selectPreviewIdentity({
      mode: "guest"
    });
  }

  function beginDefaultPreviewIdentity() {
    const lifecycle = previewIdentityLifecycleKey.value;
    if (
      !lifecycle ||
      !previewIdentityAvailable.value ||
      previewIdentityAutomaticAttempt === lifecycle
    ) {
      return false;
    }
    previewIdentityAutomaticAttempt = lifecycle;
    const selection = previewIdentityResumeSelection || defaultPreviewIdentitySelection({
      capability: previewIdentityCapability.value
    });
    previewIdentityResumeSelection = null;
    void selectPreviewIdentity(selection);
    return true;
  }

  /** An identity reload in flight follows the frame to its newest request. */
  function followIdentityReload(frameRequestId) {
    if (previewIdentityReloadRequestId > 0) {
      previewIdentityReloadRequestId = frameRequestId;
    }
  }

  /**
   * A frame request's page is ready: it completes the identity reload that
   * requested it, or else the page starts in the default identity.
   */
  function handlePreviewFrameReady(frameRequestId) {
    if (frameRequestId === previewIdentityReloadRequestId) {
      completePreviewIdentityTransition();
      return;
    }
    beginDefaultPreviewIdentity();
  }

  /** A suspended Preview resumes in the identity it was switching to. */
  function rememberPreviewIdentityForResume() {
    previewIdentityResumeSelection = previewIdentityRequested.value;
  }

  /** A resumed Preview may select its remembered identity again. */
  function allowResumedPreviewIdentity() {
    if (previewIdentityResumeSelection) previewIdentityAutomaticAttempt = "";
  }

  watch(previewIdentityLifecycleKey, (lifecycle) => {
    if (lifecycle === previewIdentityLifecycle) {
      return;
    }
    orientation.close();
    previewIdentityLifecycle = lifecycle;
    previewIdentityAutomaticAttempt = "";
    previewIdentityResumeSelection = null;
    resetPreviewIdentityState();
    cancelPreviewBridgeRequests("The active application preview changed.");
  }, {
    flush: "sync",
    immediate: true
  });

  watch(previewIdentityAvailable, (available) => {
    if (available && previewFrameLoaded.value) {
      beginDefaultPreviewIdentity();
    }
  });

  return {
    allowResumedPreviewIdentity,
    completePreviewIdentityTransition,
    followIdentityReload,
    handlePreviewFrameReady,
    previewIdentityAvailable,
    previewIdentityBusy,
    previewIdentityConfigured,
    previewIdentityCurrent,
    previewIdentityError,
    previewIdentityLabel,
    previewIdentityRequested,
    previewIdentitySelectionDisabled,
    previewIdentityTitle,
    rememberPreviewIdentityForResume,
    selectPreviewConfiguredIdentity,
    selectPreviewGuest
  };
}

export {
  useVibe64PreviewIdentity
};
