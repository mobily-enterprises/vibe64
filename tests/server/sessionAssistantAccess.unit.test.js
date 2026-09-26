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
