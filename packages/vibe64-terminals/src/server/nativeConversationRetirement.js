import { AppError } from "@jskit-ai/kernel/server/runtime";

const NATIVE_CONVERSATION_BINDING_KEY = /^(codex(?:_([a-z0-9_-]+))?|claude|opencode)_conversation_id$/u;

function isNativeConversationBindingKey(name) {
  return NATIVE_CONVERSATION_BINDING_KEY.test(name);
}

const RECORD_ENGINES = new Set(["claude", "codex", "opencode"]);

/**
 * The native conversations a temporary chat or AI task record names, as its Close releases them: its
 * retained bindings and its current one. They ran in the session's own directory and Codex home, as
 * its main chat does; Claude saved its directory with each conversation.
 * @param {Record<string, string>} metadata the session's metadata
 * @param {object} record a temporary chat or AI task record
 * @param {object[]} mainBindings the main chat's bindings, for its directory
 */
function conversationRecordBindings(metadata, record, mainBindings) {
  const named = [
    ...Object.values(record.nativeBindings && typeof record.nativeBindings === "object" ? record.nativeBindings : {}),
    { conversationId: record.providerConversationId, assistantSelection: record.assistantSelection }
  ];
  const bindings = [];
  for (const { conversationId, assistantSelection } of named.filter(Boolean)) {
    const engineId = assistantSelection?.engineId;
    if (typeof conversationId !== "string" || !conversationId || !RECORD_ENGINES.has(engineId) ||
        bindings.some((entry) => entry.engineId === engineId && entry.conversationId === conversationId)) continue;
    const claude = engineId === "claude" ? JSON.parse(metadata[`claude_conversation_${conversationId}`] || "null") : null;
    const workdir = claude?.nativeWorkdir ||
      mainBindings.find((entry) => entry.engineId === engineId && !entry.retired)?.workdir || metadata.source_path || "";
    const modelProviderId = engineId === "codex" ? metadata.codex_routing_home_provider || "openai" : "";
    bindings.push({ engineId, conversationId, retired: false, workdir, modelProviderId, assistantSelection });
  }
  return bindings;
}

/**
 * Saved main bindings and acknowledged replacements. An archived session from
 * `withArchivedSession` also carries its temporary chat and AI task records, and
 * their native conversations join it: none continues after the archive (a renewal
 * carries none to its fresh session), and their saved history stays in it. An
 * open session's temporary conversations keep their explicit-close lifecycle.
 */
function nativeConversationBindings(session, options = {}) {
  const { retiredOnly = false } = options;
  const metadata = session.metadata || {};
  const state = JSON.parse(metadata.assistant_changeover || "null");
  const bindings = (state?.retiredConversations || []).map((binding) => ({
    ...binding,
    engineId: binding.assistantSelection.engineId,
    retired: true
  }));
  if (retiredOnly) return bindings;

  for (const [key, conversationId] of Object.entries(metadata)) {
    const match = NATIVE_CONVERSATION_BINDING_KEY.exec(key);
    if (!match || !conversationId) continue;
    const [, prefix, codexHomeProvider] = match;
    const engineId = prefix.startsWith("codex") ? "codex" : prefix;
    const currentIdentity = metadata.agent_identity_provider === engineId &&
      metadata.agent_identity_conversation_id === conversationId;
    const claude = engineId === "claude"
      ? JSON.parse(metadata[`claude_conversation_${conversationId}`] || "null") : null;
    const workdir = metadata[`${prefix}_conversation_workdir`] || claude?.nativeWorkdir ||
      (currentIdentity ? metadata.agent_identity_workdir : "") || metadata.source_path || "";
    const modelProviderId = engineId === "codex"
      ? codexHomeProvider || metadata.codex_routing_home_provider || "openai" : "";
    bindings.push({ engineId, conversationId, retired: false, workdir, modelProviderId });
  }
  if (session.archived !== true) return bindings;
  for (const record of session.conversations || []) {
    for (const binding of conversationRecordBindings(metadata, record, bindings)) {
      if (!bindings.some((entry) => entry.engineId === binding.engineId && entry.conversationId === binding.conversationId)) {
        bindings.push(binding);
      }
    }
  }
  return bindings;
}

async function prepareCodexModelRouting(sessionId, _selection, { runtime, session }) {
  if (session.metadata?.codex_routing_home_provider === "openai") return;
  const boundProvider = session.metadata?.codex_routing_home_provider ||
    (session.metadata?.agent_identity_provider === "codex" && session.metadata?.agent_identity_conversation_id
      ? session.metadata.agent_identity_model_provider : "");
  if (boundProvider && boundProvider !== "openai" || nativeConversationBindings(session).some((binding) =>
    binding.engineId === "codex" && !binding.retired && binding.modelProviderId !== "openai")) {
    throw new AppError(409, "This Codex conversation is stored in a separate provider home. Renew the session to use the models chosen in Models; its existing history and storage location have not been changed.", {
      code: "vibe64_codex_history_unsupported",
      messageCode: "vibe64_codex_history_provider_home_separate"
    });
  }
  await runtime.store.writeMetadataValue(sessionId, "codex_routing_home_provider", "openai");
  session.metadata.codex_routing_home_provider = "openai";
}

export {
  conversationRecordBindings,
  isNativeConversationBindingKey,
  nativeConversationBindings,
  prepareCodexModelRouting
};
