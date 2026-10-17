import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";

const shortText = { type: "string", maxLength: 256, required: false };
export const ACTION_PAUSE_MAIN_GOAL = "vibe64.terminals.main-goal.pause";
export const mainGoalPauseTool = Object.freeze({
  description: "Pause this Main conversation's current goal only when the human explicitly requests Pause, including pausing at a safe checkpoint. Finish the requested checkpoint and drain delegated work first. Invoke this operation instead of merely saying the goal is paused. It stops this turn and retains the unfinished goal; automatic restart recovery will not resume it. Do not use it for ordinary background work, missing prerequisites or an unfinished goal without a human pause request. The application supplies the exact current session and goal; do not supply another target.",
  output: { mode: "replace", schema: createSchema({ status: { type: "string", required: true, enum: ["paused"] } }) }
});
export const ACTION_BLOCK_MAIN_GOAL = "vibe64.terminals.main-goal.block";
export const mainGoalBlockTool = Object.freeze({
  description: "Mark this Main conversation's active goal blocked only when a concrete external prerequisite (such as missing human input, credentials or access) prevents all further useful work. Supply a short reason explaining what must change before Resume. Do not use this for unfinished work, slow checks, or delegated/background agents that are still working: wait for their results. This stops automatic continuation and retains the goal and reason for explicit Resume; it is distinct from the human's Pause. The application supplies the exact current session and goal.",
  output: { mode: "replace", schema: createSchema({ status: { type: "string", required: true, enum: ["blocked"] } }) }
});
const messageSchema = createSchema({
  id: shortText,
  role: shortText,
  text: { type: "string", maxLength: 1600, required: false },
  truncated: { type: "boolean", required: true }
});
const conversationFields = {
  conversationId: shortText,
  title: shortText,
  status: shortText,
  runId: shortText,
  error: shortText,
  readError: { type: "boolean", required: false },
  chatMode: shortText,
  workflowEngineId: shortText,
  reviewEnabled: { type: "boolean", required: false },
  deslopEnabled: { type: "boolean", required: false },
  hasModelOverride: { type: "boolean", required: false },
  messagesTruncated: { type: "boolean", required: true },
  messages: { type: "array", items: messageSchema, required: true }
};
const conversationOutput = {
  mode: "replace",
  schema: createSchema({
    ...conversationFields,
    ok: { type: "boolean", required: true },
    code: shortText,
    deleted: { type: "boolean", required: false },
    conversations: { type: "array", items: createSchema(conversationFields), required: false },
    conversationsTruncated: { type: "boolean", required: false }
  })
};

function summary(result = {}, { includeMessages = true } = {}) {
  const messages = Array.isArray(result.messages) ? result.messages : [];
  const selected = includeMessages ? messages.slice(-12) : [];
  let preferences;
  try { if (result.routingMetadata) preferences = assistantRoutingFromMetadata(result.routingMetadata); }
  catch { /* No verified temporary-chat preferences. */ }
  return {
    ...(preferences ? { chatMode: preferences.mode, workflowEngineId: preferences.workflowEngineId,
      reviewEnabled: preferences.mode === "auto", deslopEnabled: preferences.mode === "auto" && preferences.review,
      hasModelOverride: Boolean(preferences.override) } : {}),
    ...Object.fromEntries(["conversationId", "title", "status", "runId", "error"].flatMap((key) => (
      typeof result[key] === "string" ? [[key, result[key].slice(0, 256)]] : []
    ))),
    ...(result.readError === true ? { readError: true } : {}),
    messagesTruncated: result.earlierMessages === true || messages.length > selected.length || selected.some((message) => String(message.text || "").length > 1600),
    messages: selected.map((message) => ({
      id: String(message.id || message.messageId || "").slice(0, 256),
      role: String(message.role || "").slice(0, 256),
      text: String(message.text || "").slice(0, 1600),
      truncated: String(message.text || "").length > 1600
    }))
  };
}

// Native conversation records contain provider bindings, preferences and
// attachments. Tools return only the public identity, state and bounded text.
function temporaryConversationTool(description) {
  return {
    description,
    output: conversationOutput,
    transformResult(result) {
      return {
        ...summary(result),
        ok: result.ok === true,
        ...(typeof result.code === "string" ? { code: result.code.slice(0, 256) } : {}),
        ...(typeof result.deleted === "boolean" ? { deleted: result.deleted } : {}),
        ...(Array.isArray(result.conversations) ? {
          conversations: result.conversations.slice(0, 40).map((conversation) => summary(conversation, { includeMessages: false })),
          conversationsTruncated: result.conversations.length > 40
        } : {})
      };
    }
  };
}

function workPlanTool() {
  const fields = {
    ok: { type: "boolean", required: true }, available: { type: "boolean", required: false },
    sessionId: shortText, code: shortText, error: { type: "string", maxLength: 1000, required: false },
    progressText: { type: "string", noTrim: true, maxLength: 16000, required: false },
    progressRevision: shortText, artifactRevision: shortText, progressAvailable: { type: "boolean", required: false },
    title: shortText, archiveId: shortText, checked: { type: "integer", required: false }, total: { type: "integer", required: false },
    history: { type: "array", required: false, items: createSchema({ id: shortText, title: shortText, status: shortText, archivedAt: shortText, revision: shortText, progressRevision: shortText, artifactRevision: shortText, progressAvailable: { type: "boolean", required: false }, checked: { type: "integer", required: false }, total: { type: "integer", required: false } }) },
    status: shortText, revision: { type: "string", maxLength: 64, required: false },
    text: { type: "string", noTrim: true, maxLength: 32000, required: false },
    offset: { type: "integer", min: 0, required: false }, nextOffset: { type: "integer", min: 0, required: false },
    totalCharacters: { type: "integer", min: 0, required: false }, hasMore: { type: "boolean", required: false }
  };
  return {
    description: "Read Main chat's paired Plan and Progress without starting AI. Always finish BOTH text and progressText across every page before implementing, reviewing or claiming a complete read. Offset/limit count Unicode characters; pages contain at most 16000. Follow nextOffset while hasMore, passing the first page's revision and progressRevision as expectedRevision and expectedProgressRevision on every later page. If changed, restart the read. Never call a partial page the complete plan. Current and archived plans remain readable after completion. Use archiveId from history to read an archived snapshot. Execute, change, reopen or archive a plan through an explicit chat request; Auto routes by intent. Temporary chats do not support Auto plans.",
    output: { mode: "replace", schema: createSchema(fields) },
    transformResult(result = {}) {
      return Object.fromEntries(Object.entries(result).filter(([key]) => Object.hasOwn(fields, key)));
    }
  };
}

export { temporaryConversationTool, workPlanTool };
