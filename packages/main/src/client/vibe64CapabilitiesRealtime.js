import { registerRealtimeClientListener } from "@jskit-ai/realtime/client/listeners";
import {
  VIBE64_ACCOUNTS_CHANGED_EVENT
} from "/src/lib/studioGateApi.js";
import {
  vibe64SessionDebugLog
} from "/src/lib/vibe64SessionDebugLog.js";
import {
  VIBE64_CAPABILITIES_QUERY_LISTENER,
  accountRealtimePayloadDebugSummary,
  invalidateVibe64CapabilitiesQueries,
  isVibe64CapabilitiesQuery
} from "/src/lib/vibe64CapabilitiesInvalidation.js";

function registerVibe64CapabilitiesRealtimeListener(app) {
  registerRealtimeClientListener(app, VIBE64_CAPABILITIES_QUERY_LISTENER, () => ({
    listenerId: VIBE64_CAPABILITIES_QUERY_LISTENER,
    event: VIBE64_ACCOUNTS_CHANGED_EVENT,
    handle({ app: runtimeApp, event, payload }) {
      vibe64SessionDebugLog("client.realtime.accounts.changed.received", {
        sourceEvent: event,
        payload: accountRealtimePayloadDebugSummary(payload)
      });
      return invalidateVibe64CapabilitiesQueries(runtimeApp, {
        event,
        payload
      });
    }
  }));
  registerVibe64CapabilitiesPlaywrightHook(app);
}

function registerVibe64CapabilitiesPlaywrightHook(app) {
  if (import.meta.env?.DEV !== true || typeof window === "undefined") {
    return;
  }
  const params = new URLSearchParams(String(window.location?.search || ""));
  if (!params.has("vibe64_e2e")) {
    return;
  }

  const target = window;
  target.__vibe64E2e = {
    ...(target.__vibe64E2e || {}),
    emitAccountChangedForCapabilities(payload = {}) {
      return invalidateVibe64CapabilitiesQueries(app, {
        event: VIBE64_ACCOUNTS_CHANGED_EVENT,
        payload
      });
    }
  };
}

export {
  VIBE64_CAPABILITIES_QUERY_LISTENER,
  invalidateVibe64CapabilitiesQueries,
  isVibe64CapabilitiesQuery,
  registerVibe64CapabilitiesRealtimeListener
};
