import { toValue } from "vue";

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

// readable-check: allow method-probe - input validation: a policy applies to every event it is on, or only where its when function agrees
function policyHasCondition(policy) {
  return typeof policy.when === "function";
}

/**
 * Runs a terminal's policies: each event a policy is `on` runs its actions through `actions`, once per session unless
 * the policy says `once: false`, and an action with `delayMs` runs later only while its session is still current.
 * `policies` is the list, or a getter that reads it at each event.
 * @param {{
 *   actions: Record<string, (action: object) => unknown>,
 *   currentSessionId: () => string,
 *   policies: object[] | (() => object[])
 * }} options
 */
function createTerminalPolicyEngine({
  actions,
  currentSessionId,
  policies
}) {
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
    for (const policy of normalizePolicies(toValue(policies))) {
      if (!policy.on.includes(eventType) && !policy.on.includes("*")) {
        continue;
      }
      if (policyHasCondition(policy) && !policy.when(event)) {
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

  return Object.freeze({
    clearTimers,
    handle,
    reset
  });
}

export {
  createTerminalPolicyEngine,
  normalizePolicies
};
