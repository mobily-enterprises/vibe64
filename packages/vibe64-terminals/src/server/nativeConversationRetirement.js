
// Only saved main bindings and acknowledged replacements are eligible here.
// Temporary conversations retain their existing explicit-close lifecycle.
export function nativeConversationBindings(session, { retiredOnly = false } = {}) {
  const metadata = session.metadata || {};
  const state = JSON.parse(metadata.assistant_changeover || "null");
  const bindings = (state?.retiredConversations || []).map((binding) => ({ ...binding,
    engineId: binding.assistantSelection.engineId, retired: true }));
  if (retiredOnly) return bindings;

  for (const [key, conversationId] of Object.entries(metadata)) {
    const match = /^(codex(?:_([a-z0-9_-]+))?|claude|opencode)_conversation_id$/u.exec(key);
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
  return bindings;
}

export async function prepareCodexModelRouting(sessionId, _selection, { runtime, session }) {
  if (session.metadata?.codex_routing_home_provider === "openai") return;
  const boundProvider = session.metadata?.codex_routing_home_provider ||
    (session.metadata?.agent_identity_provider === "codex" && session.metadata?.agent_identity_conversation_id
      ? session.metadata.agent_identity_model_provider : "");
  if (boundProvider && boundProvider !== "openai" || nativeConversationBindings(session).some((binding) =>
    binding.engineId === "codex" && !binding.retired && binding.modelProviderId !== "openai")) {
    throw Object.assign(new Error("This Codex conversation is stored in a separate provider home. Renew the session to use model routing; its existing history and storage location have not been changed."), {
      code: "vibe64_codex_history_unsupported", statusCode: 409
    });
  }
  await runtime.store.writeMetadataValue(sessionId, "codex_routing_home_provider", "openai");
  session.metadata.codex_routing_home_provider = "openai";
}
