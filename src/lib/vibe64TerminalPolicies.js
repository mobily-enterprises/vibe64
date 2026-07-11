function normalizePolicyActions(actions = []) {
  return (Array.isArray(actions) ? actions : [actions])
    .map((action) => typeof action === "string" ? { type: action } : action)
    .filter((action) => action && typeof action === "object" && String(action.type || ""));
}

function normalizePolicies(policies = []) {
  return (Array.isArray(policies) ? policies : [])
    .map((policy, index) => ({
      ...policy,
      actions: normalizePolicyActions(policy.actions || policy.action),
      id: String(policy.id || `policy-${index + 1}`),
      on: Array.isArray(policy.on) ? policy.on.map(String) : [String(policy.on || "")]
    }))
    .filter((policy) => policy.on.some(Boolean) && policy.actions.length > 0);
}

function createTerminalPolicyEngine({
  actions = {},
  currentSessionId = () => "",
  policies = []
} = {}) {
  const completed = new Set();
  const timers = new Set();

  function clearTimers() {
    for (const timer of timers) {
      globalThis.clearTimeout(timer);
    }
    timers.clear();
  }

  function reset() {
    completed.clear();
    clearTimers();
  }

  function runAction(action, event, sessionId) {
    const handler = actions[action.type];
    if (typeof handler !== "function") {
      return false;
    }
    const invoke = () => {
      if (String(currentSessionId() || "") !== sessionId) {
        return false;
      }
      return handler({
        ...action,
        event
      });
    };
    const delayMs = Number(action.delayMs || 0);
    if (!Number.isFinite(delayMs) || delayMs <= 0) {
      return invoke();
    }
    const timer = globalThis.setTimeout(() => {
      timers.delete(timer);
      invoke();
    }, delayMs);
    timers.add(timer);
    return true;
  }

  function handle(event = {}) {
    const eventType = String(event.type || "");
    const sessionId = String(event.sessionId || currentSessionId() || "");
    if (!eventType) {
      return [];
    }
    const executed = [];
    for (const policy of normalizePolicies(
      typeof policies === "function" ? policies() : policies
    )) {
      if (!policy.on.includes(eventType) && !policy.on.includes("*")) {
        continue;
      }
      if (typeof policy.when === "function" && !policy.when(event)) {
        continue;
      }
      const completionKey = `${sessionId}:${policy.id}`;
      if (policy.once !== false && completed.has(completionKey)) {
        continue;
      }
      if (policy.once !== false) {
        completed.add(completionKey);
      }
      for (const action of policy.actions) {
        runAction(action, event, sessionId);
      }
      executed.push(policy.id);
    }
    return executed;
  }

  return {
    clearTimers,
    handle,
    reset
  };
}

export {
  createTerminalPolicyEngine,
  normalizePolicies
};
