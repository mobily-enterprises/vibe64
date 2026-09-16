import {
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  VIBE64_SESSION_PRESENCE_IDLE_MS
} from "@local/vibe64-runtime/shared";

const SESSION_PRESENCE_IDLE_MS = VIBE64_SESSION_PRESENCE_IDLE_MS;
const SESSION_PRESENCE_MAX_ENTRIES = 2_048;
const SESSION_PRESENCE_ORIGIN_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.:-]{0,127}$/u;

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
  if (!SESSION_PRESENCE_ORIGIN_PATTERN.test(originId)) {
    const error = new Error("Session presence origin is invalid.");
    error.code = "vibe64_session_presence_origin_invalid";
    error.statusCode = 400;
    throw error;
  }
  if (conversationId && !/^[A-Za-z0-9_-]{1,128}$/u.test(conversationId)) {
    throw Object.assign(new Error("Session presence conversation is invalid."), {
      code: "vibe64_session_presence_conversation_invalid",
      statusCode: 400
    });
  }
  if (!Number.isSafeInteger(sequence) || sequence < 1) {
    const error = new Error("Session presence sequence is invalid.");
    error.code = "vibe64_session_presence_sequence_invalid";
    error.statusCode = 400;
    throw error;
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

function presencePayload(input = {}, {
  expiresAt = 0,
  now = Date.now()
} = {}) {
  const presence = assertPresenceInput(input);
  return Object.freeze({
    ...presence,
    expiresAt: new Date(expiresAt || now).toISOString(),
    updatedAt: new Date(now).toISOString()
  });
}

function createSessionPresencePublisher(events) {
  if (!events || typeof events.publish !== "function") {
    throw new TypeError("Session presence publication requires runtime.events.");
  }
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

function createSessionPresenceService({
  clearTimer = clearTimeout,
  idleMs = SESSION_PRESENCE_IDLE_MS,
  maxEntries = SESSION_PRESENCE_MAX_ENTRIES,
  now = () => Date.now(),
  onPublishError = () => {},
  publishPresence,
  setTimer = setTimeout
} = {}) {
  if (typeof publishPresence !== "function") {
    throw new TypeError("Session presence requires publishPresence().");
  }
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
      clearTimer(entry.timer);
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
    entry.timer = setTimer(() => {
      void expireEntry(key, entry);
    }, delay);
    entry.timer?.unref?.();
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
      return Object.freeze({ ok: true, status: "closed" });
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

  return Object.freeze({
    close,
    size: () => entries.size,
    update
  });
}

export {
  SESSION_PRESENCE_IDLE_MS,
  SESSION_PRESENCE_MAX_ENTRIES,
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  assertPresenceInput,
  createSessionPresencePublisher,
  createSessionPresenceService,
  presenceActor,
  presencePayload
};
