import { conversationTurnsFromMessages } from "@jskit-ai/assistant-core/shared/conversation";
import { temporaryConversationTarget } from "@local/vibe64-sessions/shared/conversation";

export function temporaryRequestBody(options = {}) {
  const body = options.body || {};
  return Object.hasOwn(body, "text") ? { ...body.data, message: body.text, messageId: body.messageId,
    ...(Object.hasOwn(body, "attachmentIds") ? { attachmentIds: body.attachmentIds } : {}),
    submissionKind: body.steer === true ? "steer" : "send" } : body;
}

export function temporaryCanonicalPath(conversationId, { projectSlug = "project-a", sessionId = "session-1" } = {}) {
  return `/api/assistant/app/conversations/${encodeURIComponent(`vibe64-temporary:${JSON.stringify([projectSlug, sessionId, conversationId])}`)}`;
}

// The original fixtures supply service records/results. This HTTP/socket
// boundary projects them into the real, now-shared browser protocol; the actual
// binding owns all subscription, delivery, read and lifetime behavior.
export function createTemporaryConversationFixture({ request, created = () => {} } = {}) {
  const records = new Map();
  const sockets = new Set();
  const writes = [];
  const get = id => records.get(id) || { conversationId: id, status: "ready", messages: [] };
  function observe(id, value = {}, submitted) {
    const previous = get(id);
    const record = { ...previous, ...value, conversationId: id };
    if (submitted && value.ok !== false) {
      record.messageId = submitted.messageId;
      record.status = value.status || "inProgress";
      const authored = { id: submitted.messageId, role: "user", text: submitted.displayMessage || submitted.message,
        attachments: submitted.displayAttachments || [], status: "completed" };
      record.messages = value.messages || [...(previous.messages || []).filter(message => message.id !== submitted.messageId), authored];
    }
    if (!value.messages && (value.text || value.message || value.rawText || value.progressUpdates)) {
      const id = `fixture-native:${record.runId || "turn"}`;
      const message = { id, role: "assistant", text: value.text || value.message || value.rawText || "",
        progressUpdates: value.progressUpdates || [], runId: record.runId, status: record.status };
      record.messages = [...(record.messages || []).filter(row => row.id !== id), message];
    }
    records.set(id, record);
    return record;
  }
  function snapshot(id) {
    const record = get(id);
    const route = JSON.parse(record.routingMetadata?.assistant_routing_request || "null");
    const pendingRequest = route?.status === "uncertain" ? { messageId: route.messageId,
      text: route.input?.displayMessage || route.input?.message || "", error: route.error || "" } : null;
    return { id, segmentId: record.runId ? `fixture:${id}` : null,
      status: record.readError ? "unavailable" : pendingRequest ? "unconfirmed"
        : ["starting", "inProgress", "routing", "sending"].includes(record.status) ? "working" : "ready",
      capabilities: { attachments: true, steering: true, goals: false },
      conversationLog: conversationTurnsFromMessages(record.messages || []),
      pagination: { limit: 12, hasMoreBefore: false }, presentation: record, pendingRequest,
      streaming: { revision: 0, messages: [] }, error: record.error || "" };
  }
  function notify(event = { type: "phase" }, id = "") {
    for (const socket of sockets) socket.notify(event, id);
  }
  function publish(record) {
    observe(record.conversationId, record);
    notify({ type: "phase" }, record.conversationId);
  }
  function publishTranscript(id) {
    for (const turn of snapshot(id).conversationLog) notify({ type: "transcript", patch: { type: "upsert-turn", turn } }, id);
  }
  function attach(socket) {
    const emit = socket.emit.bind(socket);
    const subscriptions = new Map();
    socket.connected = true;
    socket.timeout = () => socket;
    socket.emit = (name, input, acknowledge) => {
      if (name === "assistant.conversation.unsubscribe") { subscriptions.delete(input.subscriptionId); return socket; }
      if (name !== "assistant.conversation.subscribe") return emit(name, input, acknowledge);
      const target = temporaryConversationTarget(input.conversationId);
      const subscription = { ...input, id: target.conversationId, epoch: crypto.randomUUID(), revision: 0 };
      subscriptions.set(input.subscriptionId, subscription);
      acknowledge(null, { ok: true, streamEpoch: subscription.epoch, state: snapshot(target.conversationId) });
      // The original running fixture supplies its next native progress read.
      // A real native event invalidates the same supplied reader; no poll timer.
      if (["starting", "inProgress", "routing", "sending"].includes(get(target.conversationId).status)) {
        queueMicrotask(() => socket.notify({ type: "phase" }, target.conversationId));
      }
      return socket;
    };
    socket.notify = (event = { type: "phase" }, id = "") => {
      for (const subscription of subscriptions.values()) {
        if (id && id !== subscription.id) continue;
        emit("assistant.conversation.event", { conversationId: subscription.conversationId, subscriptionId: subscription.subscriptionId,
          streamEpoch: subscription.epoch, streamRevision: ++subscription.revision, event });
      }
    };
    sockets.add(socket);
    return socket;
  }
  async function handle(url, options = {}) {
    const canonical = /^\/api\/assistant\/app\/conversations\/([^/?]+)(.*)$/.exec(url);
    const target = canonical ? temporaryConversationTarget(decodeURIComponent(canonical[1])) : null;
    const suffix = canonical?.[2] || "";
    const input = temporaryRequestBody(options);
    const response = await request(url, options);
    if (target) {
      writes.push([url, options]);
      const id = target.conversationId;
      if (options.method === "GET") {
        if (response?.ok === false) throw Object.assign(new Error(response.error), response);
        const value = response?.conversations ? {} : response || {};
        observe(id, value);
        return snapshot(id);
      }
      if (suffix === "/messages") {
        observe(id, response?.ok === false ? { ...response, status: response.status || "failed" } : response || {}, response?.ok === false ? null : input);
        if (response?.ok !== false) publishTranscript(id);
        return Object.fromEntries(["ok", "delivered", "messageId", "status", "error", "code", "retryable", "refreshRecommended", "assistantRoutingRequest"]
          .filter(key => Object.hasOwn(response || {}, key)).map(key => [key, response[key]]));
      }
      if (suffix === "/cancel") {
        if (response?.ok !== false) observe(id, { ...response, status: "interrupted", error: "" });
        return response;
      }
      if (suffix.startsWith("/deliveries/")) {
        if (response?.ok === false) throw Object.assign(new Error(response.error), response);
        const messageId = decodeURIComponent(suffix.split("/")[2]);
        if (response?.status === "accepted" || response?.delivered === true || response?.messages?.some(message => message.id === messageId && message.receipt !== false)) {
          observe(id, response);
          publishTranscript(id);
          return { status: "accepted", messageId };
        }
        return { status: "unknown", messageId };
      }
      return response;
    }
    if (response?.conversations) for (const record of response.conversations) observe(record.conversationId, record);
    if (options.method === "POST" && /\/temporary-conversations$/.test(url) && response?.ok !== false) {
      const id = options.body.conversationId;
      observe(id, { ...options.body.presentation, agentSettings: options.body.agentSettings, ...response, messages: [] });
      created(id);
      return { ...response, conversationId: id };
    }
    const product = /\/temporary-conversations\/([^/?]+)$/.exec(url);
    if (product && options.method === "PATCH" && response?.ok !== false) {
      observe(decodeURIComponent(product[1]), { ...options.body.presentation,
        ...(options.body.agentSettings ? { agentSettings: options.body.agentSettings } : {}) });
    }
    return response;
  }
  return { request: handle, attach, notify, publish, publishTranscript, observe, snapshot, records, writes };
}
