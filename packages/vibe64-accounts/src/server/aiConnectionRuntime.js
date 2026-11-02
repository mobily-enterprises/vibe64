import path from "node:path";
import { AppError } from "@jskit-ai/kernel/server/runtime";
import { createAiConnectionStore } from "./aiConnectionStore.js";
import { readAllOpenCodeCapabilityRows } from "./opencodeCatalogPages.js";
import { ZAI_FREE_MODEL_ID } from "./assistantProviderPolicy.js";
import { verifyZaiConnection } from "./zaiConnectionVerifier.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */
/** @typedef {import("./types.js").AiConnectionStore} AiConnectionStore */
/** @typedef {import("./types.js").AccountsRuntime} AccountsRuntime */
/** @typedef {ReturnType<typeof import("./accountRealtimeEvents.js").createVibe64ConnectionsChangedPublisher>} PublishConnectionChanged */
/** @typedef {import("./types.js").AccountsRequireAiManagement} AccountsRequireAiManagement */

/**
 * @param {object} dependencies
 * @param {string} dependencies.systemRoot
 * @param {TerminalsService} dependencies.terminals
 * @param {PublishConnectionChanged} dependencies.publishConnectionChanged
 */
function createAiConnectionRuntime({
  systemRoot,
  terminals,
  publishConnectionChanged
}) {
  /**
   * A connection change reaches the running OpenCode server before it is published.
   * @param {object} change
   * @param {() => Promise<void>} publish
   */
  async function withConnectionChange(change, publish) {
    let published = false;
    const result = await terminals.invalidateAgentRuntimes({
      ...change,
      provider: "opencode",
      async publish() {
        await publish();
        published = true;
      }
    });
    if (result?.ok === false || !published) {
      throw new Error(result?.failed?.[0]?.error || "Close OpenCode native terminals, then retry this connection change.");
    }
  }

  /**
   * Credential changes already reached the running OpenCode server inside
   * withConnectionChange, which stops no turn. Model access is admission
   * policy, checked again on every turn, so it stops no running work either.
   * @param {object} change
   */
  async function onConnectionChanged(change) {
    const removed = change.reason === "removed";
    await publishConnectionChanged(change.modelProviderId, {
      connected: !removed,
      operation: removed
        ? "deleted"
        : change.reason === "created" ? "created" : "updated",
      reason: change.reason,
      status: removed ? "disconnected" : "connected"
    });
  }

  /**
   * The ids of OpenCode's own models that are not unavailable.
   */
  async function readModelIds() {
    const { rows } = await readAllOpenCodeCapabilityRows(
      (query) => terminals.listAssistantCapabilities(query),
      { modelProviderId: "opencode" }
    );
    return rows.filter((model) => model?.status !== "unavailable")
      .map((model) => String(model?.id || "").trim()).filter(Boolean);
  }

  /**
   * Z.AI's free model is checked by Vibe64 itself; every other connection by OpenCode.
   * @param {object} input
   */
  function verifyConnection(input) {
    if (
      input?.modelProviderId === "zai" &&
      input?.modelId === ZAI_FREE_MODEL_ID
    ) {
      return verifyZaiConnection(input);
    }
    return terminals.verifyAssistantConnection(input);
  }

  return createAiConnectionStore({
    filePath: path.join(systemRoot, "ai-connections", "connections.json"),
    withConnectionChange,
    onConnectionChanged,
    readModelIds,
    verifyConnection
  });
}

/**
 * The OpenCode connection hooks only; the Accounts feature registers the
 * Claude and Codex sign-in status hooks itself.
 * @param {object} dependencies
 * @param {AiConnectionStore} dependencies.aiConnections
 * @param {TerminalsService} dependencies.terminals
 * @param {AccountsRequireAiManagement} dependencies.requireAiManagement
 */
function configureAiConnectionRuntime({ aiConnections, terminals, requireAiManagement }) {
  /**
   * The saved connections.
   */
  function listConnections() {
    return aiConnections.listConnections();
  }

  /**
   * What a selection's saved connection lets it use.
   * @param {object} [request]
   */
  function readAssistantAccess({ assistantSelection, modelProviderId = "" } = {}) {
    return aiConnections.assistantAccess(modelProviderId, {
      modelId: assistantSelection?.modelId || ""
    });
  }

  /**
   * A provider's saved connection, with its key.
   * @param {object} [request]
   */
  function resolveConnection({ modelProviderId = "" } = {}) {
    return aiConnections.resolveConnection(modelProviderId);
  }

  /**
   * Unlocks or locks a provider's models, for whoever manages AI only.
   * @param {object} [request]
   */
  async function updateModelAccess({ modelProviderId = "", unlocked, vibe64User } = {}) {
    const denied = await requireAiManagement({ vibe64User });
    if (denied) throw new AppError(403, denied.error, { code: denied.code });
    return { connection: await aiConnections.updateModelAccess(modelProviderId, { unlocked }), ok: true };
  }

  terminals.configureAssistantRuntime({
    listConnections,
    readAssistantAccess,
    resolveConnection,
    updateModelAccess
  });
}

export { createAiConnectionRuntime, configureAiConnectionRuntime };
