import {
  isPlainObject,
  normalizeText
} from "@local/vibe64-core/server/core";

const CODEX_APP_SERVER_CONTEXT_COMPACTION_SIGNALS = new Set(
  ["context", "thread", "conversation"].flatMap((subject) => (
    ["compact", "compacted", "compaction", "truncate", "truncated", "truncation"]
      .flatMap((state) => [`${subject}_${state}`, `${state}_${subject}`])
  ))
);
const CODEX_APP_SERVER_CONTEXT_REFRESH_SIGNALS = new Set([
  "context_refresh_required",
  "context_refresh_needed",
  "context_refresh_pending"
]);

function codexAppServerStatusFromValue(status = null) {
  if (typeof status === "string") {
    const normalized = normalizeText(status);
    if (normalized === "active") {
      return "inProgress";
    }
    if (normalized === "idle" || normalized === "notLoaded") {
      return "completed";
    }
    if (normalized === "systemError") {
      return "failed";
    }
    return normalized;
  }
  if (!isPlainObject(status)) {
    return "";
  }
  const type = normalizeText(status.type);
  if (type === "active") {
    return "inProgress";
  }
  if (type === "idle" || type === "notLoaded" || type === "completed") {
    return "completed";
  }
  if (type === "systemError" || type === "failed") {
    return "failed";
  }
  if (type === "interrupted") {
    return "interrupted";
  }
  return type;
}

function codexAppServerNotificationParams(notification = {}) {
  return isPlainObject(notification?.params) ? notification.params : {};
}

function codexAppServerNotificationEvent(notification = {}) {
  const method = normalizeText(notification.method);
  const params = codexAppServerNotificationParams(notification);
  const candidates = [
    params.event,
    params.msg,
    params.entry,
    params.record,
    notification.event,
    notification.msg,
    notification.entry,
    notification.record
  ];
  for (const candidate of candidates) {
    if (isPlainObject(candidate)) {
      return candidate;
    }
  }
  if (isPlainObject(params.payload) || normalizeText(params.type)) {
    return params;
  }
  if (isPlainObject(notification.payload) || normalizeText(notification.type)) {
    return notification;
  }
  if (["event_msg", "response_item", "task_complete"].includes(method) && isPlainObject(params)) {
    return params;
  }
  return null;
}

function codexAppServerNotificationEventType(notification = {}, event = null) {
  const params = codexAppServerNotificationParams(notification);
  return normalizeText(event?.type || params.type || notification.type || notification.method);
}

function codexAppServerNotificationEventPayload(notification = {}, event = null) {
  if (isPlainObject(event?.payload)) {
    return event.payload;
  }
  const params = codexAppServerNotificationParams(notification);
  if (isPlainObject(params.payload)) {
    return params.payload;
  }
  if (isPlainObject(notification.payload)) {
    return notification.payload;
  }
  return isPlainObject(event) ? event : {};
}

function codexAppServerNotificationItem(notification = {}) {
  const item = codexAppServerNotificationParams(notification).item;
  return isPlainObject(item) ? item : null;
}

function codexAppServerNotificationThreadId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  return normalizeText(
    params.threadId ||
    params.thread_id ||
    params.thread?.id ||
    event?.threadId ||
    event?.thread_id ||
    payload.threadId ||
    payload.thread_id
  );
}

function codexAppServerNotificationTurnId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  const item = codexAppServerNotificationItem(notification);
  return normalizeText(
    params.turnId ||
    params.turn_id ||
    params.turn?.id ||
    event?.turnId ||
    event?.turn_id ||
    payload.turnId ||
    payload.turn_id ||
    item?.turnId ||
    item?.turn_id
  );
}

function codexAppServerNotificationTurnStatus(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const turnStatus = normalizeText(params.turn?.status);
  return turnStatus || codexAppServerStatusFromValue(params.status);
}

function codexAppServerErrorText(value = null) {
  if (!value) {
    return "";
  }
  if (typeof value === "string") {
    return normalizeText(value);
  }
  if (!isPlainObject(value)) {
    return "";
  }
  return normalizeText(value.message || value.error || value.reason || value.code);
}

function codexAppServerNotificationError(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const status = isPlainObject(params.status) ? params.status : {};
  const turn = isPlainObject(params.turn) ? params.turn : {};
  return normalizeText(
    codexAppServerErrorText(params.error) ||
    params.message ||
    codexAppServerErrorText(status.error) ||
    status.message ||
    codexAppServerErrorText(turn.error) ||
    turn.message
  );
}

function codexAppServerTextInputText(input = {}) {
  if (!isPlainObject(input) || normalizeText(input.type) !== "text") {
    return "";
  }
  return normalizeText(input.text);
}

function codexAppServerUserMessageText(item = {}) {
  if (!isPlainObject(item) || normalizeText(item.type) !== "userMessage") {
    return "";
  }
  return (Array.isArray(item.content) ? item.content : [])
    .map((input) => codexAppServerTextInputText(input))
    .filter(Boolean)
    .join("\n\n");
}

function codexAppServerContentText(value = null) {
  if (typeof value === "string") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((entry) => codexAppServerContentText(entry)).filter(Boolean).join("");
  }
  if (!isPlainObject(value)) {
    return "";
  }
  if (typeof value.text === "string") {
    return value.text;
  }
  if (typeof value.value === "string") {
    return value.value;
  }
  if (typeof value.content === "string" || Array.isArray(value.content)) {
    return codexAppServerContentText(value.content);
  }
  if (typeof value.message === "string" || Array.isArray(value.message)) {
    return codexAppServerContentText(value.message);
  }
  if (isPlainObject(value.message)) {
    return codexAppServerContentText(value.message.content || value.message.text);
  }
  return "";
}

function codexAppServerAssistantItemText(item = {}) {
  if (!isPlainObject(item)) {
    return "";
  }
  const type = normalizeText(item.type);
  const role = normalizeText(item.role || item.author?.role);
  const isAssistant = role === "assistant" ||
    type === "agentMessage" ||
    type === "assistantMessage" ||
    type === "assistant_message" ||
    type === "outputMessage" ||
    type === "message" && role === "assistant";
  if (!isAssistant) {
    return "";
  }
  return normalizeText(
    codexAppServerContentText(item.content) ||
    codexAppServerContentText(item.text) ||
    codexAppServerContentText(item.message)
  );
}

function codexAppServerNotificationItemId(notification = {}) {
  const params = codexAppServerNotificationParams(notification);
  const item = codexAppServerNotificationItem(notification);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  return normalizeText(
    item?.id ||
    params.itemId ||
    params.item_id ||
    event?.itemId ||
    event?.item_id ||
    payload.itemId ||
    payload.item_id
  );
}

function codexAppServerFinalEventText(notification = {}, event = null, payload = {}) {
  const eventType = codexAppServerNotificationEventType(notification, event);
  const payloadType = normalizeText(payload.type);
  const phase = normalizeText(payload.phase || event?.phase);
  if (eventType === "task_complete") {
    return normalizeText(
      codexAppServerContentText(payload.last_agent_message) ||
      codexAppServerContentText(payload.lastAgentMessage)
    );
  }
  if (eventType === "event_msg" && payloadType === "agent_message" && phase === "final_answer") {
    return normalizeText(
      codexAppServerContentText(payload.message) ||
      codexAppServerContentText(payload.text) ||
      codexAppServerContentText(payload.content)
    );
  }
  if (eventType === "response_item" && phase === "final_answer") {
    return codexAppServerAssistantItemText(payload);
  }
  return "";
}

function classifyCodexAppServerEvent(notification = {}) {
  const method = normalizeText(notification.method);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  const eventType = event ? codexAppServerNotificationEventType(notification, event) : "";
  const payloadType = normalizeText(payload.type);
  const item = codexAppServerNotificationItem(notification);
  const itemType = normalizeText(item?.type);
  const itemText = codexAppServerAssistantItemText(item);
  const phase = normalizeText(payload.phase || event?.phase || item?.phase || item?.purpose || item?.category);
  const base = {
    itemId: codexAppServerNotificationItemId(notification),
    source: method || eventType || "notification",
    text: "",
    threadId: codexAppServerNotificationThreadId(notification),
    turnId: codexAppServerNotificationTurnId(notification)
  };

  if (method === "item/reasoning/summaryPartAdded" || method === "item/reasoning/summaryTextDelta") {
    return {
      ...base,
      kind: "reasoning_summary",
      text: normalizeText(codexAppServerContentText(codexAppServerNotificationParams(notification).delta))
    };
  }

  const finalEventText = event ? codexAppServerFinalEventText(notification, event, payload) : "";
  if (finalEventText) {
    return {
      ...base,
      kind: "final_assistant_result",
      source: eventType,
      text: finalEventText
    };
  }

  if (method === "item/completed" && itemType === "userMessage") {
    return {
      ...base,
      kind: "terminal_user_message",
      text: codexAppServerUserMessageText(item)
    };
  }

  if (method === "item/completed" && itemText) {
    return phase === "final_answer"
      ? {
          ...base,
          kind: "final_assistant_result",
          source: "item",
          text: itemText
        }
      : {
          ...base,
          kind: "live_progress",
          source: "item",
          text: itemText
        };
  }

  if (eventType === "event_msg" && payloadType === "agent_message") {
    if (!phase) {
      return {
        ...base,
        kind: "ignored",
        source: eventType
      };
    }
    return {
      ...base,
      kind: "live_progress",
      source: eventType,
      text: normalizeText(
        codexAppServerContentText(payload.message) ||
        codexAppServerContentText(payload.text) ||
        codexAppServerContentText(payload.content)
      )
    };
  }

  if (eventType === "response_item") {
    if (!phase) {
      return {
        ...base,
        kind: "ignored",
        source: eventType
      };
    }
    return {
      ...base,
      kind: "live_progress",
      source: eventType,
      text: codexAppServerAssistantItemText(payload)
    };
  }

  if (method === "turn/started" || method === "turn/completed" || method === "thread/status/changed") {
    return {
      ...base,
      kind: "status",
      text: codexAppServerNotificationTurnStatus(notification)
    };
  }

  return {
    ...base,
    kind: "ignored"
  };
}

function codexAppServerSignalName(value = "") {
  return normalizeText(value)
    .toLowerCase()
    .replaceAll("-", "_")
    .replaceAll("/", "_");
}

function codexAppServerSignalNames(value = null) {
  if (!value) {
    return [];
  }
  if (typeof value === "string") {
    return [codexAppServerSignalName(value)].filter(Boolean);
  }
  if (Array.isArray(value)) {
    return value.flatMap((entry) => codexAppServerSignalNames(entry));
  }
  if (!isPlainObject(value)) {
    return [];
  }
  return [
    value.type,
    value.event,
    value.kind,
    value.reason,
    value.code,
    value.status,
    value.phase,
    value.name
  ].map((signal) => codexAppServerSignalName(signal)).filter(Boolean);
}

function codexAppServerContextRefreshReason(notification = {}) {
  const method = normalizeText(notification.method);
  const event = codexAppServerNotificationEvent(notification);
  const payload = codexAppServerNotificationEventPayload(notification, event);
  const eventType = codexAppServerNotificationEventType(notification, event);
  const payloadType = normalizeText(payload.type);
  const signals = [
    method,
    eventType,
    payloadType,
    ...codexAppServerSignalNames(payload),
    ...codexAppServerSignalNames(event)
  ].map((signal) => codexAppServerSignalName(signal)).filter(Boolean);

  if (signals.some((signal) => CODEX_APP_SERVER_CONTEXT_COMPACTION_SIGNALS.has(signal))) {
    return "context_compacted";
  }
  if (signals.some((signal) => CODEX_APP_SERVER_CONTEXT_REFRESH_SIGNALS.has(signal))) {
    return "context_refresh_required";
  }
  return "";
}

function codexAppServerProviderThread(value = {}) {
  if (isPlainObject(value?.raw)) {
    return value.raw;
  }
  if (isPlainObject(value?.response?.thread)) {
    return value.response.thread;
  }
  if (isPlainObject(value?.thread)) {
    return value.thread;
  }
  return isPlainObject(value) ? value : {};
}

function codexAppServerProviderTurnId(turn = {}) {
  return normalizeText(turn.id || turn.turnId || turn.turn_id || turn.turn?.id);
}

function codexAppServerProviderTurnItems(turn = {}) {
  return [
    ...(Array.isArray(turn.items) ? turn.items : []),
    ...(Array.isArray(turn.itemsView) ? turn.itemsView : [])
  ].filter(isPlainObject);
}

function codexAppServerProviderThreadTurn(value = {}, turnId = "") {
  const normalizedTurnId = normalizeText(turnId);
  if (!normalizedTurnId) {
    return null;
  }
  const thread = codexAppServerProviderThread(value);
  return (Array.isArray(thread.turns) ? thread.turns : [])
    .find((turn) => codexAppServerProviderTurnId(turn) === normalizedTurnId) || null;
}

function codexAppServerProviderTurnAssistantSegments(turn = {}) {
  const seenItemIds = new Set();
  return codexAppServerProviderTurnItems(turn)
    .filter((item) => {
      const phase = normalizeText(item.phase);
      return !phase || phase === "final_answer";
    })
    .map((item) => {
      const itemId = normalizeText(item.id);
      const text = codexAppServerAssistantItemText(item);
      if (!itemId || !text || seenItemIds.has(itemId)) {
        return null;
      }
      seenItemIds.add(itemId);
      return {
        itemId,
        text
      };
    })
    .filter(Boolean);
}

function codexAppServerProviderThreadAssistantSegments(value = {}, turnId = "") {
  const turn = codexAppServerProviderThreadTurn(value, turnId);
  return turn ? codexAppServerProviderTurnAssistantSegments(turn) : [];
}

export {
  classifyCodexAppServerEvent,
  codexAppServerAssistantItemText,
  codexAppServerContentText,
  codexAppServerContextRefreshReason,
  codexAppServerErrorText,
  codexAppServerNotificationError,
  codexAppServerNotificationEvent,
  codexAppServerNotificationEventPayload,
  codexAppServerNotificationEventType,
  codexAppServerNotificationItem,
  codexAppServerNotificationItemId,
  codexAppServerNotificationParams,
  codexAppServerNotificationThreadId,
  codexAppServerNotificationTurnId,
  codexAppServerNotificationTurnStatus,
  codexAppServerProviderThreadAssistantSegments,
  codexAppServerStatusFromValue,
  codexAppServerUserMessageText
};
