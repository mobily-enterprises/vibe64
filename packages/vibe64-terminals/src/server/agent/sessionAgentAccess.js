import { normalizeText } from "@local/vibe64-core/server/core";
import {
  assertCanUseVibe64Assistant,
  canUseVibe64Assistant,
  defineVibe64AssistantAccess,
  defineVibe64AssistantSelection,
  findVibe64AgentProvider
} from "@local/vibe64-runtime/shared";
import { assistantUser, providerBindingConflictError, sessionAssistantSelection } from "./sessionAgentRules.js";

/** @typedef {import("../types.js").SessionAgentBindings} SessionAgentBindings */

/**
 * Whether the session's actor may use its assistant: access reads and
 * requirements, plan usage, and the provider's account description.
 * @param {object} dependencies
 * @param {SessionAgentBindings} dependencies.sessionBindings
 * @param {(context: object) => Promise<object>} dependencies.readAssistantAccess
 * @param {(selection: object) => Promise<object | null>} [dependencies.readProviderUsage] without it plan usage reads none
 * @param {(user: object | null) => Promise<object | null>} dependencies.resolveAssistantUser
 */
function createSessionAgentAccess({
  sessionBindings,
  readAssistantAccess,
  readProviderUsage,
  resolveAssistantUser
}) {
  async function accessContext(provider = {}, sessionId = "", options = {}) {
    const vibe64User = await resolveAssistantUser(assistantUser(options));
    const assistantSelection = sessionAssistantSelection(options);
    const access = defineVibe64AssistantAccess(await readAssistantAccess({
      assistantSelection,
      engineId: provider.id,
      modelProviderId: assistantSelection?.modelProviderId || "",
      session: options.session || null,
      sessionId: normalizeText(sessionId),
      vibe64User
    }));
    return { vibe64User, access: Object.freeze({
      ...access,
      canUse: canUseVibe64Assistant(access, vibe64User),
      engineId: provider.id,
      modelProviderId: assistantSelection?.modelProviderId || "",
      transportId: provider.transportId
    }) };
  }

  async function accessFor(provider, sessionId, options) {
    return (await accessContext(provider, sessionId, options)).access;
  }

  async function requireAccessContext(provider = {}, sessionId = "", options = {}) {
    const context = await accessContext(provider, sessionId, options);
    const { access, vibe64User } = context;
    assertCanUseVibe64Assistant(access, vibe64User);
    if (options.expectedConnectionIdentity && access.connectionIdentity !== options.expectedConnectionIdentity) {
      throw Object.assign(new Error("The selected AI connection changed. Start a new request."), {
        code: "vibe64_assistant_connection_changed", statusCode: 409
      });
    }
    return context;
  }

  async function requireAccessFor(provider, sessionId, options) {
    return (await requireAccessContext(provider, sessionId, options)).access;
  }

  async function readPlanUsage(sessionId, options = {}) {
    const provider = sessionBindings.bindSession(sessionId, options);
    const access = await accessFor(provider, sessionId, options);
    if (!access.canUse) return { status: "unsupported", windows: [] };
    const usage = await readProviderUsage?.(sessionAssistantSelection(options));
    if (usage) return usage;
    const planUsage = findVibe64AgentProvider(provider.id)?.planUsage;
    // readable-check: allow method-probe - optional operation: a provider without plan usage reads it as unsupported
    if (typeof provider.readPlanUsage !== "function" || !access.ownerOnly || !planUsage) {
      return { status: "unsupported", windows: [] };
    }
    return { ...await provider.readPlanUsage({ sessionId, runtime: options.runtime, session: options.session }),
      providerLabel: planUsage.label, managementUrl: planUsage.managementUrl };
  }

  async function assistantAccess(sessionId = "", options = {}) {
    const provider = sessionBindings.bindSession(sessionId, options);
    return accessFor(provider, sessionId, options);
  }

  async function requireAssistantAccess(sessionId = "", options = {}) {
    const provider = sessionBindings.bindSession(sessionId, options);
    return requireAccessFor(provider, sessionId, options);
  }

  function requireAssistantAccessForEngine(engineId = "", options = {}) {
    const engineOptions = { ...options, engineId };
    return requireAccessFor(sessionBindings.providerFor(engineOptions), "", engineOptions);
  }

  function requireAssistantAccessForSelection(assistantSelection = {}, options = {}) {
    const selection = defineVibe64AssistantSelection(assistantSelection);
    const selectionOptions = { ...options, assistantSelection: selection };
    return requireAccessFor(sessionBindings.providerFor({ engineId: selection.engineId }), "", selectionOptions);
  }

  async function describeProvider(options = {}) {
    const sessionId = normalizeText(options.session?.sessionId || options.session?.id);
    const provider = sessionId
      ? sessionBindings.bindSession(sessionId, options)
      : sessionBindings.providerFor(options);
    const fallback = {
      providerId: provider.id,
      transportId: provider.transportId
    };
    // readable-check: allow method-probe - optional operation: a provider without a description is described by its catalogue entry
    if (typeof provider.describeProvider !== "function") {
      return Object.freeze(fallback);
    }
    await requireAccessFor(provider, sessionId, options);
    const described = await provider.describeProvider({
      providerId: provider.id,
      runtime: options.runtime || null,
      session: options.session || null,
      sessionId,
      transportId: provider.transportId,
      vibe64User: options.vibe64User || null
    });
    const providerId = normalizeText(described?.providerId);
    const transportId = normalizeText(described?.transportId);
    if (providerId !== provider.id || transportId !== provider.transportId) {
      throw providerBindingConflictError(
        sessionId,
        provider.id,
        providerId || "unknown"
      );
    }
    const accountIdentitySignature = normalizeText(described?.accountIdentitySignature);
    if (!/^sha256:[a-f0-9]{64}$/u.test(accountIdentitySignature)) {
      throw new TypeError(
        `Assistant provider ${provider.id} did not return a stable account identity.`
      );
    }
    return Object.freeze({
      ...fallback,
      accountIdentitySignature
    });
  }

  return Object.freeze({
    assistantAccess,
    describeProvider,
    readPlanUsage,
    requireAccessContext,
    requireAccessFor,
    requireAssistantAccess,
    requireAssistantAccessForEngine,
    requireAssistantAccessForSelection
  });
}

export {
  createSessionAgentAccess
};
