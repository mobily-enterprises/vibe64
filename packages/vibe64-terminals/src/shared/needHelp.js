// Need help: a session's flag that something is wrong which its AI can't fix itself (the platform, a service, access it
// lacks). The AI raises it with `vibe64-helper need-help raise`, or the person raises it from the session; the person
// answers or clears it, and the AI reads the answer and clears it. A follow-up adds to the same flag. It is the
// session's metadata NEED_HELP_METADATA, one JSON document, so it outlasts a restart; this file reads it the one way
// the server, the AI's command and the session's pages all read it.

const NEED_HELP_METADATA = "need_help";
const NEED_HELP_SCHEMA = "vibe64.need-help.v1";
const NEED_HELP_LIMITS = Object.freeze({
  // One message: what's wrong, what was tried, what's needed.
  messageCharacters: 2000,
  // A flag keeps its first message and the newest after it.
  messages: 20,
  // Why a forward failed, as the host said it.
  forwardMessageCharacters: 300
});
// After this long with no answer to its newest request, the session tells the person the request is still open.
const NEED_HELP_STILL_OPEN_MS = 15 * 60 * 1000;
const NEED_HELP_SENDERS = Object.freeze(["agent", "person"]);
const NEED_HELP_KINDS = Object.freeze(["request", "answer"]);

const isRecord = (value) => Boolean(value) && typeof value === "object" && !Array.isArray(value);
const text = (value) => (typeof value === "string" ? value : "");
const isTime = (value) => typeof value === "string" && !Number.isNaN(Date.parse(value));

/** @typedef {{ at: string, from: "agent" | "person", author: string, kind: "request" | "answer", text: string }} NeedHelpMessage */
/** @typedef {{ state: "sent" | "failed", at: string, to: string, reference: string, message: string }} NeedHelpForward */
/**
 * @typedef {object} NeedHelpFlag
 * @property {string} schema
 * @property {string} id
 * @property {string} raisedAt
 * @property {"agent" | "person"} raisedBy
 * @property {NeedHelpMessage[]} messages oldest first
 * @property {NeedHelpForward | null} forwarded where the host sent it, or why it couldn't; null when it sends nowhere
 */

/** @param {unknown} value @returns {NeedHelpMessage | null} */
function needHelpMessage(value) {
  if (!isRecord(value) || !isTime(value.at) || !NEED_HELP_SENDERS.includes(value.from) || !NEED_HELP_KINDS.includes(value.kind)) {
    return null;
  }
  const body = text(value.text).trim();
  if (!body) return null;
  return { at: value.at, from: value.from, author: text(value.author), kind: value.kind, text: body };
}

/** @param {unknown} value @returns {NeedHelpForward | null} */
function needHelpForward(value) {
  if (!isRecord(value) || !["sent", "failed"].includes(value.state) || !isTime(value.at)) return null;
  return { state: value.state, at: value.at, to: text(value.to), reference: text(value.reference), message: text(value.message) };
}

/**
 * The session's flag from its stored text (the metadata value, or the session's metadata record), or null when the
 * session has none or holds one this file can't read.
 * @param {unknown} stored
 * @returns {NeedHelpFlag | null}
 */
function readNeedHelpFlag(stored) {
  const raw = isRecord(stored) ? stored[NEED_HELP_METADATA] : stored;
  let value = raw;
  if (typeof raw === "string") {
    if (!raw.trim()) return null;
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }
  if (!isRecord(value) || value.schema !== NEED_HELP_SCHEMA || !text(value.id) || !isTime(value.raisedAt)
    || !NEED_HELP_SENDERS.includes(value.raisedBy) || !Array.isArray(value.messages)) return null;
  const messages = value.messages.map(needHelpMessage).filter(Boolean);
  if (!messages.length) return null;
  return {
    schema: NEED_HELP_SCHEMA,
    id: value.id,
    raisedAt: value.raisedAt,
    raisedBy: value.raisedBy,
    messages,
    forwarded: needHelpForward(value.forwarded)
  };
}

/**
 * Where the flag stands at `now`: its newest request, the answer after it if any, and whether that request has waited
 * NEED_HELP_STILL_OPEN_MS without one.
 * @param {NeedHelpFlag | null} flag
 * @param {number} now
 */
function needHelpState(flag, now) {
  if (!flag) return { open: false, request: null, answer: null, answered: false, stillOpen: false, waitingMs: 0 };
  const requestIndex = flag.messages.findLastIndex((message) => message.kind === "request");
  const request = flag.messages[requestIndex] || flag.messages[0];
  const answer = flag.messages.slice(requestIndex + 1).findLast((message) => message.kind === "answer") || null;
  const waitingMs = answer ? 0 : Math.max(0, now - Date.parse(request.at));
  return {
    open: true,
    request,
    answer,
    answered: Boolean(answer),
    stillOpen: !answer && waitingMs >= NEED_HELP_STILL_OPEN_MS,
    waitingMs
  };
}

/** Who wrote a message, as the session shows it. @param {NeedHelpMessage} message */
function needHelpSender(message) {
  if (message.from === "agent") return "The AI";
  return message.author || "The person";
}

/** Where a forward went, or why it didn't, in a sentence, or "" when the host sends flags nowhere. @param {NeedHelpFlag} flag */
function needHelpForwardText(flag) {
  const forwarded = flag?.forwarded;
  if (!forwarded) return "";
  if (forwarded.state === "sent") {
    return `Sent to ${forwarded.to || "the host"}${forwarded.reference ? ` (reference ${forwarded.reference})` : ""}.`;
  }
  return `It couldn't be sent to ${forwarded.to || "the host"}${forwarded.message ? `: ${forwarded.message}` : "."}`
    + `${forwarded.message && !/[.!?]$/u.test(forwarded.message) ? "." : ""} A follow-up tries again.`;
}

export {
  NEED_HELP_LIMITS,
  NEED_HELP_METADATA,
  NEED_HELP_SCHEMA,
  NEED_HELP_SENDERS,
  NEED_HELP_STILL_OPEN_MS,
  needHelpForwardText,
  needHelpSender,
  needHelpState,
  readNeedHelpFlag
};
