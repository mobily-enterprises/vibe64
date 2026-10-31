import path from "node:path";
import { createAiConnectionStore } from "./aiConnectionStore.js";
import { readAllOpenCodeCapabilityRows } from "./opencodeCatalogPages.js";
import { ZAI_FREE_MODEL_ID } from "./assistantProviderPolicy.js";
import { verifyZaiConnection } from "./zaiConnectionVerifier.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {ReturnType<typeof import("./aiConnectionStore.js").createAiConnectionStore>} AiConnectionStore */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {ReturnType<typeof import("./accountRealtimeEvents.js").createVibe64ConnectionsChangedPublisher>} PublishConnectionChanged */

/**
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {TerminalsService} dependencies.terminals
 * @param {PublishConnectionChanged} dependencies.publishConnectionChanged
 */
function createAiConnectionRuntime({ systemRoot, terminals, publishConnectionChanged }) {
  return createAiConnectionStore({
    filePath: path.join(systemRoot, "ai-connections", "connections.json"),
    async withConnectionChange(change, publish) {
      let published = false;
      const result = await terminals.invalidateAgentRuntimes({ ...change, provider: "opencode", async publish() {
        await publish();
        published = true;
      } });
      if (result?.ok === false || !published) {
        throw new Error(result?.failed?.[0]?.error || "Close OpenCode native terminals, then retry this connection change.");
      }
    },
    // Credential changes already reached the running OpenCode server inside
    // withConnectionChange, which stops no turn. Model access is admission
    // policy, checked again on every turn, so it stops no running work either.
    async onConnectionChanged(change) {
      const removed = change.reason === "removed";
      await publishConnectionChanged(change.modelProviderId, {
        connected: !removed,
        operation: removed
          ? "deleted"
          : change.reason === "created" ? "created" : "updated",
        reason: change.reason,
        status: removed ? "disconnected" : "connected"
      });
    },
    async readModelIds() {
      const { rows } = await readAllOpenCodeCapabilityRows((query) => terminals.listAssistantCapabilities(query),
        { modelProviderId: "opencode" });
      return rows.filter((model) => model?.status !== "unavailable")
        .map((model) => String(model?.id || "").trim()).filter(Boolean);
    },
    verifyConnection(input) {
      if (
        input?.modelProviderId === "zai" &&
        input?.modelId === ZAI_FREE_MODEL_ID
      ) {
        return verifyZaiConnection(input);
      }
      return terminals.verifyAssistantConnection(input);
    }
  });
}

/**
 * The OpenCode connection hooks only; the Accounts feature registers the
 * Claude and Codex sign-in status hooks itself.
 * @param {object} dependencies
 * @param {AiConnectionStore} dependencies.aiConnections
 * @param {TerminalsService} dependencies.terminals
 * @param {AccountsRuntime["requireAiManagement"]} dependencies.requireAiManagement
 */
function configureAiConnectionRuntime({ aiConnections, terminals, requireAiManagement } = {}) {
  if (typeof requireAiManagement !== "function") {
    throw new TypeError("AI connection runtime requires the host AI management policy.");
  }
  terminals.configureAssistantRuntime({
    listConnections: () => aiConnections.listConnections(),
    readAssistantAccess: ({ assistantSelection, modelProviderId = "" } = {}) => aiConnections.assistantAccess(modelProviderId, {
      modelId: assistantSelection?.modelId || ""
    }),
    resolveConnection: ({ modelProviderId = "" } = {}) => aiConnections.resolveConnection(modelProviderId),
    async updateModelAccess({ modelProviderId = "", unlocked, vibe64User } = {}) {
      const denied = await requireAiManagement({ vibe64User });
      if (denied) throw Object.assign(new Error(denied.error), { code: denied.code, statusCode: 403 });
      return { connection: await aiConnections.updateModelAccess(modelProviderId, { unlocked }), ok: true };
    }
  });
}

export { createAiConnectionRuntime, configureAiConnectionRuntime };
