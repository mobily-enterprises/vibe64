import { randomUUID } from "node:crypto";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { logOperationalEvent } from "@local/vibe64-core/server/logging";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import {
  NEED_HELP_LIMITS,
  NEED_HELP_METADATA,
  NEED_HELP_SCHEMA,
  needHelpForwardText,
  needHelpSender,
  needHelpState,
  readNeedHelpFlag
} from "../../shared/needHelp.js";

// Need help's owner (shared/needHelp.js holds the flag's shape): raising a session's flag, or adding a follow-up to the
// one it has, answering it and clearing it, for the session's AI (its vibe64-helper command) and for the person (the
// session's pages) alike. Every change is written to the session's metadata under its record's lock, one change per
// session at a time, and published so its session list and header show it at once. A raise is forwarded by the host,
// once per flag (again after a forward that failed), and where it went is kept on the flag. An answer is told to the
// main chat's AI.

// A forward that hasn't answered in this long is recorded as failed; the flag stays raised either way.
const FORWARD_MS = 20_000;
const CHANGED = Object.freeze({ reason: "need-help-changed", payload: Object.freeze({ clientRefresh: Object.freeze({ includeList: true }) }) });

/** @typedef {import("../../shared/needHelp.js").NeedHelpFlag} NeedHelpFlag */

/** The message's text, trimmed, or a refusal naming what a message holds. @param {unknown} value */
function messageText(value) {
  const body = typeof value === "string" ? value.trim() : "";
  if (!body) {
    throw vibe64Error("Say what's wrong, what you tried and what you need: the message is empty.", "vibe64_need_help_text_required", { status: 400 });
  }
  if (body.length > NEED_HELP_LIMITS.messageCharacters) {
    throw vibe64Error(`Keep the message to ${NEED_HELP_LIMITS.messageCharacters} characters: it has ${body.length}.`, "vibe64_need_help_text_too_long", { status: 400 });
  }
  return body;
}

/** The first message and the newest after it, within NEED_HELP_LIMITS.messages. @param {NeedHelpFlag["messages"]} messages */
function boundedMessages(messages) {
  return messages.length <= NEED_HELP_LIMITS.messages ? messages : [messages[0], ...messages.slice(-(NEED_HELP_LIMITS.messages - 1))];
}

/** What the AI reads: the flag's messages in order, where it was sent, and what to do next. @param {NeedHelpFlag | null} flag */
function needHelpAgentText(flag, now) {
  if (!flag) return "This session has no open Need help.";
  const state = needHelpState(flag, now);
  return [
    `Need help, raised ${flag.raisedAt} by ${flag.raisedBy === "agent" ? "the AI" : "the person"}.`,
    needHelpForwardText(flag),
    "",
    ...flag.messages.map((message) => `${message.at} ${needHelpSender(message)} (${message.kind}):\n${message.text}`),
    "",
    state.answered
      ? "Next: act on the answer; once it's resolved, run vibe64-helper need-help clear."
      : "Next: nobody has answered yet. Keep working on what you can; read again with vibe64-helper need-help read."
  ].filter((line, index, lines) => line || lines[index - 1]).join("\n");
}

/**
 * @param {object} dependencies
 * @param {{ createRuntimeWithoutSource: () => Promise<{ store: import("@local/vibe64-runtime/server/types").Vibe64SessionStore }> }} dependencies.project
 * @param {import("./needHelpHost.js").NeedHelpHost} dependencies.host
 * @param {(sessionId: string, options: object) => Promise<unknown>} dependencies.publishSessionChanged
 * @param {(sessionId: string, input: { message: string, nextTurn?: boolean }, options?: object) => Promise<unknown>} dependencies.noteMainChat
 * @param {import("@jskit-ai/kernel/server/types").RuntimeLogger} dependencies.logger
 * @param {() => number} [dependencies.now]
 * @param {number} [dependencies.forwardMs]
 */
function createNeedHelpService({ project, host, publishSessionChanged, noteMainChat, logger, now = Date.now, forwardMs = FORWARD_MS }) {
  // One change per session at a time: a raise, its forward's record, an answer and a clear never overwrite each other.
  const queues = new Map();
  function oneAtATime(sessionId, operation) {
    const previous = queues.get(sessionId) || Promise.resolve();
    const next = previous.catch(() => null).then(operation);
    const settled = next.catch(() => null);
    queues.set(sessionId, settled);
    settled.then(() => queues.get(sessionId) === settled && queues.delete(sessionId));
    return next;
  }

  async function store() {
    return (await project.createRuntimeWithoutSource()).store;
  }

  async function readFlag(sessionStore, sessionId) {
    return readNeedHelpFlag(await sessionStore.readMetadataValue(sessionId, NEED_HELP_METADATA));
  }

  function writeFlag(sessionStore, sessionId, flag) {
    return sessionStore.writeMetadataValue(sessionId, NEED_HELP_METADATA, JSON.stringify(flag));
  }

  const published = (sessionId) => publishSessionChanged(sessionId, CHANGED).catch(() => null);
  const at = () => new Date(now()).toISOString();
  const author = (actor) => (typeof actor?.username === "string" ? actor.username : "");

  /** The host's forward of the flag's newest message, bounded in time; null when the host sends it nowhere. */
  async function forward(sessionId, flag, message, actor) {
    let timer;
    const late = new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("The host didn't answer in time.")), forwardMs);
    });
    try {
      const sent = await Promise.race([
        host.forward({ sessionId, projectSlug: String(currentProjectRequestContext()?.slug || ""), flag, message, actor: actor || null }),
        late
      ]);
      if (!sent) return null;
      return { state: "sent", at: at(), to: String(sent.to || ""), reference: String(sent.reference || ""), message: "" };
    } catch (error) {
      logOperationalEvent(logger, "warn", {
        code: error?.code,
        component: "vibe64.need_help",
        error: error?.message,
        event: "vibe64.need_help.forward_failed",
        sessionId
      }, "A session's Need help could not be forwarded.");
      return {
        state: "failed",
        at: at(),
        to: "",
        reference: "",
        message: String(error?.message || "It failed.").slice(0, NEED_HELP_LIMITS.forwardMessageCharacters)
      };
    } finally {
      clearTimeout(timer);
    }
  }

  /** @param {string} sessionId */
  async function read(sessionId) {
    const flag = await readFlag(await store(), sessionId);
    return { ok: true, sessionId, needHelp: flag, text: needHelpAgentText(flag, now()) };
  }

  /**
   * Raises the session's Need help, or adds a follow-up to the one it has, and forwards it through the host when it
   * hasn't reached it yet.
   * @param {string} sessionId
   * @param {{ text: string, from: "agent" | "person", actor?: object | null }} input
   */
  async function raise(sessionId, { text, from, actor = null }) {
    const body = messageText(text);
    const sessionStore = await store();
    const { flag, followUp } = await oneAtATime(sessionId, async () => {
      const current = await readFlag(sessionStore, sessionId);
      const message = { at: at(), from, author: author(actor), kind: "request", text: body };
      const next = current
        ? { ...current, messages: boundedMessages([...current.messages, message]) }
        : { schema: NEED_HELP_SCHEMA, id: randomUUID(), raisedAt: message.at, raisedBy: from, messages: [message], forwarded: null };
      await writeFlag(sessionStore, sessionId, next);
      return { flag: next, followUp: Boolean(current) };
    });
    await published(sessionId);
    let result = flag;
    if (flag.forwarded?.state !== "sent") {
      const forwarded = await forward(sessionId, flag, body, actor);
      if (forwarded) {
        result = await oneAtATime(sessionId, async () => {
          const current = await readFlag(sessionStore, sessionId);
          // Cleared or raised anew meanwhile: that flag is not this forward's.
          if (current?.id !== flag.id) return current;
          const next = { ...current, forwarded };
          await writeFlag(sessionStore, sessionId, next);
          return next;
        });
        await published(sessionId);
      }
    }
    return {
      ok: true,
      sessionId,
      followUp,
      needHelp: result,
      text: [
        followUp ? "Your follow-up is added to this session's Need help." : "This session now shows Need help.",
        result ? needHelpForwardText(result) : "",
        from === "agent" ? "Keep working on what you can. Read the answer with vibe64-helper need-help read." : ""
      ].filter(Boolean).join(" ")
    };
  }

  /**
   * The person's answer to the session's Need help, which the main chat's AI is told about.
   * @param {string} sessionId
   * @param {{ text: string, actor?: object | null }} input
   */
  async function answer(sessionId, { text, actor = null }) {
    const body = messageText(text);
    const sessionStore = await store();
    const flag = await oneAtATime(sessionId, async () => {
      const current = await readFlag(sessionStore, sessionId);
      if (!current) {
        throw vibe64Error("This session has no open Need help to answer.", "vibe64_need_help_missing", { status: 404 });
      }
      const next = { ...current, messages: boundedMessages([...current.messages, { at: at(), from: "person", author: author(actor), kind: "answer", text: body }]) };
      await writeFlag(sessionStore, sessionId, next);
      return next;
    });
    await published(sessionId);
    await noteMainChat(sessionId, {
      message: `${author(actor) || "The person"} answered this session's Need help:\n\n${body}\n\n`
        + "Read it all with `vibe64-helper need-help read`, and once it's resolved, clear it with `vibe64-helper need-help clear`.",
      nextTurn: true
    }, actor ? { vibe64User: actor } : {});
    return { ok: true, sessionId, needHelp: flag, text: "Your answer is added; the AI is told." };
  }

  /**
   * Clears the session's Need help: resolved, or no longer needed.
   * @param {string} sessionId
   */
  async function clear(sessionId) {
    const sessionStore = await store();
    const cleared = await oneAtATime(sessionId, async () => {
      const current = await readFlag(sessionStore, sessionId);
      if (current) await sessionStore.deleteMetadataValue(sessionId, NEED_HELP_METADATA);
      return current;
    });
    if (cleared) await published(sessionId);
    return {
      ok: true,
      sessionId,
      cleared: Boolean(cleared),
      needHelp: null,
      text: cleared ? "This session's Need help is cleared." : "This session had no open Need help."
    };
  }

  return Object.freeze({
    answer,
    clear,
    raise,
    read
  });
}

export { createNeedHelpService, needHelpAgentText };
