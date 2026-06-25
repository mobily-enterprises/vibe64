import { computed, onBeforeUnmount, ref, unref, watch } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useEndpointResource } from "@jskit-ai/users-web/client/composables/useEndpointResource";
import {
  vibe64ArtifactReadinessWebSocketUrl,
  vibe64ArtifactReadinessStreamEndpoint,
  vibe64ArtifactReadinessEndpoint
} from "@/lib/vibe64SessionApi.js";
import {
  VIBE64_SURFACE_ID
} from "@/lib/vibe64RequestConfig.js";
import {
  useVibe64ProjectSlug
} from "@/composables/useVibe64ProjectScope.js";
import { parseJsonStreamEvent } from "@/lib/streamEvents.js";
import {
  resolveStudioRequestUrl
} from "@/lib/studioUrls.js";

function emptyArtifactReadiness(sessionId = "") {
  return {
    artifactReadiness: {},
    ok: true,
    sessionId: String(sessionId || "")
  };
}

const ARTIFACT_READINESS_RECONNECT_MS = 3000;

function useVibe64ArtifactReadiness({
  active = true,
  sessionId = () => ""
} = {}) {
  const projectSlug = useVibe64ProjectSlug();
  const readiness = ref(emptyArtifactReadiness());
  const initialized = ref(false);
  const streamError = ref("");
  const readinessResource = useEndpointResource({
    enabled: false,
    fallbackLoadError: "Artifact readiness could not be read.",
    path: computed(() => {
      const nextSessionId = currentSessionId();
      return nextSessionId ? vibe64ArtifactReadinessEndpoint(nextSessionId) : "";
    }),
    queryKey: computed(() => [
      "vibe64",
      projectSlug.value || "",
      VIBE64_SURFACE_ID,
      ROUTE_VISIBILITY_PUBLIC,
      "artifact-readiness",
      currentSessionId()
    ]),
    requestRecoveryLabel: "Artifact readiness"
  });

  let eventSource = null;
  let eventSourceSessionId = "";
  let readinessSocket = null;
  let readinessSocketSessionId = "";
  let reconnectTimer = null;

  function currentSessionId() {
    return String(unref(sessionId) || "").trim();
  }

  function isActive() {
    return unref(active) !== false;
  }

  function closeStream() {
    clearReconnectTimer();
    closeWebSocketStream();
    closeEventSourceStream();
  }

  function closeEventSourceStream() {
    eventSource?.close?.();
    eventSource = null;
    eventSourceSessionId = "";
  }

  function closeWebSocketStream() {
    const socket = readinessSocket;
    readinessSocket = null;
    readinessSocketSessionId = "";
    if (socket && socket.readyState !== WebSocket.CLOSED && socket.readyState !== WebSocket.CLOSING) {
      socket.close();
    }
  }

  function clearReconnectTimer() {
    if (!reconnectTimer) {
      return;
    }
    window.clearTimeout(reconnectTimer);
    reconnectTimer = null;
  }

  function applyReadiness(payload = {}) {
    const payloadSessionId = String(payload.sessionId || currentSessionId());
    if (payloadSessionId !== currentSessionId()) {
      return;
    }
    readiness.value = {
      ...emptyArtifactReadiness(payloadSessionId),
      ...payload,
      sessionId: payloadSessionId
    };
    initialized.value = true;
  }

  async function refresh() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId || !isActive()) {
      readiness.value = emptyArtifactReadiness();
      initialized.value = false;
      return readiness.value;
    }
    const result = await readinessResource.reload();
    const response = result?.data || readinessResource.data.value || emptyArtifactReadiness(nextSessionId);
    applyReadiness(response);
    return response;
  }

  function startStream() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId || !isActive()) {
      closeStream();
      readiness.value = emptyArtifactReadiness();
      initialized.value = false;
      return false;
    }
    if (
      (eventSource && eventSourceSessionId === nextSessionId) ||
      (readinessSocket && readinessSocketSessionId === nextSessionId)
    ) {
      return true;
    }

    closeStream();
    streamError.value = "";
    readiness.value = emptyArtifactReadiness(nextSessionId);
    initialized.value = false;

    if (startWebSocketStream(nextSessionId)) {
      return true;
    }
    return startEventSourceStream(nextSessionId);
  }

  function startWebSocketStream(nextSessionId) {
    if (typeof WebSocket !== "function") {
      return false;
    }

    let socket;
    try {
      socket = new WebSocket(vibe64ArtifactReadinessWebSocketUrl(nextSessionId));
    } catch (error) {
      streamError.value = String(error?.message || error || "Artifact readiness stream could not be opened.");
      return false;
    }

    readinessSocket = socket;
    readinessSocketSessionId = nextSessionId;
    let receivedReadiness = false;
    let fallbackStarted = false;

    const isCurrentSocket = () => socket === readinessSocket &&
      readinessSocketSessionId === nextSessionId &&
      currentSessionId() === nextSessionId &&
      isActive();

    function fallbackToEventSource(message) {
      if (!isCurrentSocket() || fallbackStarted) {
        return;
      }
      fallbackStarted = true;
      streamError.value = message;
      closeWebSocketStream();
      startEventSourceStream(nextSessionId);
    }

    function reconnectWebSocket() {
      if (!isActive() || currentSessionId() !== nextSessionId || reconnectTimer) {
        return;
      }
      reconnectTimer = window.setTimeout(() => {
        reconnectTimer = null;
        if (isActive() && currentSessionId() === nextSessionId && !readinessSocket && !eventSource) {
          startWebSocketStream(nextSessionId);
        }
      }, ARTIFACT_READINESS_RECONNECT_MS);
    }

    socket.addEventListener("open", () => {
      if (isCurrentSocket()) {
        streamError.value = "";
      }
    });
    socket.addEventListener("message", (event) => {
      if (!isCurrentSocket()) {
        return;
      }
      const payload = parseJsonStreamEvent(event);
      if (payload.type === "artifact-readiness.updated") {
        receivedReadiness = true;
        streamError.value = "";
        applyReadiness(payload);
        return;
      }
      if (payload.type === "artifact-readiness.error") {
        receivedReadiness = true;
        streamError.value = payload.error || "Artifact readiness stream failed.";
      }
    });
    socket.addEventListener("error", () => {
      if (!isCurrentSocket()) {
        return;
      }
      if (!receivedReadiness) {
        fallbackToEventSource("Artifact readiness WebSocket failed.");
        return;
      }
      streamError.value = "Artifact readiness stream failed.";
    });
    socket.addEventListener("close", () => {
      if (!isCurrentSocket()) {
        return;
      }
      readinessSocket = null;
      readinessSocketSessionId = "";
      if (!receivedReadiness) {
        startEventSourceStream(nextSessionId);
        return;
      }
      streamError.value = "Artifact readiness stream disconnected.";
      reconnectWebSocket();
    });
    return true;
  }

  function startEventSourceStream(nextSessionId) {
    if (typeof EventSource !== "function") {
      void refresh().catch((error) => {
        streamError.value = String(error?.message || error || "Artifact readiness could not be read.");
      });
      return false;
    }

    const source = new EventSource(resolveStudioRequestUrl(vibe64ArtifactReadinessStreamEndpoint(nextSessionId)), {
      withCredentials: true
    });
    eventSource = source;
    eventSourceSessionId = nextSessionId;

    const isCurrentStream = () => source === eventSource;
    source.addEventListener("artifact-readiness.updated", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      streamError.value = "";
      applyReadiness(parseJsonStreamEvent(event));
    });
    source.addEventListener("artifact-readiness.error", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      streamError.value = parseJsonStreamEvent(event).error || "Artifact readiness stream failed.";
    });
    source.onerror = () => {
      if (isCurrentStream()) {
        streamError.value = "Artifact readiness stream disconnected.";
      }
    };
    return true;
  }

  watch(() => [
    currentSessionId(),
    isActive() ? "active" : "inactive"
  ].join("|"), startStream, {
    immediate: true
  });

  onBeforeUnmount(closeStream);

  return {
    closeStream,
    initialized,
    readiness,
    readinessResource,
    refresh,
    startStream,
    streamError
  };
}

export {
  useVibe64ArtifactReadiness
};
