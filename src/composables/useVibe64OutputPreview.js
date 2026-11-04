import { computed, watch } from "vue";
import { isRecord } from "@jskit-ai/kernel/shared/support/normalize";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { previewDiagnosticUrl } from "@local/vibe64-terminals/shared/launchPreviewProtocol";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64PreviewIdentityPath,
  vibe64SessionPath,
  vibe64SessionPreviewStatePath
} from "@/lib/vibe64SessionRequestConfig.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";
import { browserCanOpenTarget } from "@/lib/vibe64LaunchPreviewDestination.js";
import { createLaunchBrowserOpener } from "@/lib/vibe64LaunchBrowserWindow.js";
import {
  launchPreviewRequiresProxy,
  launchPreviewTestNotice
} from "@/lib/vibe64LaunchPreview.js";

/**
 * The running output's Preview: the addresses it can be opened at, whether
 * its proxy address is still pending, its signed-in identity, and what the
 * editor reports back about it (its page and its diagnostics).
 * @param {{
 *   outputs: import("@/types.js").Vibe64OutputStatus,
 *   outputTerminal: import("@/types.js").Vibe64OutputTerminal,
 *   projectSlug: import("vue").Ref<string>
 * }} options
 */
function useVibe64OutputPreview({ outputs, outputTerminal, projectSlug }) {
  const {
    previewHref,
    previewMessage,
    previewRecovery,
    previewState,
    previewTarget,
    previewTargetHref,
    selectedSession,
    sessionId,
    sessionsApiPath,
    status
  } = outputs;
  const {
    activeOutputTarget,
    activeTerminal,
    terminal,
    terminalIsRunning,
    terminalLaunchReady
  } = outputTerminal;
  const { terminalMetadata } = terminal;

  const selectPreviewIdentityCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64PreviewIdentityPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      ...(context.identityName ? { identityName: context.identityName } : {}),
      mode: context.mode
    }),
    fallbackRunError: "Preview identity could not be selected.",
    messages: {
      error: "Preview identity could not be selected."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.preview-identity.select",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "POST"
  });

  const previewIdentity = computed(() => {
    const value = status.value.previewIdentity;
    return isRecord(value)
      ? value
      : {
          available: false,
          defaultMode: "guest",
          disabledReason: "",
          identities: []
        };
  });
  const previewTestNotice = computed(() => launchPreviewTestNotice(status.value, activeOutputTarget.value));
  // The ready Preview's own action: the app's address and the proxied one.
  const readyPreviewAction = computed(() => {
    const targetHref = previewTargetHref.value || String(previewTarget.value?.targetHref || "").trim();
    const iframeHref = previewHref.value || String(previewTarget.value?.href || "").trim();
    return iframeHref && targetHref
      ? {
          href: targetHref,
          kind: previewTarget.value?.kind || "url",
          label: previewTarget.value?.label || "Preview",
          previewHref: iframeHref
        }
      : null;
  });
  const launchActions = computed(() => {
    const actions = terminalMetadata.value.actions || activeTerminal.value?.metadata?.actions || [];
    const preview = readyPreviewAction.value;
    const browserActions = Array.isArray(actions) ? actions.filter((action) => browserCanOpenTarget(action)) : [];
    if (!preview) {
      return browserActions;
    }
    if (browserActions.length < 1) {
      return [preview];
    }
    return browserActions.map((action) => {
      if (String(action.href || "") !== preview.href) {
        return action;
      }
      return {
        ...action,
        previewHref: preview.previewHref
      };
    });
  });
  const launchBrowser = createLaunchBrowserOpener();
  watch(readyPreviewAction, (action) => launchBrowser.showReady(action));
  watch(sessionId, () => launchBrowser.abandon());
  const terminalPreviewRequiresProxy = computed(() => launchPreviewRequiresProxy({
    ...(activeTerminal.value?.metadata || {}),
    ...(terminalMetadata.value || {})
  }));
  const previewTargetDisabledReason = computed(() => (
    !["ready", "stale"].includes(previewState.value)
      ? previewMessage.value
      : ""
  ));
  const previewTargetRecovery = computed(() => previewRecovery.value);
  const terminalPreviewProxyPending = computed(() => Boolean(
    terminalPreviewRequiresProxy.value &&
    terminalLaunchReady.value &&
    terminalIsRunning.value &&
    !previewHref.value
  ));

  async function publishPreviewDiagnostic(record) {
    if (!sessionId.value || !projectSlug.value) return false;
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPath(sessionsApiPath.value, sessionId.value, "/preview-diagnostics"),
        { method: "POST", body: { ...record, enabled: true,
          frameUrl: previewDiagnosticUrl(record.frameUrl), resourceUrl: previewDiagnosticUrl(record.resourceUrl) } }
      );
      return result?.recorded === true;
    } catch { return false; } // Diagnostic delivery must never trigger Preview recovery.
  }

  async function publishPreviewState(previewState = {}) {
    const currentSessionId = sessionId.value;
    const currentProjectSlug = projectSlug.value;
    if (!currentSessionId || !currentProjectSlug || !String(previewState.route || "").trim()) {
      return false;
    }
    try {
      const result = await getHttpWebClient().request(
        vibe64SessionPreviewStatePath(sessionsApiPath.value, currentSessionId),
        {
          body: vibe64RealtimeOriginPayload({
            projectSlug: currentProjectSlug,
            route: String(previewState.route || "").trim(),
            title: String(previewState.title || "").trim()
          }),
          method: "POST"
        }
      );
      return result?.ok !== false;
    } catch (error) {
      vibe64SessionDebugLog("client.launchPreview.state.publish.error", {
        error: vibe64SessionDebugError(error),
        route: String(previewState.route || "").trim(),
        sessionId: currentSessionId
      });
      return false;
    }
  }

  function requestPreviewIdentityGrant({
    identityName = "",
    mode = "identity"
  } = {}) {
    if (!sessionId.value || previewIdentity.value.available !== true) {
      throw new Error(
        previewIdentity.value.disabledReason || "This preview does not support application identity switching."
      );
    }
    const normalizedIdentityName = String(identityName || "").trim();
    return selectPreviewIdentityCommand.run({
      ...(normalizedIdentityName ? { identityName: normalizedIdentityName } : {}),
      mode: String(mode || "identity").trim(),
      sessionId: sessionId.value
    });
  }

  function openAction(action = {}) {
    const opened = launchBrowser.open(action, selectedSession.value, projectSlug.value);
    // An action this editor can't reach while the Preview is already ready
    // goes straight on to the Preview's own address.
    return launchBrowser.showReady(readyPreviewAction.value) || opened;
  }

  return {
    launchActions,
    openAction,
    previewIdentity,
    previewTargetDisabledReason,
    previewTargetRecovery,
    previewTestNotice,
    publishPreviewDiagnostic,
    publishPreviewState,
    requestPreviewIdentityGrant,
    terminalPreviewProxyPending,
    terminalPreviewRequiresProxy
  };
}

export {
  useVibe64OutputPreview
};
