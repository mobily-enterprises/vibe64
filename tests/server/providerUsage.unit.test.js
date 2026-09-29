import assert from "node:assert/strict";
import test from "node:test";
import { setImmediate } from "node:timers/promises";
import { createProviderUsage } from "../../packages/vibe64-terminals/src/server/providerUsage.js";

const selection = (engineId = "codex", modelProviderId = "deepseek") => ({
  schema: "vibe64.assistant-selection.v1", engineId, modelProviderId, modelId: "model",
  agentId: engineId, variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`
});
function event(assistantSelection, active, turnId = "turn-1") {
  const run = { active, providerTurnId: turnId };
  if (assistantSelection.engineId === "claude") {
    return { payload: { agentRun: { ...run, ...assistantSelection } } };
  }
  if (assistantSelection.engineId === "codex") run.outerTurnId = turnId;
  return { session: { metadata: { assistant_selection: JSON.stringify(assistantSelection) } }, payload: { agentRun: run } };
}
const balanceResponse = (amount = "12.40") => ({ ok: true, json: async () => ({
  balance_infos: [{ currency: "USD", total_balance: amount }]
}) });

test("all three orchestrators refresh once at each turn boundary without waiting for a response", async () => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    const current = selection(engineId);
    const requests = [];
    let updates = 0;
    const usage = createProviderUsage({
      resolveConnection: async () => ({ apiKey: "test-key" }),
      fetchImpl: (url, options) => {
        const pending = Promise.withResolvers();
        requests.push({ url, options, ...pending });
        return pending.promise;
      }
    });
    assert.equal((await usage.read(current)).status, "unavailable");
    assert.equal(requests.length, 0, "reading the UI cache never queries the provider");
    const start = event(current, true);
    if (engineId === "codex") start.payload.agentRun.providerTurnId = "";
    assert.equal(usage.observe("project", "session", start, () => updates++), undefined);
    await setImmediate();
    usage.observe("project", "session", event(current, true));
    await setImmediate();
    assert.equal(requests.length, 1, "starting, active and finalizing updates share one query");
    assert.equal(requests[0].url, "https://api.deepseek.com/user/balance");
    assert.equal(requests[0].options.headers.Authorization, "Bearer test-key");
    assert.equal(requests[0].options.redirect, "error");
    assert.ok(requests[0].options.signal instanceof AbortSignal);
    usage.observe("project", "session", event(current, false), () => updates++);
    await setImmediate();
    assert.equal(requests.length, 2, "completion does not wait for the start query");
    requests[1].resolve(balanceResponse("0.00"));
    await setImmediate();
    requests[0].resolve(balanceResponse("12.40"));
    await setImmediate();
    const result = await usage.read(current);
    assert.equal(result.status, "available");
    assert.deepEqual(result.balances, [{ currency: "USD", amount: "0.00" }]);
    assert.equal(result.engineId, engineId);
    assert.equal(result.modelProviderId, "deepseek");
    assert.ok(result.checkedAt > 0);
    assert.equal(JSON.stringify(result).includes("test-key"), false);
    assert.equal(updates, 2);
    usage.observe("project", "session", event(current, false));
    await setImmediate();
    assert.equal(requests.length, 2, "duplicate completion events do not poll");
  }
});

test("DeepSeek preserves currencies and real zero balances while discarding malformed rows", async () => {
  const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: "key" }),
    fetchImpl: async () => ({ ok: true, json: async () => ({ balance_infos: [
      null, { currency: "USD", total_balance: "" }, { currency: "USD", total_balance: "oops" },
      { currency: "USD", total_balance: "0" }, { currency: "CNY", total_balance: "34.567" }
    ] }) }) });
  usage.observe("project", "session", event(selection(), true));
  await setImmediate();
  assert.deepEqual((await usage.read(selection())).balances, [
    { currency: "USD", amount: "0" }, { currency: "CNY", amount: "34.567" }
  ]);
});

test("GLM normalizes supplied coding windows and excludes tool quotas", async () => {
  const current = selection("opencode", "zai-coding-plan");
  const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: "glm-key" }),
    fetchImpl: async (url, options) => {
      assert.equal(url, "https://api.z.ai/api/monitor/usage/quota/limit");
      assert.equal(options.headers.Authorization, "glm-key");
      return { ok: true, json: async () => ({ success: true, data: { limits: [
        { type: "TOKENS_LIMIT", unit: 3, number: 5, percentage: 36, nextResetTime: 2000000000000 },
        { type: "CREDIT_LIMIT", unit: 6, number: 1, percentage: 24 },
        { type: "TIME_LIMIT", percentage: 4 }, null,
        { type: "TOKENS_LIMIT", percentage: 101 }, { type: "TOKENS_LIMIT", percentage: "50" }
      ] } }) };
    } });
  usage.observe("project", "session", event(current, true));
  await setImmediate();
  const result = await usage.read(current);
  assert.equal(result.status, "available");
  assert.deepEqual(result.windows, [
    { id: "0", remainingPercent: 64, windowDurationMins: 300, resetsAt: 2000000000 },
    { id: "1", remainingPercent: 76, windowDurationMins: 10080, resetsAt: null }
  ]);
});

test("pay-as-you-go GLM reads dollar balances at both turn boundaries across engines", async () => {
  for (const engineId of ["codex", "claude", "opencode"]) {
    const current = selection(engineId, "zai");
    let reads = 0;
    const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: "glm-api-key" }),
      fetchImpl: async (url, options) => {
        assert.equal(url, "https://api.z.ai/api/biz/account/query-customer-account-report");
        assert.equal(options.headers.Authorization, "Bearer glm-api-key");
        reads++;
        return { ok: true, json: async () => ({ success: true, code: 200, data: { balance: reads === 1 ? "12.40" : 0 } }) };
      } });
    assert.equal((await usage.read(current)).status, "unavailable");
    assert.equal(reads, 0);
    for (const active of [true, false]) {
      usage.observe("project", "session", event(current, active));
      await setImmediate();
      const result = await usage.read(current);
      assert.equal(result.status, "available");
      assert.deepEqual(result.balances, [{ currency: "USD", amount: active ? "12.40" : "0" }]);
      assert.deepEqual(result.windows, []);
      assert.equal(result.managementUrl, "https://z.ai/manage-apikey/billing");
      assert.equal(JSON.stringify(result).includes("glm-api-key"), false);
    }
    assert.equal(reads, 2);
  }
});

test("GLM HTTP 200 errors and missing or malformed balances never become money", async () => {
  const current = selection("opencode", "zai");
  for (const payload of [
    { code: 1000, msg: "Authentication Failed", success: false },
    { success: false, data: { balance: "12.40" } },
    { success: true, code: 401, data: { balance: "12.40" } },
    { data: { balance: "12.40" } },
    ...[undefined, null, "", " ", "oops", true, [], {}, Infinity].map(balance => ({ success: true, data: { balance } }))
  ]) {
    const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: "key" }),
      fetchImpl: async () => ({ ok: true, json: async () => payload }) });
    usage.observe("project", "session", event(current, true));
    await setImmediate();
    const result = await usage.read(current);
    assert.equal(result.status, "unavailable");
    assert.deepEqual(result.balances, []);
  }
});

test("Auto handoffs read the executing provider and keep native and OpenCode keys separate", async () => {
  const requests = [];
  const usage = createProviderUsage({
    resolveConnection: async (current) => ({ apiKey: `${current.engineId === "opencode" ? "opencode" : "native"}-${current.modelProviderId}` }),
    fetchImpl: async (url, options) => {
      requests.push(options.headers.Authorization);
      if (url.includes("deepseek")) return balanceResponse();
      if (url.includes("account-report")) return { ok: true, json: async () => ({ success: true, data: { balance: 8.2 } }) };
      return { ok: true, json: async () => ({
        data: { limits: [{ type: "TOKENS_LIMIT", percentage: 32 }] }
      }) };
    }
  });
  const handoffs = [selection(), selection("claude", "zai-coding-plan"), selection("codex", "zai"), selection("opencode"), selection()];
  for (const [index, current] of handoffs.entries()) {
    usage.observe("project", "session", event(current, true, `turn-${index}`));
    await setImmediate();
    const result = await usage.read(current);
    assert.equal(result.status, "available");
    assert.equal(result.modelProviderId, current.modelProviderId);
    usage.observe("project", "session", event(current, false, `turn-${index}`));
    await setImmediate();
  }
  assert.deepEqual(requests, ["Bearer native-deepseek", "Bearer native-deepseek", "native-zai-coding-plan", "native-zai-coding-plan",
    "Bearer native-zai", "Bearer native-zai",
    "Bearer opencode-deepseek", "Bearer opencode-deepseek", "Bearer native-deepseek", "Bearer native-deepseek"]);
});

test("replaced keys cannot inherit cached or in-flight balances", async () => {
  let key = "old-key";
  const requests = [];
  const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: key }), fetchImpl: () => {
    const pending = Promise.withResolvers();
    requests.push(pending);
    return pending.promise;
  } });
  usage.observe("project", "one", event(selection(), true));
  await setImmediate();
  key = "new-key";
  requests[0].resolve(balanceResponse("99"));
  await setImmediate();
  assert.equal((await usage.read(selection())).status, "unavailable");
  usage.observe("project", "one", event(selection(), false));
  await setImmediate();
  requests[1].resolve(balanceResponse("5"));
  await setImmediate();
  assert.equal((await usage.read(selection())).balances[0].amount, "5");
  key = "";
  assert.equal((await usage.read(selection())).status, "unavailable");
});

test("failed reads are unavailable, never zero or a turn failure", async () => {
  for (const fetchImpl of [
    async () => { throw new DOMException("Timed out", "TimeoutError"); },
    async () => ({ ok: false }),
    async () => ({ ok: true, json: async () => { throw new Error("Invalid JSON"); } }),
    async () => ({ ok: true, json: async () => ({}) })
  ]) {
    const usage = createProviderUsage({ resolveConnection: async () => ({ apiKey: "secret" }), fetchImpl });
    usage.observe("project", "one", event(selection(), true), () => { throw new Error("Observer failed"); });
    await setImmediate();
    const result = await usage.read(selection());
    assert.equal(result.status, "unavailable");
    assert.equal(result.balances?.length || 0, 0);
    assert.equal(JSON.stringify(result).includes("secret"), false);
  }
  const usage = createProviderUsage({ resolveConnection: async () => { throw new Error("Credentials unavailable"); } });
  usage.observe("project", "one", event(selection(), true));
  await setImmediate();
  assert.equal((await usage.read(selection())).status, "unavailable");
});

test("unsupported providers and non-turn events never query; session tracking is scoped and releasable", async () => {
  let reads = 0;
  const usage = createProviderUsage({ resolveConnection: async () => { reads++; return { apiKey: "key" }; }, fetchImpl: async () => balanceResponse() });
  for (const providerId of ["openai", "unsupported", "constructor"]) {
    const current = selection("codex", providerId);
    usage.observe("project", "one", event(current, true));
    assert.equal(await usage.read(current), null);
  }
  usage.observe("project", "one", { reason: "agent-plan-usage" });
  usage.observe("project", "one", event(selection(), true, ""));
  await setImmediate();
  assert.equal(reads, 0);
  usage.observe("first-project", "one", event(selection(), true));
  usage.observe("second-project", "one", event(selection(), true));
  await setImmediate();
  assert.equal(reads, 2);
  usage.forget("first-project", "one");
  usage.observe("first-project", "one", event(selection(), true));
  await setImmediate();
  assert.equal(reads, 3);
});
