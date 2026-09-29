import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";

const PROVIDERS = {
  deepseek: {
    url: "https://api.deepseek.com/user/balance",
    label: "DeepSeek",
    managementUrl: "https://platform.deepseek.com/top_up"
  },
  zai: {
    url: "https://api.z.ai/api/biz/account/query-customer-account-report",
    label: "GLM",
    managementUrl: "https://z.ai/manage-apikey/billing"
  },
  "zai-coding-plan": {
    url: "https://api.z.ai/api/monitor/usage/quota/limit",
    label: "GLM",
    managementUrl: "https://z.ai/subscribe"
  }
};

function normalizeUsage(providerId, value) {
  if (providerId === "zai") {
    // The console endpoint can return authentication errors under HTTP 200.
    const amount = value?.data?.balance;
    const valid = value?.success === true && !(Number(value.code) >= 400) &&
      (typeof amount === "number" || (typeof amount === "string" && /^-?\d+(?:\.\d+)?$/u.test(amount))) &&
      Number.isFinite(Number(amount));
    const balances = valid ? [{ currency: "USD", amount: String(amount) }] : [];
    return { status: balances.length ? "available" : "unavailable", kind: "balance", balances, windows: [] };
  }
  if (providerId === "deepseek") {
    const balances = (Array.isArray(value?.balance_infos) ? value.balance_infos : []).flatMap((balance) => {
      if (
        !["USD", "CNY"].includes(balance?.currency) || typeof balance.total_balance !== "string" ||
        !/^-?\d+(?:\.\d+)?$/u.test(balance.total_balance) || !Number.isFinite(Number(balance.total_balance))
      ) return [];
      return [{ currency: balance.currency, amount: balance.total_balance }];
    });
    return { status: balances.length ? "available" : "unavailable", kind: "balance", balances, windows: [] };
  }
  const limits = value?.success !== false && Array.isArray(value?.data?.limits) ? value.data.limits : [];
  const windows = limits.flatMap((limit, index) => {
    if (
      !["TOKENS_LIMIT", "CREDIT_LIMIT"].includes(limit?.type) || !Number.isFinite(limit.percentage) ||
      limit.percentage < 0 || limit.percentage > 100
    ) return [];
    let windowDurationMins = null;
    if (limit.unit === 3 && limit.number === 5) windowDurationMins = 300;
    else if (limit.unit === 6 && limit.number === 1) windowDurationMins = 10080;
    const resetsAt = Number.isSafeInteger(limit.nextResetTime) && limit.nextResetTime > 0
      ? limit.nextResetTime / 1000 : null;
    return [{ id: String(index), remainingPercent: 100 - limit.percentage, windowDurationMins, resetsAt }];
  });
  return { status: windows.length ? "available" : "unavailable", kind: "quota", windows };
}

// Account snapshots are optional and memory-only. Turn execution never awaits a
// balance request, and the HTTP read never makes an upstream request of its own.
function createProviderUsage({ resolveConnection, fetchImpl = fetch } = {}) {
  const accounts = new Map();
  const turns = new Map();

  function accountKey(selection) {
    return `${selection.engineId === "opencode" ? "opencode" : "native"}:${selection.modelProviderId}`;
  }

  async function refresh(selection) {
    const key = accountKey(selection);
    // Retain the last snapshot while this request runs; older requests lose ownership.
    const account = { ...accounts.get(key) };
    accounts.set(key, account);
    const provider = PROVIDERS[selection.modelProviderId];
    let usage = { status: "unavailable", windows: [] };
    let apiKey;
    try {
      apiKey = (await resolveConnection(selection))?.apiKey;
      if (!apiKey || accounts.get(key) !== account) return;
      const response = await fetchImpl(provider.url, {
        headers: {
          Authorization: selection.modelProviderId === "zai-coding-plan" ? apiKey : `Bearer ${apiKey}`,
          Accept: "application/json"
        },
        redirect: "error",
        signal: AbortSignal.timeout(5_000)
      });
      if (response.ok) usage = normalizeUsage(selection.modelProviderId, await response.json());
    } catch { /* Usage is informational; failures never affect a turn. */ }
    if (accounts.get(key) !== account) return;
    account.apiKey = apiKey;
    account.usage = { ...usage, checkedAt: Date.now(), providerLabel: provider.label, managementUrl: provider.managementUrl };
  }

  return {
    async read(selection) {
      if (!Object.hasOwn(PROVIDERS, selection?.modelProviderId)) return null;
      try {
        const connection = await resolveConnection(selection);
        const cached = accounts.get(accountKey(selection));
        const usage = connection?.apiKey && cached?.apiKey === connection.apiKey
          ? cached.usage : { status: "unavailable", windows: [] };
        return { ...usage, engineId: selection.engineId, modelProviderId: selection.modelProviderId };
      } catch { return { status: "unavailable", windows: [] }; }
    },
    observe(scope, sessionId, event, onUpdated) {
      try {
        const run = event.payload?.agentRun;
        const selection = event.session
          ? vibe64AssistantSelectionFromMetadata(event.session.metadata, { required: false })
          : { engineId: run?.engineId, modelProviderId: run?.modelProviderId };
        if (
          !Object.hasOwn(PROVIDERS, selection?.modelProviderId) ||
          !["codex", "claude", "opencode"].includes(selection.engineId) || typeof run?.active !== "boolean"
        ) return;
        const turnId = run.outerTurnId || run.providerTurnId;
        if (!turnId) return;
        const key = `${scope}:${sessionId}`;
        const stage = `${selection.engineId}:${selection.modelProviderId}:${turnId}:${run.active}`;
        if (turns.get(key) === stage) return;
        turns.set(key, stage);
        void refresh(selection).then(onUpdated).catch(() => {});
      } catch { /* Optional observation must not interrupt lifecycle publication. */ }
    },
    forget(scope, sessionId) {
      turns.delete(`${scope}:${sessionId}`);
    }
  };
}

export { createProviderUsage };
