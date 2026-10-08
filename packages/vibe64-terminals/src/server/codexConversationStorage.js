import path from "node:path";
import { normalizeCodexThreadId } from "@jskit-ai/assistant-core/server/codex-configuration";
import { codexAppServerTurnState as nativeCodexAppServerTurnState } from "@jskit-ai/assistant-core/server/codex-turn";
import { CURATED_CODEX_PROVIDERS } from "@local/vibe64-core/shared/curatedCodexProviders";
import { normalizeVibe64AgentRunState } from "@local/vibe64-runtime/server/sessionStore";
import { codexAppServerThreadIdForSession, codexAppServerToolSchemaIdentityForSession } from "@local/vibe64-runtime/server/codexAppServerSessionBridge";
import { agentTerminalIdentityForWorkdir, agentTerminalIdentityState } from "./agentTerminalIdentity.js";
import { activeCodexTerminal } from "./codexTerminalAccess.js";
import { terminalWorktreePath } from "./terminalShared.js";

const CODEX_AGENT_PROVIDER = "codex";
const CODEX_STATE_METADATA_NAMES = Object.freeze([
  "codex_conversation_id",
  "codex_conversation_workdir",
  "agent_identity_captured_at",
  "agent_identity_conversation_id",
  "agent_identity_error",
  "agent_identity_provider",
  "agent_identity_model_provider",
  "assistant_selection",
  ...CURATED_CODEX_PROVIDERS.flatMap(({ id }) => [`codex_${id}_conversation_id`, `codex_${id}_conversation_workdir`]),
  "agent_identity_resume_strategy",
  "agent_identity_status",
  "agent_identity_terminal_session_id",
  "agent_identity_workdir"
]);

function normalizeText(value) {
  return String(value || "").trim();
}

// Presentation of an admitted native descriptor is separate from source access.
// Starting/reacquiring execution still validates the active root through Runtime.
function nativeStateWorkdir(session) {
  return session?.purpose === "learning" ? session.nativeExecutionRoot || "" : terminalWorktreePath(session);
}

function codexAppServerTurnState(session = {}) {
  return nativeCodexAppServerTurnState(session, normalizeVibe64AgentRunState);
}

function codexState(session = {}, {
  codexTerminal = activeCodexTerminal(session)
} = {}) {
  const workdir = nativeStateWorkdir(session);
  const codexConversationId = codexConversationIdForWorkdir(session, workdir);
  const codexThreadId = normalizeCodexThreadId(codexConversationId);
  const agentIdentity = codexAgentIdentityState(session, workdir);
  const agentTurn = codexAppServerTurnState(session);
  return {
    agentIdentity,
    codexAgentTurn: agentTurn,
    codexWorkdir: workdir,
    codexTerminal,
    codexThreadId
  };
}

function codexConversationIdForWorkdir(session = {}, workdir = "") {
  return codexAppServerThreadIdForSession(session, workdir) || codexReadyIdentityForWorkdir(session, workdir)?.conversationId || "";
}

function codexThreadIdForWorkdir(session = {}, workdir = "") {
  return normalizeCodexThreadId(codexConversationIdForWorkdir(session, workdir));
}

function codexReadyIdentityForWorkdir(session = {}, workdir = "") {
  const normalizedWorkdir = workdir ? path.resolve(workdir) : terminalWorktreePath(session);
  return agentTerminalIdentityForWorkdir(session, {
    provider: CODEX_AGENT_PROVIDER,
    validateConversationId: normalizeCodexThreadId,
    workdir: normalizedWorkdir
  });
}

function codexAgentIdentityState(session = {}, workdir = "") {
  const normalizedWorkdir = workdir ? path.resolve(workdir) : terminalWorktreePath(session);
  const readyIdentity = codexReadyIdentityForWorkdir(session, workdir);
  if (readyIdentity) {
    return readyIdentity;
  }

  return agentTerminalIdentityState(session, {
    provider: CODEX_AGENT_PROVIDER,
    validateConversationId: normalizeCodexThreadId,
    workdir: normalizedWorkdir
  });
}

function withCodexState(response = {}, session = {}) {
  return {
    ...response,
    ...codexState(session)
  };
}

// Read only the original bounded state files. Every read stays fresh; this
// storage projection never creates a session runtime or acquires a provider.
function createCodexConversationStorage({ projectService, runOwner }) {
  const { readAgentRunForSession: readCodexAppServerAgentRunForSession } = runOwner;
  async function readCodexStateSession(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    const store = await projectService.createSessionStore({ sessionId: normalizedSessionId });
    const [
      sourceDescriptor,
      run,
      metadataEntries
    ] = await Promise.all([
      store.learningScope ? store.readSessionNativeDescriptor(normalizedSessionId)
        : store.readSessionSourceDescriptor(normalizedSessionId),
      readCodexAppServerAgentRunForSession(store, normalizedSessionId),
      Promise.all([
        ...CODEX_STATE_METADATA_NAMES,
        ...(store.learningScope ? ["agent_transport_id", "codex_conversation_tool_schema_identity"] : [])
      ].map(async (name) => [
        name,
        await store.readMetadataValue(normalizedSessionId, name)
      ]))
    ]);
    return {
      ...sourceDescriptor,
      agentRuns: run ? [run] : [],
      metadata: {
        ...(sourceDescriptor?.metadata || {}),
        ...Object.fromEntries(metadataEntries)
      }
    };
  }

  function state(sessionId) {
    return {
      async readIdentity() {
        const current = await readCodexStateSession(sessionId);
        return codexThreadIdForWorkdir(current, nativeStateWorkdir(current));
      },
      async readToolSchemaIdentity() {
        const current = await readCodexStateSession(sessionId);
        return codexAppServerToolSchemaIdentityForSession(current, nativeStateWorkdir(current));
      },
      async read() {
        const current = await readCodexStateSession(sessionId);
        return { session: current,
          get threadId() { return codexThreadIdForWorkdir(current, nativeStateWorkdir(current)); },
          get run() { return current.agentRuns[0] || null; },
          get nativeResult() { return { ok: true, sessionId, sessionUpdated: false, ...codexState(current) }; } };
      }
    };
  }

  return { readSession: readCodexStateSession, state };
}

export {
  codexAppServerTurnState,
  codexConversationIdForWorkdir,
  codexThreadIdForWorkdir,
  createCodexConversationStorage,
  withCodexState
};
