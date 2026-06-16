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
const MAX_DEBUG_QUERY_ERRORS = 8;

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

function queryObserverCount(query = {}) {
  if (typeof query?.getObserversCount === "function") {
    const count = Number(query.getObserversCount());
    return Number.isFinite(count) ? count : 0;
  }
  if (Array.isArray(query?.observers)) {
    return query.observers.length;
  }
  return 0;
}

function queryIsActive(query = {}) {
  if (typeof query?.isActive === "function") {
    return Boolean(query.isActive());
  }
  return queryObserverCount(query) > 0;
}

function compactDebugQueryKey(queryKey = []) {
  if (!Array.isArray(queryKey)) {
    return [];
  }
  return queryKey.map((part) => {
    if (typeof part === "string") {
      return part.length > 80 ? `${part.slice(0, 77)}...` : part;
    }
    if (part === null || ["boolean", "number"].includes(typeof part)) {
      return part;
    }
    return "[object]";
  });
}

function queriesFromQueryClient(queryClient) {
  const queryCache =
    queryClient && typeof queryClient.getQueryCache === "function"
      ? queryClient.getQueryCache()
      : null;
  return queryCache && typeof queryCache.getAll === "function"
    ? queryCache.getAll()
    : [];
}

function vibe64QueryClientDebugSummary(queryClient) {
  const queries = queriesFromQueryClient(queryClient);
  const summary = {
    queryActive: 0,
    queryError: 0,
    queryFetching: 0,
    queryTotal: queries.length,
    vibe64Active: 0,
    vibe64Error: 0,
    vibe64ErrorQueries: [],
    vibe64Fetching: 0,
    vibe64Total: 0
  };

  for (const query of queries) {
    const queryKey = Array.isArray(query?.queryKey) ? query.queryKey : [];
    const state = query?.state && typeof query.state === "object" ? query.state : {};
    const active = queryIsActive(query);
    const fetching = String(state.fetchStatus || "").trim() === "fetching";
    const error = String(state.status || "").trim() === "error" || Boolean(state.error);
    if (active) {
      summary.queryActive += 1;
    }
    if (fetching) {
      summary.queryFetching += 1;
    }
    if (error) {
      summary.queryError += 1;
    }
    if (!isVibe64LiveQuery({ queryKey })) {
      continue;
    }
    summary.vibe64Total += 1;
    if (active) {
      summary.vibe64Active += 1;
    }
    if (fetching) {
      summary.vibe64Fetching += 1;
    }
    if (error) {
      summary.vibe64Error += 1;
      if (summary.vibe64ErrorQueries.length < MAX_DEBUG_QUERY_ERRORS) {
        summary.vibe64ErrorQueries.push({
          active,
          fetchStatus: String(state.fetchStatus || ""),
          observerCount: queryObserverCount(query),
          queryHash: String(query?.queryHash || ""),
          queryKey: compactDebugQueryKey(queryKey),
          status: String(state.status || "")
        });
      }
    }
  }

  return summary;
}

function countSocketCallbacks(value) {
  if (Array.isArray(value)) {
    return value.length;
  }
  return typeof value === "function" ? 1 : 0;
}

function normalizeSocketEventName(eventName = "") {
  return String(eventName || "").replace(/^\$/, "");
}

function socketDebugSummary(socket) {
  if (!socket || typeof socket !== "object") {
    return {
      socketPresent: false
    };
  }

  const listenerCounts = {};
  const callbacks = socket._callbacks && typeof socket._callbacks === "object"
    ? socket._callbacks
    : {};
  for (const [eventName, value] of Object.entries(callbacks).sort(([left], [right]) => left.localeCompare(right))) {
    listenerCounts[normalizeSocketEventName(eventName)] = countSocketCallbacks(value);
  }
  const listenerTotal = Object.values(listenerCounts).reduce((total, count) => total + count, 0);

  return {
    anyListenerCount: Array.isArray(socket._anyListeners) ? socket._anyListeners.length : 0,
    listenerCounts,
    listenerTotal,
    receiveBufferLength: Array.isArray(socket.receiveBuffer) ? socket.receiveBuffer.length : 0,
    sendBufferLength: Array.isArray(socket.sendBuffer) ? socket.sendBuffer.length : 0,
    socketConnected: Boolean(socket.connected),
    socketId: String(socket.id || ""),
    socketPresent: true
  };
}

function vibe64RealtimeSocketDebugSummary(app) {
  if (!app || typeof app.has !== "function" || typeof app.make !== "function") {
    return {
      socketPresent: false
    };
  }
  if (!app.has("runtime.realtime.client.socket")) {
    return {
      socketPresent: false
    };
  }
  try {
    return socketDebugSummary(app.make("runtime.realtime.client.socket"));
  } catch (error) {
    return {
      error: vibe64SessionDebugError(error),
      socketPresent: false
    };
  }
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
    querySummary: vibe64QueryClientDebugSummary(queryClient),
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
          querySummary: vibe64QueryClientDebugSummary(queryClient),
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
          querySummary: vibe64QueryClientDebugSummary(queryClient),
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
      querySummary: vibe64QueryClientDebugSummary(queryClient),
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
    querySummary: vibe64QueryClientDebugSummary(queryClient),
    realtimeSummary: vibe64RealtimeSocketDebugSummary(app),
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
          querySummary: vibe64QueryClientDebugSummary(queryClient),
          realtimeSummary: vibe64RealtimeSocketDebugSummary(app),
          sourceEvent: event
        });
        return resolved;
      })
      .catch((error) => {
        vibe64SessionDebugLog(`${debugEventPrefix}.error`, {
          error: vibe64SessionDebugError(error),
          inspectedQueries,
          matchedQueries,
          querySummary: vibe64QueryClientDebugSummary(queryClient),
          realtimeSummary: vibe64RealtimeSocketDebugSummary(app),
          sourceEvent: event
        });
        throw error;
      });
  } catch (error) {
    vibe64SessionDebugLog(`${debugEventPrefix}.error`, {
      error: vibe64SessionDebugError(error),
      inspectedQueries,
      matchedQueries,
      querySummary: vibe64QueryClientDebugSummary(queryClient),
      realtimeSummary: vibe64RealtimeSocketDebugSummary(app),
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
  isVibe64LiveQuery,
  vibe64QueryClientDebugSummary,
  vibe64RealtimeSocketDebugSummary
};
