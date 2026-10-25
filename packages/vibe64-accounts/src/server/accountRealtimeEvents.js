import { createEntityChangedActionEvent } from "@jskit-ai/kernel/server/actions";

import {
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
  VIBE64_CONNECTIONS_CHANGED_EVENT
} from "../shared/accountEvents.js";
const VIBE64_ACCOUNT_EVENT_ENTITY = "account";
const VIBE64_ACCOUNT_EVENT_SOURCE = "vibe64";
const VIBE64_ACCOUNT_REALTIME_AUDIENCE = "all_clients";

function normalizeAccountValue(value = "") {
  return String(value || "").trim();
}

function plainObject(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : null;
}

// Every account, connection and auth-session change is a global
// entity.changed event; only the actor, entity and realtime parts differ.
function publishGlobalEntityChanged(events, {
  actorId,
  audience = VIBE64_ACCOUNT_REALTIME_AUDIENCE,
  entity,
  entityId,
  event,
  operation,
  payload
}) {
  return events.publish({
    ...(actorId === undefined ? {} : { actorId }),
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity,
    operation: normalizeAccountValue(operation) || "updated",
    entityId,
    scope: {
      kind: "global",
      id: null
    },
    occurredAt: new Date().toISOString(),
    realtime: {
      event,
      audience,
      payload
    },
    type: "entity.changed"
  });
}

function accountIdFromResult(result = {}) {
  const source = plainObject(result) || {};
  const account = plainObject(source.account);
  return normalizeAccountValue(
    source.accountId ||
    account?.id ||
    (typeof source.account === "string" ? source.account : "") ||
    ""
  );
}

function accountIdFromInput(input = {}) {
  const source = plainObject(input) || {};
  return normalizeAccountValue(source.accountId || "");
}

function authSessionIdFromResult(result = {}) {
  const source = plainObject(result) || {};
  return normalizeAccountValue(source.id || source.sessionId || "");
}

function accountIdFromExecution({ input = {}, result = {} } = {}) {
  return accountIdFromResult(result) || accountIdFromInput(input) || "accounts";
}

function vibe64AccountsRealtimePayload({ input = {}, result = {} } = {}) {
  const accountId = accountIdFromResult(result) || accountIdFromInput(input);
  const source = plainObject(result) || {};
  return {
    ...(accountId ? { accountId } : {}),
    ...(typeof source.account?.connected === "boolean" ? { connected: source.account.connected } : {}),
    ...(authSessionIdFromResult(result) ? { authSessionId: authSessionIdFromResult(result) } : {}),
    ...(source.status ? { status: normalizeAccountValue(source.status) } : {})
  };
}

function vibe64ConnectionsRealtimePayload(execution = {}) {
  const payload = vibe64AccountsRealtimePayload(execution);
  return {
    ...payload,
    ...(payload.accountId ? { connectionId: payload.accountId } : {})
  };
}

function vibe64AccountAuthSessionRealtimePayload(session = {}) {
  const source = plainObject(session) || {};
  const accountId = normalizeAccountValue(source.account?.id || source.account || "");
  const sessionId = normalizeAccountValue(source.id || source.sessionId || "");
  return {
    ...(accountId ? { accountId } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(source.outputVersion ? { outputVersion: source.outputVersion } : {}),
    ...(source.status ? { status: normalizeAccountValue(source.status) } : {}),
    ...(source.terminalStatus ? { terminalStatus: normalizeAccountValue(source.terminalStatus) } : {})
  };
}

function authSessionRealtimeAudience({ context = {} } = {}) {
  return normalizeAccountValue(context?.actor?.id)
    ? "actor_user"
    : VIBE64_ACCOUNT_REALTIME_AUDIENCE;
}

function vibe64AccountsChangedActionEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: VIBE64_ACCOUNT_EVENT_ENTITY,
    operation,
    entityId: accountIdFromExecution,
    realtime: {
      event: VIBE64_ACCOUNTS_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: vibe64AccountsRealtimePayload
    }
  });
}

function vibe64AccountAuthSessionChangedActionEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: "account-auth-session",
    operation,
    entityId: ({ result = {} } = {}) => authSessionIdFromResult(result),
    realtime: {
      event: VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
      audience: authSessionRealtimeAudience,
      payload: ({ result = {} } = {}) => vibe64AccountAuthSessionRealtimePayload(result)
    }
  });
}

function vibe64ConnectionsChangedActionEvent({ operation = "updated" } = {}) {
  return createEntityChangedActionEvent({
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: "connection",
    operation,
    entityId: accountIdFromExecution,
    realtime: {
      event: VIBE64_CONNECTIONS_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: vibe64ConnectionsRealtimePayload
    }
  });
}

function createVibe64AccountsChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64AccountsChanged(accountId = "", {
    actorId = null,
    account = null,
    authSessionId = "",
    operation = "updated",
    reason = "",
    status = ""
  } = {}) {
    const normalizedAccountId = normalizeAccountValue(accountId) || accountIdFromResult({ account });
    if (!normalizedAccountId) {
      return null;
    }
    const result = {
      account: plainObject(account) || {
        id: normalizedAccountId
      },
      ...(authSessionId ? { id: authSessionId } : {}),
      ...(status || resultStatusFromAccount(account) ? { status: status || resultStatusFromAccount(account) } : {})
    };
    const realtimePayload = {
      ...vibe64AccountsRealtimePayload({
        input: {
          accountId: normalizedAccountId
        },
        result
      }),
      ...(reason ? { reason } : {})
    };

    const accountEvent = await publishGlobalEntityChanged(events, {
      actorId,
      entity: VIBE64_ACCOUNT_EVENT_ENTITY,
      entityId: normalizedAccountId,
      event: VIBE64_ACCOUNTS_CHANGED_EVENT,
      operation,
      payload: realtimePayload
    });
    await publishGlobalEntityChanged(events, {
      actorId,
      entity: "connection",
      entityId: normalizedAccountId,
      event: VIBE64_CONNECTIONS_CHANGED_EVENT,
      operation,
      payload: {
        ...realtimePayload,
        connectionId: normalizedAccountId
      }
    });
    return accountEvent;
  };
}

function createVibe64ConnectionsChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64ConnectionsChanged(connectionId = "", {
    connected,
    operation = "updated",
    reason = "",
    status = ""
  } = {}) {
    const normalizedConnectionId = normalizeAccountValue(connectionId);
    if (!normalizedConnectionId) {
      return null;
    }
    return publishGlobalEntityChanged(events, {
      entity: "connection",
      entityId: normalizedConnectionId,
      event: VIBE64_CONNECTIONS_CHANGED_EVENT,
      operation,
      payload: {
        connectionId: normalizedConnectionId,
        ...(typeof connected === "boolean" ? { connected } : {}),
        ...(reason ? { reason: normalizeAccountValue(reason) } : {}),
        ...(status ? { status: normalizeAccountValue(status) } : {})
      }
    });
  };
}

function createVibe64AccountAuthSessionChangedPublisher({ events = null } = {}) {
  if (!events || typeof events.publish !== "function") {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64AccountAuthSessionChanged(session = {}, {
    actorId = "",
    operation = "updated",
    reason = ""
  } = {}) {
    const payload = vibe64AccountAuthSessionRealtimePayload(session);
    const normalizedActorId = normalizeAccountValue(actorId);
    if (!payload.sessionId) {
      return null;
    }
    return publishGlobalEntityChanged(events, {
      actorId: normalizedActorId || null,
      audience: normalizedActorId ? "actor_user" : VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      entity: "account-auth-session",
      entityId: payload.sessionId,
      event: VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
      operation,
      payload: {
        ...payload,
        ...(reason ? { reason } : {})
      }
    });
  };
}

function resultStatusFromAccount(account = null) {
  return plainObject(account) ? normalizeAccountValue(account.status) : "";
}

export {
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  VIBE64_ACCOUNT_AUTH_SESSION_CHANGED_EVENT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  vibe64AccountAuthSessionChangedActionEvent,
  vibe64AccountsChangedActionEvent,
  vibe64ConnectionsChangedActionEvent,
  createVibe64AccountAuthSessionChangedPublisher,
  createVibe64AccountsChangedPublisher,
  createVibe64ConnectionsChangedPublisher
};
