import assert from "node:assert/strict";
import test from "node:test";
import { createService } from "../../packages/vibe64-sessions/src/server/service.js";

test("assistant access exposes purpose decisions without private connection identities", async () => {
  const session = { sessionId: "session-1" };
  const runtime = { getSession: async () => session };
  const service = createService({
    project: { createRuntime: async () => runtime },
    terminals: { async inspectAssistantAccess(_sessionId, context) {
      assert.equal(context.vibe64User.username, "member");
      assert.equal(context.session, session);
      return {
        available: true, canUse: true, nativeCanUse: false, canUseAny: true, currentMode: "junior",
        purposes: {
          junior: { available: true, effectiveSelection: { modelId: "deepseek-flash" },
            connectionIdentity: "private-connection", seniorJuniorPair: {
              senior: { connectionIdentity: "private-plan" }, junior: { connectionIdentity: "private-code" }
            } },
          prompt_hint: { available: true, effectiveSelection: { modelId: "deepseek-flash" } },
          auto: { available: true, routerConnectionIdentity: "private-router" }
        }
      };
    } }
  });
  const result = await service.inspectAssistantAccess("session-1", { vibe64User: { username: "member", role: "member" } });
  assert.equal(result.ok, true);
  assert.equal(result.currentMode, "junior");
  assert.equal(result.canUse, true);
  assert.equal(result.nativeCanUse, false);
  assert.equal(result.purposes.prompt_hint.available, true);
  assert.equal(result.purposes.auto.available, true);
  assert.equal(result.purposes.junior.effectiveSelection.modelId, "deepseek-flash");
  assert.doesNotMatch(JSON.stringify(result), /private-|connectionIdentity|routerConnectionIdentity/u);
});

test("chat access omits repeated dispatch plans while retaining decisions, labels and backup explanations", async () => {
  const selection = { engineId: "opencode", modelId: "shared-model", modelLabel: "Shared model",
    modelProviderId: "provider", variantId: "high" };
  const pair = { senior: { configuredSelection: selection, effectiveSelection: selection },
    junior: { configuredSelection: selection, effectiveSelection: selection } };
  const access = { available: true, canUse: true, nativeCanUse: true, canUseAny: true, currentMode: "junior",
    purposes: Object.fromEntries(["senior", "junior", "review", "deslop", "auto"].map(role => [role, {
      available: true, role, configuredSelection: selection, effectiveSelection: selection,
      seniorJuniorPair: pair, router: selection, executionProfileRequest: { instruction: "server-only" },
      backupUsed: true, backupReason: "Personal connection is owner-only", reasonCode: "", message: ""
    }])) };
  access.purposes.custom = { available: false, effectiveSelection: null, reasonCode: "missing-connection",
    message: "Choose a connected assistant.", missingRoles: ["custom"] };
  const original = JSON.stringify(access);
  const service = createService({
    project: { createRuntime: async () => ({ getSession: async () => ({ sessionId: "one" }) }) },
    terminals: { inspectAssistantAccess: async () => access }
  });
  const result = await service.inspectAssistantAccess("one", { vibe64User: { username: "member", role: "member" } });
  assert.equal(result.canUse, true);
  assert.equal(result.nativeCanUse, true);
  assert.equal(result.currentMode, "junior");
  for (const role of ["senior", "junior", "review", "deslop", "auto"]) {
    assert.equal(result.purposes[role].available, true);
    assert.deepEqual(result.purposes[role].effectiveSelection, selection);
    assert.equal(result.purposes[role].backupUsed, true);
    assert.equal(result.purposes[role].backupReason, "Personal connection is owner-only");
  }
  assert.deepEqual(result.purposes.custom, access.purposes.custom);
  assert.doesNotMatch(JSON.stringify(result), /configuredSelection|seniorJuniorPair|executionProfileRequest|"router"/u);
  assert.ok(JSON.stringify(result).length < original.length * 0.55);
  assert.equal(JSON.stringify(access), original, "public projection must not change server dispatch decisions");
});
