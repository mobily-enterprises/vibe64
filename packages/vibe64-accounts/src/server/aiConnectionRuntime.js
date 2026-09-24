import path from "node:path";
import { createAiConnectionStore } from "./aiConnectionStore.js";
import { verifyZaiConnection, ZAI_FREE_MODEL_ID } from "./zaiConnectionVerifier.js";

function createAiConnectionRuntime({ systemRoot, terminals, publishConnectionChanged = async () => null } = {}) {
  return createAiConnectionStore({
    filePath: path.join(systemRoot, "ai-connections", "connections.json"),
    async onConnectionChanged(change) {
      const removed = change.reason === "removed";
      const [invalidation] = await Promise.all([
        terminals.invalidateAgentRuntimes({
          ...change,
          provider: "opencode"
        }),
        publishConnectionChanged(change.modelProviderId, {
          connected: !removed,
          operation: removed
            ? "deleted"
            : change.reason === "created" ? "created" : "updated",
          reason: change.reason,
          status: removed ? "disconnected" : "connected"
        })
      ]);
      return invalidation;
    },
    async readModelIds() {
      const modelIds = [];
      const seenCursors = new Set();
      let cursor = "";
      do {
        const result = await terminals.listAssistantCapabilities({
          cursor,
          engineId: "opencode",
          limit: "100",
          modelProviderId: "opencode"
        });
        const engine = (Array.isArray(result?.engines) ? result.engines : [])
          .find((candidate) => candidate?.engineId === "opencode");
        const provider = (Array.isArray(engine?.modelProviders) ? engine.modelProviders : [])
          .find((candidate) => candidate?.id === "opencode");
        if (!engine || !provider) {
          throw new Error("OpenCode returned an invalid Zen model catalogue.");
        }
        modelIds.push(...(Array.isArray(provider?.models) ? provider.models : [])
          .filter((model) => model?.status !== "unavailable")
          .map((model) => String(model?.id || "").trim())
          .filter(Boolean));
        cursor = engine?.page?.hasMore === true
          ? String(engine.page.nextCursor || "").trim()
          : "";
        if (cursor && seenCursors.has(cursor)) {
          throw new Error("OpenCode could not finish reading the Zen model catalogue.");
        }
        if (cursor) seenCursors.add(cursor);
      } while (cursor);
      return modelIds;
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

function configureAiConnectionRuntime({ accountService, aiConnections, terminals, requireManagement = () => null } = {}) {
  terminals.configureAssistantRuntime({
    async claudeConnectionStatus() {
      return (await accountService.getClaudeStatus()).account?.connected === true;
    },
    async codexConnectionStatus() {
      const status = await accountService.getStatus({ accountIds: ["codex"] });
      return status.ok === true && status.accounts.some((account) => account.id === "codex" && account.connected === true);
    },
    listConnections: () => aiConnections.listConnections(),
    readAssistantAccess: ({ assistantSelection, modelProviderId = "" } = {}) => aiConnections.assistantAccess(modelProviderId, {
      modelId: assistantSelection?.modelId || ""
    }),
    resolveConnection: ({ modelProviderId = "" } = {}) => aiConnections.resolveConnection(modelProviderId),
    async updateModelAccess({ modelProviderId = "", unlocked, vibe64User } = {}) {
      const denied = await requireManagement({ vibe64User });
      if (denied) throw Object.assign(new Error(denied.error), { code: denied.code, statusCode: 403 });
      return { connection: await aiConnections.updateModelAccess(modelProviderId, { unlocked }), ok: true };
    }
  });
}

export { createAiConnectionRuntime, configureAiConnectionRuntime };
