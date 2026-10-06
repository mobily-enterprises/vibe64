import { randomUUID } from "node:crypto";
import path from "node:path";
import { mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";

const ENGINE = "claude";
const TRANSPORT = "claude_stream_json";

/** Vibe64's existing session metadata and retained scoped-Claude receipt storage. */
function createClaudeConversationStorage({ createError: error }) {
  async function metadata(context, values) {
    if (context.assistantScope) return;
    const store = context.runtime.store;
    const renewal = Boolean(context.session?.metadata?.renewed_from);
    const write = renewal ? store.writeMetadataValueForRenewal.bind(store) : store.writeMetadataValue.bind(store);
    const mutate = renewal ? store.mutateSessionForRenewal.bind(store) : store.mutateSession.bind(store);
    await mutate(context.sessionId, async () => {
      for (const [name, value] of Object.entries(values)) {
        if (value === null) await store.deleteMetadataValue(context.sessionId, name);
        else await write(context.sessionId, name, String(value));
      }
    });
    context.session.metadata ||= {};
    Object.assign(context.session.metadata, values);
    for (const [name, value] of Object.entries(values)) {
      if (value === null) delete context.session.metadata[name];
    }
  }

  function scopedConversationPath(context, id) {
    return path.join(context.assistantScope.runtimeRoot, "claude-conversations", context.sessionId, `${id}.json`);
  }
  async function save(entry) {
    const state = {
      executionId: entry.process?.executionId || entry.executionId || "",
      accountIdentity: entry.accountIdentity, accountIdentities: entry.accountIdentities, sent: entry.sent, state: entry.turn?.state || "ready", turnId: entry.turn?.id || "",
      lastMessageId: entry.lastMessageId || "", main: entry.main, persistent: entry.persistent === true, nativeWorkdir: entry.nativeWorkdir || entry.context.workdir
    };
    if (!entry.context.assistantScope) {
      return metadata(entry.context, { [`claude_conversation_${entry.id}`]: JSON.stringify(state) });
    }
    if (!entry.persistent) return;
    const file = scopedConversationPath(entry.context, entry.id);
    const contents = JSON.stringify({ schemaVersion: 1, ...state });
    const saving = (entry.saving || Promise.resolve()).then(async () => {
      await mkdir(path.dirname(file), { recursive: true, mode: 0o700 });
      const temporary = `${file}.${randomUUID()}.tmp`;
      try {
        await writeFile(temporary, contents, { mode: 0o600 });
        await rename(temporary, file);
      } finally { await rm(temporary, { force: true }); }
    });
    entry.saving = saving.catch(() => {});
    await saving;
  }

  return {
    metadata,
    projectContextRoot: entry => entry.context.runtime.projectContextRoot || entry.context.workdir,
    modelProviderId: entry => entry.context.selection.modelProviderId,
    readSessionConversations(ctx) {
      const records = session => ({
        get context() { return { ...ctx, session }; },
        ids: Object.entries(session?.metadata || {})
          .filter(([key, value]) => key.startsWith("claude_conversation_") && key !== "claude_conversation_id" && value)
          .map(([key]) => key.slice("claude_conversation_".length))
      });
      // A deleted conversation must not be restored from a captured old snapshot.
      return ctx.assistantScope ? records(null)
        : Promise.resolve(ctx.runtime.getSession(ctx.sessionId, { inspectSource: false })).then(records);
    },
    select(ctx, id) {
      // Restoring a retained entry is not a main-chat changeover. Only a main
      // operation selects Claude, including when restoration already cached it.
      const identity = { claude_conversation_id: id, agent_identity_conversation_id: id,
        agent_identity_provider: ENGINE, agent_identity_resume_strategy: "provider-native",
        agent_identity_status: "ready", agent_identity_workdir: ctx.workdir,
        agent_transport_id: TRANSPORT, agent_transport_kind: "stream-json" };
      if (Object.entries(identity).some(([name, value]) => ctx.session?.metadata?.[name] !== value)) {
        return metadata(ctx, identity);
      }
    },
    read(ctx, id) {
      if (!ctx.assistantScope) return ctx.session?.metadata?.[`claude_conversation_${id}`];
      return (async () => {
        try {
          const saved = await readFile(scopedConversationPath(ctx, id), "utf8");
          if (JSON.parse(saved).schemaVersion !== 1) throw error("This retained Claude conversation needs a compatible Vibe64 release.");
          return saved;
        } catch (failure) { if (failure.code !== "ENOENT") throw failure; }
      })();
    },
    save,
    async remove(entry) {
      await metadata(entry.context, { [`claude_conversation_${entry.id}`]: null });
      if (entry.context.assistantScope) {
        await entry.saving;
        await rm(scopedConversationPath(entry.context, entry.id), { force: true });
      }
    },
    hasMessage: (ctx, messageId) => ctx.runtime.store.conversationMessageIdExists(ctx.sessionId, messageId)
  };
}

export { createClaudeConversationStorage };
