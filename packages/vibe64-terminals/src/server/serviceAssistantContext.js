import { ACTION_PAUSE_MAIN_GOAL, ACTION_BLOCK_MAIN_GOAL } from "./assistantContracts.js";
import { createServiceToolCatalog } from "@jskit-ai/assistant-core/server";
import { vibe64AssistantSelectionFromMetadata } from "@local/vibe64-runtime/shared";

/** @typedef {import("./types.js").ServiceSessionAccess} ServiceSessionAccess */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */

/**
 * The context a session's assistant runs with: Main's application tools (the goal-control actions
 * Claude may call), the tool manifest a Main conversation context carries, and the assistant session
 * options built from them.
 * @param {object} dependencies
 * @param {ServiceSessionAccess} dependencies.sessionAccess
 * @param {ActionCatalogue | null} dependencies.actions
 */
function createServiceAssistantContext({ sessionAccess, actions }) {
  const mainToolCatalog = actions ? createServiceToolCatalog(actions, {
    // Discovery adds an identity envelope to each bounded result.
    maxToolResultBytes: 128 * 1024 + 1024,
    // Main's application tools are Claude goal control only.
    isActionAvailable: ({ actionId, context }) => [ACTION_PAUSE_MAIN_GOAL, ACTION_BLOCK_MAIN_GOAL].includes(actionId) &&
      Boolean(!context.runtime?.learningScope && context.assistantSelection?.engineId === "claude" &&
        (context.browserAuthority || context.mainGoalControl) && !context.temporaryConversationId &&
        !context.assistantScope && !context.scopedConversationId)
  }) : null;
  function applicationToolManifest(context) {
    // Tools decorate the context; a missing selection must not block cleanup.
    const selection = context.assistantSelection ||
      vibe64AssistantSelectionFromMetadata(context.session?.metadata, { required: false });
    const mainClaude = selection?.engineId === "claude" && !context.runtime?.learningScope &&
      !context.assistantScope && !context.temporaryConversationId && !context.scopedConversationId;
    if (!mainToolCatalog || !mainClaude) return context;
    const toolSet = mainToolCatalog.resolveToolSet(context, { discoveryOnly: true });
    return { ...context, applicationTools: { schemas: toolSet.tools.map(mainToolCatalog.toOpenAiToolSchema) } };
  }

  async function assistantSessionOptions(sessionId = "", options = {}) {
    return applicationToolManifest(await sessionAccess.readAssistantSession(sessionId, options));
  }

  return Object.freeze({
    applicationToolManifest,
    assistantSessionOptions,
    mainToolCatalog
  });
}

export {
  createServiceAssistantContext
};
