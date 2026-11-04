// Source explanations as the editor shows them: server records normalized into
// one shape, and the local record and messages shown while an answer streams.
import { vibe64AgentExecutionProfileAuditSnapshot } from "@local/vibe64-runtime/shared";
import { normalizeSourceEditorPath } from "@/lib/vibe64SourceEditorLinks.js";

// readable-check: allow module-state - shared resource: every source editor on the page draws explanation and message ids from one sequence, so two editors open at once never issue the same id in the same millisecond
let sourceExplanationClientIdCounter = 0;

function normalizeExplanationEntry(entry, { status } = {}) {
  return {
    createdAt: String(entry?.createdAt || ""),
    id: String(entry?.id || ""),
    role: String(entry?.role || ""),
    ...(status === undefined ? {} : { status }),
    text: String(entry?.text || "")
  };
}

function explanationEntryVisible(entry) {
  return Boolean(entry.id && ["assistant", "user"].includes(entry.role) && entry.text);
}

function normalizeExplanationMessages(value = [], {
  body = "",
  followups = []
} = {}) {
  const messages = (Array.isArray(value) ? value : [])
    .map((entry) => normalizeExplanationEntry(entry, { status: String(entry?.status || "complete") }))
    .filter((entry) => entry.id && ["assistant", "user"].includes(entry.role) && (entry.text || entry.status !== "complete"));
  if (messages.length) {
    return messages;
  }
  const fallback = [];
  if (String(body || "").trim()) {
    fallback.push({
      createdAt: "",
      id: "body",
      role: "assistant",
      status: "complete",
      text: String(body || "")
    });
  }
  return [
    ...fallback,
    ...(Array.isArray(followups) ? followups : [])
      .map((entry) => normalizeExplanationEntry(entry, { status: "complete" }))
      .filter(explanationEntryVisible)
  ];
}

function normalizeExplanationExecutionProfile(value = null) {
  try {
    return vibe64AgentExecutionProfileAuditSnapshot(value);
  } catch {
    return null;
  }
}

function normalizeExplanation(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const sourceRange = value.sourceRange && typeof value.sourceRange === "object" && !Array.isArray(value.sourceRange)
    ? value.sourceRange
    : {};
  const id = String(value.id || "").trim();
  if (!id) {
    return null;
  }
  const followups = (Array.isArray(value.followups) ? value.followups : [])
    .map((entry) => normalizeExplanationEntry(entry))
    .filter(explanationEntryVisible);
  return {
    agentThreadId: String(value.agentThreadId || ""),
    agentTurnId: String(value.agentTurnId || ""),
    body: String(value.body || ""),
    createdAt: String(value.createdAt || ""),
    engine: String(value.engine || ""),
    error: String(value.error || ""),
    executionProfile: normalizeExplanationExecutionProfile(value.executionProfile),
    followups,
    id,
    messages: normalizeExplanationMessages(value.messages, {
      body: value.body,
      followups
    }),
    model: String(value.model || ""),
    sourceRange: {
      endColumn: Math.max(1, Number(sourceRange.endColumn || 1)),
      endLine: Math.max(1, Number(sourceRange.endLine || 1)),
      language: String(sourceRange.language || ""),
      path: normalizeSourceEditorPath(sourceRange.path),
      scope: String(sourceRange.scope || "selection"),
      ...(sourceRange.presentation ? { presentation: sourceRange.presentation } : {}),
      ...(sourceRange.fileHash ? { fileHash: String(sourceRange.fileHash) } : {}),
      ...(sourceRange.symbolId ? { symbolId: String(sourceRange.symbolId) } : {}),
      startColumn: Math.max(1, Number(sourceRange.startColumn || 1)),
      startLine: Math.max(1, Number(sourceRange.startLine || 1))
    },
    stale: value.stale === true,
    staleReason: String(value.staleReason || ""),
    status: String(value.status || ""),
    summary: String(value.summary || ""),
    title: String(value.title || "")
  };
}

function sourceEditorClientId(prefix = "id") {
  sourceExplanationClientIdCounter += 1;
  return `${prefix}_${Date.now().toString(36)}_${sourceExplanationClientIdCounter.toString(36)}`;
}

function nowIso() {
  return new Date().toISOString();
}

function sourceEditorExplanationPromptText(filePath = "", range = {}) {
  return range.scope === "file"
    ? `Explain the whole file ${filePath}.`
    : `Explain ${filePath}:${range.startLine}-${range.endLine}.`;
}

function sourceEditorExplanationTitle(filePath = "", range = {}) {
  const name = normalizeSourceEditorPath(filePath).split("/").filter(Boolean).pop() || "Code";
  return range.scope === "file"
    ? `${name} full file`
    : `${name} lines ${range.startLine}-${range.endLine}`;
}

function localSourceExplanation({
  assistantMessageId = sourceEditorClientId("msg"),
  explanationId = sourceEditorClientId("exp"),
  filePath = "",
  range = {},
  userMessageId = sourceEditorClientId("msg")
} = {}) {
  const createdAt = nowIso();
  const sourceRange = {
    endColumn: Math.max(1, Number(range.endColumn || 1)),
    endLine: Math.max(1, Number(range.endLine || 1)),
    language: String(range.language || ""),
    path: normalizeSourceEditorPath(filePath),
    scope: String(range.scope || "selection"),
    ...(range.presentation ? { presentation: range.presentation } : {}),
    ...(range.symbolId ? { symbolId: range.symbolId } : {}),
    startColumn: Math.max(1, Number(range.startColumn || 1)),
    startLine: Math.max(1, Number(range.startLine || 1))
  };
  return normalizeExplanation({
    agentThreadId: "",
    agentTurnId: "",
    body: "",
    createdAt,
    engine: "agent-chat",
    error: "",
    executionProfile: null,
    followups: [],
    id: explanationId,
    messages: [
      {
        createdAt,
        id: userMessageId,
        role: "user",
        status: "complete",
        text: sourceEditorExplanationPromptText(filePath, sourceRange)
      },
      {
        createdAt,
        id: assistantMessageId,
        role: "assistant",
        status: "thinking",
        text: ""
      }
    ],
    model: "",
    sourceRange,
    status: "running",
    summary: "",
    title: sourceEditorExplanationTitle(filePath, sourceRange)
  });
}

function sourceEditorExplanationWithMessage(explanation = null, messageId = "", patch = {}) {
  const normalized = normalizeExplanation(explanation);
  if (!normalized) {
    return null;
  }
  const messages = normalizeExplanationMessages(normalized.messages);
  const index = messages.findIndex((message) => message.id === messageId);
  if (index === -1) {
    return normalized;
  }
  const nextMessages = [...messages];
  nextMessages[index] = {
    ...nextMessages[index],
    ...patch
  };
  return {
    ...normalized,
    messages: normalizeExplanationMessages(nextMessages)
  };
}

function appendSourceEditorExplanationMessages(explanation = null, messages = []) {
  const normalized = normalizeExplanation(explanation);
  if (!normalized) {
    return null;
  }
  return {
    ...normalized,
    messages: normalizeExplanationMessages([
      ...normalized.messages,
      ...messages
    ])
  };
}

export {
  appendSourceEditorExplanationMessages,
  localSourceExplanation,
  normalizeExplanation,
  nowIso,
  sourceEditorClientId,
  sourceEditorExplanationWithMessage
};
