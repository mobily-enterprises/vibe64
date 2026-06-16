import {
  VIBE64_ACCOUNTS_CHANGED_EVENT
} from "@/lib/studioGateApi.js";
import {
  vibe64SessionDebugError,
  vibe64SessionDebugLog
} from "@/lib/vibe64SessionDebugLog.js";

const VIBE64_CAPABILITIES_QUERY_LISTENER = "local.main.vibe64-capabilities-query-listener";
const VIBE64_LIVE_QUERY_RECOVERY_LISTENER = "local.main.vibe64-live-query-recovery-listener";
const DEFAULT_INVALIDATION_DEBUG_PREFIX = "client.capabilities.invalidate";
const IN_PROGRESS_ACCOUNT_STATUSES = new Set(["authenticating"]);
const FINAL_ACCOUNT_STATUSES = new Set(["connected", "not_connected", "reconnect_required"]);

function isVibe64CapabilitiesQuery(query = {}) {
  const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
  return queryKey[0] === "vibe64" && queryKey.at(-1) === "capabilities";
}

function isVibe64LiveQuery(query = {}) {
  const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
  return queryKey[0] === "vibe64";
}

function accountRealtimePayloadDebugSummary(payload = {}) {
  return {
    accountId: String(payload?.accountId || ""),
    authSessionId: String(payload?.authSessionId || ""),
    connected: typeof payload?.connected === "boolean" ? payload.connected : null,
    reason: String(payload?.reason || ""),
    status: String(payload?.status || "")
  };
}

function capabilitiesRefetchTypeForAccountPayload(payload = {}) {
  const status = String(payload?.status || "").trim();
  if (IN_PROGRESS_ACCOUNT_STATUSES.has(status)) {
    return "active";
  }
  if (FINAL_ACCOUNT_STATUSES.has(status)) {
    return "all";
  }
  return typeof payload?.connected === "boolean" ? "all" : "active";
}

function invalidateVibe64CapabilitiesQueryClient(queryClient, {
  debugEventPrefix = DEFAULT_INVALIDATION_DEBUG_PREFIX,
  event = VIBE64_ACCOUNTS_CHANGED_EVENT,
  payload = {}
} = {}) {
  const debugPayload = accountRealtimePayloadDebugSummary(payload);
  const refetchType = capabilitiesRefetchTypeForAccountPayload(payload);
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    vibe64SessionDebugLog(`${debugEventPrefix}.skipped`, {
      payload: debugPayload,
      refetchType,
      reason: "invalid_query_client"
    });
    return null;
  }

  let inspectedQueries = 0;
  let matchedQueries = 0;
  vibe64SessionDebugLog(`${debugEventPrefix}.start`, {
    payload: debugPayload,
    refetchType,
    sourceEvent: event
  });

  try {
    const result = queryClient.invalidateQueries({
      predicate(query) {
        inspectedQueries += 1;
        const matched = isVibe64CapabilitiesQuery(query);
        if (matched) {
          matchedQueries += 1;
        }
        return matched;
      },
      refetchType
    });
    return Promise.resolve(result)
      .then((resolved) => {
        vibe64SessionDebugLog(`${debugEventPrefix}.done`, {
          inspectedQueries,
          matchedQueries,
          payload: debugPayload,
          refetchType,
          sourceEvent: event
        });
        return resolved;
      })
      .catch((error) => {
        vibe64SessionDebugLog(`${debugEventPrefix}.error`, {
          error: vibe64SessionDebugError(error),
          inspectedQueries,
          matchedQueries,
          payload: debugPayload,
          refetchType,
          sourceEvent: event
        });
        throw error;
      });
  } catch (error) {
    vibe64SessionDebugLog(`${debugEventPrefix}.error`, {
      error: vibe64SessionDebugError(error),
      inspectedQueries,
      matchedQueries,
      payload: debugPayload,
      refetchType,
      sourceEvent: event
    });
    throw error;
  }
}

function invalidateVibe64CapabilitiesQueries(app, {
  debugEventPrefix = "client.realtime.capabilities.invalidate",
  event = VIBE64_ACCOUNTS_CHANGED_EVENT,
  payload = {}
} = {}) {
  const debugPayload = accountRealtimePayloadDebugSummary(payload);
  const refetchType = capabilitiesRefetchTypeForAccountPayload(payload);
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    vibe64SessionDebugLog(`${debugEventPrefix}.skipped`, {
      payload: debugPayload,
      refetchType,
      reason: "missing_app"
    });
    return null;
  }
  if (!app.has("jskit.client.query-client")) {
    vibe64SessionDebugLog(`${debugEventPrefix}.skipped`, {
      payload: debugPayload,
      refetchType,
      reason: "missing_query_client"
    });
    return null;
  }

  return invalidateVibe64CapabilitiesQueryClient(app.make("jskit.client.query-client"), {
    debugEventPrefix,
    event,
    payload
  });
}

function invalidateVibe64LiveQueries(app, {
  debugEventPrefix = "client.realtime.live.invalidate",
  event = "connect",
  payload = {}
} = {}) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    vibe64SessionDebugLog(`${debugEventPrefix}.skipped`, {
      reason: "missing_app",
      sourceEvent: event
    });
    return null;
  }
  if (!app.has("jskit.client.query-client")) {
    vibe64SessionDebugLog(`${debugEventPrefix}.skipped`, {
      reason: "missing_query_client",
      sourceEvent: event
    });
    return null;
  }

  const queryClient = app.make("jskit.client.query-client");
  if (!queryClient || typeof queryClient.invalidateQueries !== "function") {
    vibe64SessionDebugLog(`${debugEventPrefix}.skipped`, {
      reason: "invalid_query_client",
      sourceEvent: event
    });
    return null;
  }

  let inspectedQueries = 0;
  let matchedQueries = 0;
  vibe64SessionDebugLog(`${debugEventPrefix}.start`, {
    payloadScope: payload?.scope || null,
    sourceEvent: event
  });

  try {
    const result = queryClient.invalidateQueries({
      predicate(query) {
        inspectedQueries += 1;
        const matched = isVibe64LiveQuery(query);
        if (matched) {
          matchedQueries += 1;
        }
        return matched;
      },
      refetchType: "active"
    });
    return Promise.resolve(result)
      .then((resolved) => {
        vibe64SessionDebugLog(`${debugEventPrefix}.done`, {
          inspectedQueries,
          matchedQueries,
          sourceEvent: event
        });
        return resolved;
      })
      .catch((error) => {
        vibe64SessionDebugLog(`${debugEventPrefix}.error`, {
          error: vibe64SessionDebugError(error),
          inspectedQueries,
          matchedQueries,
          sourceEvent: event
        });
        throw error;
      });
  } catch (error) {
    vibe64SessionDebugLog(`${debugEventPrefix}.error`, {
      error: vibe64SessionDebugError(error),
      inspectedQueries,
      matchedQueries,
      sourceEvent: event
    });
    throw error;
  }
}

export {
  VIBE64_CAPABILITIES_QUERY_LISTENER,
  VIBE64_LIVE_QUERY_RECOVERY_LISTENER,
  accountRealtimePayloadDebugSummary,
  capabilitiesRefetchTypeForAccountPayload,
  invalidateVibe64CapabilitiesQueries,
  invalidateVibe64CapabilitiesQueryClient,
  invalidateVibe64LiveQueries,
  isVibe64CapabilitiesQuery,
  isVibe64LiveQuery
};
