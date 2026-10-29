import assert from "node:assert/strict";
import test from "node:test";
import { createCodexAccountPreparation } from "../../packages/vibe64-terminals/src/server/codexAccountPreparation.js";
import { codexThreadModelProvider } from "../../packages/vibe64-terminals/src/server/codexRuntimeHost.js";

// Both Z.AI connections offer GLM 5.3. A helper's selection names its exact
// connection, so the model id alone must not choose the owner-only Coding Plan.
function accountPreparation(connected = []) {
  const homes = [];
  const preparation = createCodexAccountPreparation({
    runtimeHost: {
      resolvedCodexToolHomeSource: () => "/fixture/native-codex-home",
      codexRuntimeForTerminalEnv: () => ({ providerOptions: {} })
    },
    providerConnections: {
      async runtimeOptions(providerId) {
        homes.push(providerId);
        if (!connected.includes(providerId)) throw new Error(`Connect Codex - ${providerId} in AI Accounts first.`);
        return { toolHomeSource: `/fixture/provider-homes/${providerId}` };
      }
    },
    codexToolHomeRequired: false,
    codexAppServerProviderOptions: {}
  });
  return { homes, preparation };
}

test("a Codex helper uses the provider home its selection names, not the first provider offering the model", async () => {
  const payAsYouGo = accountPreparation(["zai"]);
  assert.deepEqual(await payAsYouGo.preparation.codexToolHomeResult({ agentSettings: { model: "glm-5.3", modelProviderId: "zai" } }),
    { ok: true, toolHomeSource: "/fixture/provider-homes/zai" });
  assert.deepEqual(payAsYouGo.homes, ["zai"]);

  const both = accountPreparation(["zai", "zai-coding-plan"]);
  assert.equal((await both.preparation.codexToolHomeResult({ agentSettings: { model: "glm-5.3", modelProviderId: "zai" } })).toolHomeSource,
    "/fixture/provider-homes/zai");
  assert.equal((await both.preparation.codexToolHomeResult({ agentSettings: { model: "glm-5.3", modelProviderId: "zai-coding-plan" } })).toolHomeSource,
    "/fixture/provider-homes/zai-coding-plan");
  assert.equal((await both.preparation.codexToolHomeResult({ agentSettings: { model: "gpt-5.6-luna", modelProviderId: "openai" } })).toolHomeSource,
    "/fixture/native-codex-home");
  assert.deepEqual(both.homes, ["zai", "zai-coding-plan"]);
});

test("a Codex helper thread starts on its routing provider when its parameters name none", () => {
  assert.equal(codexThreadModelProvider({ model: "glm-5.3" }, "zai"), "zai");
  assert.equal(codexThreadModelProvider({ model: "glm-5.3", modelProvider: "zai-coding-plan" }, "zai"), "zai-coding-plan");
  assert.equal(codexThreadModelProvider({ model: "gpt-5.6-luna" }, ""), "openai");
});
