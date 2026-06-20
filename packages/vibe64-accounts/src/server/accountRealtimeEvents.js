const VIBE64_ACCOUNTS_CHANGED_EVENT = "vibe64.accounts.changed";
const VIBE64_CONNECTIONS_CHANGED_EVENT = "vibe64.connections.changed";
const VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT = "vibe64.managed-app-auth.changed";
const VIBE64_ACCOUNT_EVENT_ENTITY = "account";
const VIBE64_ACCOUNT_EVENT_SOURCE = "vibe64";
const VIBE64_ACCOUNT_REALTIME_AUDIENCE = "all_clients";

function normalizeAccountValue(value = "") {
  return String(value || "").trim();
}

function accountIdFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  const account = source.account && typeof source.account === "object" && !Array.isArray(source.account)
    ? source.account
    : null;
  return normalizeAccountValue(
    source.accountId ||
    account?.id ||
    (typeof source.account === "string" ? source.account : "") ||
    ""
  );
}

function accountIdFromInput(input = {}) {
  const source = input && typeof input === "object" && !Array.isArray(input)
    ? input
    : {};
  return normalizeAccountValue(source.accountId || "");
}

function authSessionIdFromResult(result = {}) {
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return normalizeAccountValue(source.id || source.sessionId || "");
}

function accountIdFromServiceEvent({ result = {}, args = [] } = {}) {
  return accountIdFromResult(result) || accountIdFromInput(args?.[0]) || "accounts";
}

function vibe64AccountsRealtimePayload({ result = {}, args = [] } = {}) {
  const accountId = accountIdFromResult(result) || accountIdFromInput(args?.[0]);
  const source = result && typeof result === "object" && !Array.isArray(result)
    ? result
    : {};
  return {
    ...(accountId ? { accountId } : {}),
    ...(typeof source.account?.connected === "boolean" ? { connected: source.account.connected } : {}),
    ...(authSessionIdFromResult(result) ? { authSessionId: authSessionIdFromResult(result) } : {}),
    ...(source.status ? { status: normalizeAccountValue(source.status) } : {})
  };
}

function vibe64ConnectionsRealtimePayload(options = {}) {
  const payload = vibe64AccountsRealtimePayload(options);
  return {
    ...payload,
    ...(payload.accountId ? { connectionId: payload.accountId } : {})
  };
}

function vibe64AccountsChangedServiceEvent({
  operation = "updated"
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: VIBE64_ACCOUNT_EVENT_ENTITY,
    operation,
    entityId: accountIdFromServiceEvent,
    realtime: Object.freeze({
      event: VIBE64_ACCOUNTS_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: vibe64AccountsRealtimePayload
    })
  });
}

function vibe64ConnectionsChangedServiceEvent({
  operation = "updated"
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: "connection",
    operation,
    entityId: accountIdFromServiceEvent,
    realtime: Object.freeze({
      event: VIBE64_CONNECTIONS_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: vibe64ConnectionsRealtimePayload
    })
  });
}

function vibe64ManagedAppAuthChangedServiceEvent({
  operation = "updated"
} = {}) {
  return Object.freeze({
    type: "entity.changed",
    source: VIBE64_ACCOUNT_EVENT_SOURCE,
    entity: "managed-app-auth",
    operation,
    entityId: "managed-app-auth",
    realtime: Object.freeze({
      event: VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT,
      audience: VIBE64_ACCOUNT_REALTIME_AUDIENCE,
      payload: ({ result = {} } = {}) => ({
        ready: result?.ready === true,
        tokenPresent: result?.tokenPresent === true
      })
    })
  });
}

function createVibe64AccountsChangedPublisher({
  domainEvents = null,
  methodName = "",
  serviceToken = ""
} = {}) {
  const normalizedServiceToken = normalizeAccountValue(serviceToken);
  const normalizedMethodName = normalizeAccountValue(methodName);
  if (!domainEvents || typeof domainEvents.publish !== "function" || !normalizedServiceToken || !normalizedMethodName) {
    return async function publishNoop() {
      return null;
    };
  }

  return async function publishVibe64AccountsChanged(accountId = "", {
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
      account: account && typeof account === "object" && !Array.isArray(account)
        ? account
        : {
            id: normalizedAccountId
          },
      ...(authSessionId ? { id: authSessionId } : {}),
      ...(status || resultStatusFromAccount(account) ? { status: status || resultStatusFromAccount(account) } : {})
    };
    const realtimePayload = {
      ...vibe64AccountsRealtimePayload({
        args: [{
          accountId: normalizedAccountId
        }],
        result
      }),
      ...(reason ? { reason } : {})
    };

    const accountEvent = await domainEvents.publish({
      source: VIBE64_ACCOUNT_EVENT_SOURCE,
      entity: VIBE64_ACCOUNT_EVENT_ENTITY,
      operation: normalizeAccountValue(operation) || "updated",
      entityId: normalizedAccountId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      meta: {
        service: {
          token: normalizedServiceToken,
          method: normalizedMethodName
        },
        realtime: {
          event: VIBE64_ACCOUNTS_CHANGED_EVENT,
          payload: realtimePayload
        }
      }
    });
    await domainEvents.publish({
      source: VIBE64_ACCOUNT_EVENT_SOURCE,
      entity: "connection",
      operation: normalizeAccountValue(operation) || "updated",
      entityId: normalizedAccountId,
      scope: {
        kind: "global",
        id: null
      },
      occurredAt: new Date().toISOString(),
      meta: {
        service: {
          token: normalizedServiceToken,
          method: normalizedMethodName
        },
        realtime: {
          event: VIBE64_CONNECTIONS_CHANGED_EVENT,
          payload: {
            ...realtimePayload,
            connectionId: normalizedAccountId
          }
        }
      }
    });
    return accountEvent;
  };
}

function resultStatusFromAccount(account = null) {
  return account && typeof account === "object" && !Array.isArray(account)
    ? normalizeAccountValue(account.status)
    : "";
}

export {
  VIBE64_ACCOUNTS_CHANGED_EVENT,
  VIBE64_CONNECTIONS_CHANGED_EVENT,
  VIBE64_MANAGED_APP_AUTH_CHANGED_EVENT,
  vibe64AccountsChangedServiceEvent,
  vibe64ConnectionsChangedServiceEvent,
  vibe64ManagedAppAuthChangedServiceEvent,
  createVibe64AccountsChangedPublisher
};
