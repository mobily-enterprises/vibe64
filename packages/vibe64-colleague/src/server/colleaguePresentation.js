/**
 * What Colleague shows a person's browsers: the history and streaming views of
 * a thread's record and its watches, and the observer and connection handles
 * it releases or answers.
 * A browser observer has release() once its conversation subscription is attached.
 */
function releaseObserver(observer) {
  if (observer.release) observer.release();
}
/**
 * A browser connection has acknowledge() only while a navigation waits for it.
 */
function answerPendingNavigation(connection, result) {
  if (connection.acknowledge) connection.acknowledge(result);
}
function publicWatch({ cursor, ...watch }) {
  return structuredClone(watch);
}
// The system notice before an autonomous reply to a watch (a conversation or
// another watch source). Turns saved before it was worded for every watch keep theirs.
const WATCH_UPDATE_NOTICE = "An update from what you asked Colleague to watch.";
const WATCH_UPDATE_NOTICES = new Set([WATCH_UPDATE_NOTICE, "An update from your watched conversations."]);
/**
 * A watch notice stays only beside the reply it introduced.
 */
function keepsWatchNotice(turn, runtime) {
  if (runtime) return runtime.origin === "application" && runtime.status === "complete";
  return turn.messages.some(item => item.role === "assistant" && item.text?.trim());
}
function colleagueHistoryMessages(turn) {
  const runtime = turn.metadata?.runtime;
  if (runtime?.origin === "application" && runtime.completedEnvelope === true) return [];
  return turn.messages.flatMap(message => {
    if (message.role === "system") {
      if (!WATCH_UPDATE_NOTICES.has(message.text) || !keepsWatchNotice(turn, runtime)) return [];
      // The original notice is presentation, never the wake's private data.
      return [{ messageId: message.messageId, role: message.role, text: message.text, at: message.at }];
    }
    return message.role === "user" || !runtime || runtime.status === "complete" ? [message] : [];
  });
}
function colleagueBrowserState(current) {
  // Preserve Colleague's existing history visibility. Internal prompts and tool
  // receipts stay in the canonical store; the browser receives presentation.
  const conversationLog = current.conversationLog.flatMap(turn => {
    const messages = colleagueHistoryMessages(turn);
    if (!messages.length) return [];
    const runtime = turn.metadata?.runtime;
    const system = messages.find(message => message.role === "system");
    return [{ turnId: turn.turnId, messages,
      ...(system ? { system } : {}),
      user: messages.find(message => message.role === "user") || null,
      assistant: messages.find(message => message.role === "assistant") || null,
      thinking: messages.filter(message => message.role === "thinking"),
      commentary: messages.filter(message => message.role === "commentary"),
      ...(runtime ? { metadata: { runtime: { status: runtime.status, origin: runtime.origin } } } : {}) }];
  });
  const { configuration, ...state } = current;
  return { ...state, conversationLog,
    pendingRequest: current.pendingRequest?.origin === "application" ? null : current.pendingRequest,
    streaming: colleagueBrowserStream(current.streaming) };
}
/**
 * A streamed partial may end halfway through a surrogate pair.
 */
const trimIncompleteSurrogate = text => text.replace(/[\uD800-\uDBFF]$/, "");
function colleagueBrowserStream(streaming) {
  return streaming ? { ...streaming, messages: streaming.messages.filter(message =>
    message.completedEnvelope !== true && (message.origin !== "application" || message.role !== "commentary")).map(message =>
    message.status === "inProgress" ? { ...message, text: trimIncompleteSurrogate(message.text) } : message) } : streaming;
}

export {
  WATCH_UPDATE_NOTICE,
  answerPendingNavigation,
  colleagueBrowserState,
  colleagueBrowserStream,
  colleagueHistoryMessages,
  publicWatch,
  releaseObserver,
  trimIncompleteSurrogate
};
