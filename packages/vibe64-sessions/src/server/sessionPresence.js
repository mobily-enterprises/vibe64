import {
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  VIBE64_SESSION_PRESENCE_IDLE_MS
} from "@local/vibe64-runtime/shared";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { BROWSER_KEY_PATTERN } from "./inputPatterns.js";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEvents} RuntimeEvents */

const SESSION_PRESENCE_IDLE_MS = VIBE64_SESSION_PRESENCE_IDLE_MS;
const SESSION_PRESENCE_MAX_ENTRIES = 2_048;

function presenceText(value = "") {
  return String(value ?? "").trim();
}

function presenceActor(vibe64User = null) {
  const actorId = presenceText(vibe64User?.username || vibe64User?.id);
  if (!actorId) {
    return null;
  }
  return Object.freeze({
    actorId,
    displayName: presenceText(vibe64User?.preferredName) || "Another user"
  });
}

function presenceKey({
  actorId = "",
  conversationId = "",
  originId = "",
  projectSlug = "",
  sessionId = ""
} = {}) {
  return JSON.stringify([
    presenceText(projectSlug),
    presenceText(sessionId),
    presenceText(conversationId),
    presenceText(actorId),
    presenceText(originId)
  ]);
}

function assertPresenceInput(input = {}) {
  const actorId = presenceText(input.actorId);
  const displayName = presenceText(input.displayName) || "Another user";
  const originId = presenceText(input.originId);
  const projectSlug = presenceText(input.projectSlug);
  const sessionId = presenceText(input.sessionId);
  const conversationId = presenceText(input.conversationId);
  const sequence = Number(input.sequence);
  if (!actorId || !projectSlug || !sessionId) {
    throw new TypeError("Session presence requires an actor, project, and session.");
  }
  if (!BROWSER_KEY_PATTERN.test(originId)) {
    throw vibe64Error("Session presence origin is invalid.", "vibe64_session_presence_origin_invalid", { status: 400 });
  }
  if (conversationId && !/^[A-Za-z0-9_-]{1,128}$/u.test(conversationId)) {
    throw vibe64Error("Session presence conversation is invalid.", "vibe64_session_presence_conversation_invalid", { status: 400 });
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    throw vibe64Error("Session presence sequence is invalid.", "vibe64_session_presence_sequence_invalid", { status: 400 });
  }
  return Object.freeze({
    actorId,
    ...(conversationId ? { conversationId } : {}),
    displayName: Array.from(displayName).slice(0, 80).join("") || "Another user",
    originId,
    projectSlug,
    sequence,
    sessionId,
    typing: input.typing === true
  });
}

function presencePayload(input = {}, options = {}) {
  const {
    expiresAt = 0,
    now = Date.now()
  } = options;
  const presence = assertPresenceInput(input);
  return Object.freeze({
    ...presence,
    expiresAt: new Date(expiresAt || now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
}

/**
 * @param {object} dependencies
 * @param {RuntimeEvents} dependencies.events
 */
function createSessionPresencePublisher({ events }) {
  return async function publishSessionPresence(payload = {}) {
    const presence = presencePayload(payload, {
      expiresAt: Date.parse(payload.expiresAt) || Date.now(),
      now: Date.parse(payload.updatedAt) || Date.now()
    });
    return events.publish(Object.freeze({
      type: VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
      source: "vibe64",
      entity: "session_presence",
      operation: presence.typing ? "typing" : "idle",
      entityId: [presence.sessionId, presence.conversationId, presence.actorId, presence.originId].filter(Boolean).join(":"),
      scope: Object.freeze({
        kind: "global",
        id: null
      }),
      occurredAt: presence.updatedAt,
      realtime: Object.freeze({
        audience: "all_users",
        event: VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
        payload: presence
      })
    }));
  };
}

/**
 * @param {object} dependencies
 * @param {typeof clearTimeout} [dependencies.clearTimeoutFn]
 * @param {number} [dependencies.idleMs]
 * @param {number} [dependencies.maxEntries]
 * @param {() => number} [dependencies.now]
 * @param {(error: Error) => void} dependencies.onPublishError
 * @param {ReturnType<typeof createSessionPresencePublisher>} dependencies.publishPresence
 * @param {typeof setTimeout} [dependencies.setTimeoutFn]
 */
function createSessionPresenceService({
  clearTimeoutFn = clearTimeout,
  idleMs = SESSION_PRESENCE_IDLE_MS,
  maxEntries = SESSION_PRESENCE_MAX_ENTRIES,
  now = () => Date.now(),
  onPublishError,
  publishPresence,
  setTimeoutFn = setTimeout
}) {
  const entries = new Map();
  let closed = false;

  function reportPublishError(error) {
    try {
      onPublishError(error);
    } catch {
      // Presence is ephemeral and must not destabilize the owning server.
    }
  }

  async function publish(payload) {
    try {
      await publishPresence(payload);
      return true;
    } catch (error) {
      reportPublishError(error);
      return false;
    }
  }

  function removeEntry(key, entry) {
    if (entries.get(key) !== entry) {
      return false;
    }
    entries.delete(key);
    if (entry.timer) {
      clearTimeoutFn(entry.timer);
      entry.timer = null;
    }
    return true;
  }

  async function expireEntry(key, entry) {
    if (!removeEntry(key, entry) || closed) {
      return;
    }
    if (!entry.presence.typing) {
      return;
    }
    const expiredAt = now();
    await publish(presencePayload({
      ...entry.presence,
      typing: false
    }, {
      expiresAt: expiredAt,
      now: expiredAt
    }));
  }

  function scheduleExpiry(key, entry, delay) {
    entry.timer = setTimeoutFn(() => {
      void expireEntry(key, entry);
    }, delay);
    entry.timer.unref();
  }

  async function evictOldestEntry() {
    const [key, entry] = entries.entries().next().value || [];
    if (!key || !entry || !removeEntry(key, entry)) {
      return;
    }
    if (!entry.presence.typing) {
      return;
    }
    const evictedAt = now();
    await publish(presencePayload({
      ...entry.presence,
      typing: false
    }, {
      expiresAt: evictedAt,
      now: evictedAt
    }));
  }

  async function update(input = {}) {
    if (closed) {
      return Object.freeze({
        ok: true,
        status: "closed"
      });
    }
    const presence = assertPresenceInput(input);
    const key = presenceKey(presence);
    const existing = entries.get(key);
    if (existing && existing.presence.sequence >= presence.sequence) {
      return Object.freeze({
        ok: true,
        presence: existing.payload,
        status: "stale"
      });
    }
    if (existing) {
      removeEntry(key, existing);
    }
    const updatedAt = now();
    const expiryDelay = Math.max(1, Number(idleMs) || SESSION_PRESENCE_IDLE_MS);
    const payload = presencePayload(presence, {
      expiresAt: presence.typing ? updatedAt + expiryDelay : updatedAt,
      now: updatedAt
    });
    const entry = {
      payload,
      presence,
      timer: null
    };
    entries.set(key, entry);
    while (entries.size > Math.max(1, Number(maxEntries) || SESSION_PRESENCE_MAX_ENTRIES)) {
      await evictOldestEntry();
    }
    await publish(payload);
    if (entries.get(key) === entry && !closed) {
      scheduleExpiry(key, entry, expiryDelay);
    }
    return Object.freeze({
      ok: true,
      presence: payload,
      status: presence.typing ? "typing" : "idle"
    });
  }

  function close() {
    if (closed) {
      return;
    }
    closed = true;
    for (const [key, entry] of entries) {
      removeEntry(key, entry);
    }
  }

  const size = () => entries.size;

  return Object.freeze({
    close,
    size,
    update
  });
}

const __testables = Object.freeze({ assertPresenceInput, SESSION_PRESENCE_IDLE_MS });

export {
  SESSION_PRESENCE_MAX_ENTRIES,
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  createSessionPresencePublisher,
  createSessionPresenceService,
  presenceActor,
  presencePayload,
  __testables
};
