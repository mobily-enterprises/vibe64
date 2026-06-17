import { registerRealtimeClientListener } from "@jskit-ai/realtime/client/listeners";
import {
  VIBE64_CONNECTIONS_CHANGED_EVENT
} from "/src/lib/studioGateApi.js";
import {
  vibe64SessionDebugLog
} from "/src/lib/vibe64SessionDebugLog.js";
import {
  VIBE64_CAPABILITIES_QUERY_LISTENER,
  VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
  connectionRealtimePayloadDebugSummary,
  invalidateVibe64CapabilitiesQueries,
  invalidateVibe64LiveQueries,
  isVibe64CapabilitiesQuery,
  isVibe64LiveQuery,
  vibe64QueryClientDebugSummary,
  vibe64RealtimeSocketDebugSummary
} from "/src/lib/vibe64CapabilitiesInvalidation.js";

function registerVibe64RealtimeListeners(app) {
  registerRealtimeClientListener(app, VIBE64_CAPABILITIES_QUERY_LISTENER, () => ({
    listenerId: VIBE64_CAPABILITIES_QUERY_LISTENER,
    event: VIBE64_CONNECTIONS_CHANGED_EVENT,
    handle({ app: runtimeApp, event, payload }) {
      vibe64SessionDebugLog("client.realtime.connections.changed.received", {
        sourceEvent: event,
        payload: connectionRealtimePayloadDebugSummary(payload)
      });
      return invalidateVibe64CapabilitiesQueries(runtimeApp, {
        event,
        payload
      });
    }
  }));
  registerRealtimeClientListener(app, VIBE64_LIVE_QUERY_RECOVERY_LISTENER, () => ({
    listenerId: VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
    event: "connect",
    handle({ app: runtimeApp, event, payload }) {
      vibe64SessionDebugLog("client.realtime.connected.recovery", {
        sourceEvent: event
      });
      return invalidateVibe64LiveQueries(runtimeApp, {
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
    emitConnectionChangedForCapabilities(payload = {}) {
      return invalidateVibe64CapabilitiesQueries(app, {
        event: VIBE64_CONNECTIONS_CHANGED_EVENT,
        payload
      });
    }
  };
}

export {
  VIBE64_CAPABILITIES_QUERY_LISTENER,
  VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
  invalidateVibe64CapabilitiesQueries,
  invalidateVibe64LiveQueries,
  isVibe64CapabilitiesQuery,
  isVibe64LiveQuery,
  registerVibe64RealtimeListeners,
  vibe64QueryClientDebugSummary,
  vibe64RealtimeSocketDebugSummary
};
