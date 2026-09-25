import path from "node:path";

// Shared by the three native owners. The host must durably preserve customer
// history, check references across projects and exclude external CLI writers.
// This callback is trusted server code, never request data or a retention rule.
export async function retireNativeConversation({ binding, inspect, remove, beforeDelete, readConversation, exportConversation }) {
  if (typeof beforeDelete !== "function") throw new TypeError("Native retirement requires a host preservation callback.");
  if (!binding?.conversationId || !path.isAbsolute(binding.workdir || "")) {
    throw new TypeError("Native retirement requires an exact conversation and absolute native directory.");
  }
  const before = await inspect();
  if (before.length === 0) return { ok: true, alreadyAbsent: true, conversationIds: [] };
  const snapshot = JSON.stringify(before);
  const ids = new Set(before.map((entry) => entry.conversationId));
  const inventory = {
    binding: structuredClone(binding),
    conversations: structuredClone(before)
  };
  if (readConversation) {
    inventory.readConversation = (id) => {
      if (!ids.has(id)) throw new Error("Cannot export a conversation outside the inspected native family.");
      return readConversation(id);
    };
  }
  const exported = new Map();
  let preserving = true;
  if (exportConversation) {
    inventory.exportConversation = async (id, onRecord) => {
      if (!preserving || !ids.has(id)) throw new Error("Cannot export a conversation outside the inspected preservation scope.");
      const result = await exportConversation(id, onRecord);
      if (!/^[a-f0-9]{64}$/u.test(result?.revision || "")) throw new Error("Native export did not confirm a complete history revision.");
      exported.set(id, result.revision);
      return result;
    };
  }
  let proof;
  try { proof = await beforeDelete(inventory); }
  finally { preserving = false; }
  if (proof?.preserved !== true || proof?.exclusive !== true) {
    throw new Error("The host did not confirm preserved history and exclusive ownership of every native conversation.");
  }
  if (exportConversation) {
    if (exported.size !== ids.size) throw new Error("Preserve the complete native export of every inspected conversation before retirement.");
    for (const id of ids) {
      if ((await exportConversation(id, async () => {})).revision !== exported.get(id)) {
        throw new Error("Native history changed during preservation. Export and preserve it again before retirement.");
      }
    }
  }
  if (JSON.stringify(await inspect()) !== snapshot) {
    throw new Error("Native history changed during preservation. Inspect and preserve it again before retirement.");
  }
  await remove(before);
  if ((await inspect()).length !== 0) throw new Error("Native deletion was not confirmed; retain the cleanup receipt and retry.");
  return { ok: true, alreadyAbsent: false, conversationIds: before.map((entry) => entry.conversationId) };
}

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
