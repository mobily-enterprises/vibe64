import { computed, onScopeDispose, shallowRef, watch } from "vue";
import {
  useRealtimeEvent,
  useRealtimeSocket
} from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
  VIBE64_SESSION_PRESENCE_DEBOUNCE_MS,
  VIBE64_SESSION_PRESENCE_HEARTBEAT_MS,
  VIBE64_SESSION_PRESENCE_IDLE_MS
} from "@local/vibe64-runtime/shared";
import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

function presenceText(value = "") {
  return String(value ?? "").trim();
}

function presenceTimestamp(value = "") {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function sessionPresencePath(sessionsApiPath = "", sessionId = "") {
  return vibe64SessionPath(sessionsApiPath, sessionId, "/presence");
}

function normalizedRemotePresence(payload = {}, now = Date.now()) {
  const actorId = presenceText(payload.actorId);
  const displayName = presenceText(payload.displayName) || "Another user";
  const originId = presenceText(payload.originId);
  const projectSlug = presenceText(payload.projectSlug);
  const sessionId = presenceText(payload.sessionId);
  const conversationId = presenceText(payload.conversationId);
  const sequence = Number(payload.sequence);
  const updatedAt = presenceTimestamp(payload.updatedAt);
  const expiresAt = presenceTimestamp(payload.expiresAt);
  if (
    !actorId ||
    !originId ||
    !projectSlug ||
    !sessionId ||
    !Number.isSafeInteger(sequence) ||
    sequence < 1 ||
    !updatedAt ||
    !expiresAt
  ) {
    return null;
  }
  const typing = payload.typing === true && expiresAt > now;
  return Object.freeze({
    actorId,
    conversationId,
    displayName: Array.from(displayName).slice(0, 80).join("") || "Another user",
    expiresAt,
    originId,
    projectSlug,
    sequence,
    sessionId,
    typing,
    updatedAt
  });
}

function typingPresenceLabel(people = []) {
  const visible = Array.isArray(people) ? people : [];
  if (visible.length === 1) {
    return `${presenceText(visible[0]?.displayName) || "Another user"} is typing…`;
  }
  return visible.length > 1 ? `${visible.length} people are typing…` : "";
}

function useVibe64SessionTypingPresence({
  active = true,
  conversationId = "",
  projectSlug = "",
  sessionId = "",
  sessionsApiPath = ""
} = {}, {
  clearTimer = clearTimeout,
  debounceMs = VIBE64_SESSION_PRESENCE_DEBOUNCE_MS,
  heartbeatMs = VIBE64_SESSION_PRESENCE_HEARTBEAT_MS,
  idleMs = VIBE64_SESSION_PRESENCE_IDLE_MS,
  now = () => Date.now(),
  request = (path, options) => getHttpWebClient().request(path, options),
  setTimer = setTimeout
} = {}) {
  const originId = vibe64BrowserTabOriginId();
  const remoteEntries = shallowRef(new Map());
  const realtimeSocket = useRealtimeSocket({ required: false });
  let debounceTimer = null;
  let heartbeatTimer = null;
  let idleTimer = null;
  // The browser-tab origin survives reloads, so begin above any short-lived
  // server tombstone left by the previous page instance.
  let localSequence = Math.max(0, Math.floor(Number(now()) || 0));
  let localTyping = false;
  let typingContext = null;

  const currentContext = computed(() => Object.freeze({
    active: readRefOrGetterValue(active) !== false,
    conversationId: presenceText(readRefOrGetterValue(conversationId)),
    projectSlug: presenceText(readRefOrGetterValue(projectSlug)),
    sessionId: presenceText(readRefOrGetterValue(sessionId)),
    sessionsApiPath: presenceText(readRefOrGetterValue(sessionsApiPath))
  }));
  const eligible = computed(() => Boolean(
    currentContext.value.active &&
    currentContext.value.projectSlug &&
    currentContext.value.sessionId &&
    currentContext.value.sessionsApiPath
  ));
  const typingPeople = computed(() => {
    const byActor = new Map();
    for (const entry of remoteEntries.value.values()) {
      if (!entry.typing || entry.expiresAt <= now()) {
        continue;
      }
      byActor.set(entry.actorId, {
        actorId: entry.actorId,
        displayName: entry.displayName
      });
    }
    return [...byActor.values()].sort((left, right) => (
      left.displayName.localeCompare(right.displayName)
    ));
  });
  const typingLabel = computed(() => typingPresenceLabel(typingPeople.value));

  function clearScheduledTimer(name) {
    const timer = name === "debounce"
      ? debounceTimer
      : name === "heartbeat"
        ? heartbeatTimer
        : idleTimer;
    if (timer) {
      clearTimer(timer);
    }
    if (name === "debounce") {
      debounceTimer = null;
    } else if (name === "heartbeat") {
      heartbeatTimer = null;
    } else {
      idleTimer = null;
    }
  }

  function requestPresence(typing, context = typingContext || currentContext.value) {
    if (!context?.projectSlug || !context?.sessionId || !context?.sessionsApiPath) {
      return;
    }
    localSequence += 1;
    void request(sessionPresencePath(context.sessionsApiPath, context.sessionId), {
      body: {
        ...(context.conversationId ? { conversationId: context.conversationId } : {}),
        originId,
        sequence: localSequence,
        typing: typing === true
      },
      method: "POST"
    }).catch(() => null);
  }

  function scheduleHeartbeat() {
    clearScheduledTimer("heartbeat");
    if (!localTyping) {
      return;
    }
    heartbeatTimer = setTimer(() => {
      heartbeatTimer = null;
      if (!localTyping || !eligible.value) {
        stopTyping();
        return;
      }
      requestPresence(true);
      scheduleHeartbeat();
    }, Math.max(1, Number(heartbeatMs) || VIBE64_SESSION_PRESENCE_HEARTBEAT_MS));
  }

  function startTyping() {
    debounceTimer = null;
    if (localTyping || !eligible.value) {
      return;
    }
    typingContext = { ...currentContext.value };
    localTyping = true;
    requestPresence(true);
    scheduleHeartbeat();
  }

  function stopTyping({ notify = true } = {}) {
    clearScheduledTimer("debounce");
    clearScheduledTimer("heartbeat");
    clearScheduledTimer("idle");
    if (localTyping && notify) {
      requestPresence(false);
    }
    localTyping = false;
    typingContext = null;
  }

  function noteInputActivity() {
    if (!eligible.value) {
      return;
    }
    clearScheduledTimer("idle");
    idleTimer = setTimer(() => {
      idleTimer = null;
      stopTyping();
    }, Math.max(1, Number(idleMs) || VIBE64_SESSION_PRESENCE_IDLE_MS));
    if (localTyping || debounceTimer) {
      return;
    }
    debounceTimer = setTimer(
      startTyping,
      Math.max(0, Number(debounceMs) || 0)
    );
  }

  function clearRemotePresence() {
    for (const entry of remoteEntries.value.values()) {
      if (entry.timer) {
        clearTimer(entry.timer);
      }
    }
    remoteEntries.value = new Map();
  }

  function removeRemotePresence(key, expected = null) {
    const current = remoteEntries.value.get(key);
    if (!current || (expected && current !== expected)) {
      return;
    }
    if (current.timer) {
      clearTimer(current.timer);
    }
    const next = new Map(remoteEntries.value);
    next.delete(key);
    remoteEntries.value = next;
  }

  function applyRemotePresence(payload = {}) {
    const entry = normalizedRemotePresence(payload, now());
    const context = currentContext.value;
    if (
      !entry ||
      entry.originId === originId ||
      entry.projectSlug !== context.projectSlug ||
      entry.sessionId !== context.sessionId ||
      entry.conversationId !== context.conversationId
    ) {
      return;
    }
    const key = `${entry.actorId}\0${entry.originId}`;
    const current = remoteEntries.value.get(key);
    if (
      current &&
      (entry.sequence < current.sequence || (
        entry.sequence === current.sequence &&
        entry.updatedAt < current.updatedAt
      ))
    ) {
      return;
    }
    if (current?.timer) {
      clearTimer(current.timer);
    }
    const stored = {
      ...entry,
      timer: null
    };
    stored.timer = setTimer(() => {
      removeRemotePresence(key, stored);
    }, entry.typing
      ? Math.max(1, entry.expiresAt - now())
      : Math.max(1, Number(idleMs) || VIBE64_SESSION_PRESENCE_IDLE_MS));
    const next = new Map(remoteEntries.value);
    next.set(key, stored);
    remoteEntries.value = next;
  }

  function handleRealtimeConnect() {
    if (localTyping && eligible.value) {
      requestPresence(true);
    }
  }

  function handleRealtimeDisconnect() {
    clearRemotePresence();
  }

  useRealtimeEvent({
    enabled: eligible,
    event: VIBE64_SESSION_PRESENCE_CHANGED_EVENT,
    onEvent: ({ payload }) => applyRemotePresence(payload)
  });
  realtimeSocket.on("connect", handleRealtimeConnect);
  realtimeSocket.on("disconnect", handleRealtimeDisconnect);

  watch(() => [
    currentContext.value.active,
    currentContext.value.conversationId,
    currentContext.value.projectSlug,
    currentContext.value.sessionId,
    currentContext.value.sessionsApiPath
  ].join("\0"), () => {
    stopTyping();
    clearRemotePresence();
  }, {
    flush: "sync"
  });

  onScopeDispose(() => {
    stopTyping();
    clearRemotePresence();
    realtimeSocket.off("connect", handleRealtimeConnect);
    realtimeSocket.off("disconnect", handleRealtimeDisconnect);
  });

  return Object.freeze({
    applyRemotePresence,
    blur: stopTyping,
    noteInputActivity,
    stop: stopTyping,
    submit: stopTyping,
    typingLabel,
    typingPeople
  });
}

export {
  normalizedRemotePresence,
  sessionPresencePath,
  typingPresenceLabel,
  useVibe64SessionTypingPresence
};
