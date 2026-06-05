import { onBeforeUnmount, ref, unref, watch } from "vue";
import {
  vibe64ArtifactReadinessStreamEndpoint,
  readVibe64ArtifactReadiness
} from "@/lib/vibe64SessionApi.js";
import { parseJsonStreamEvent } from "@/lib/streamEvents.js";
import {
  resolveStudioRequestUrl
} from "@/lib/studioHttp.js";

function emptyArtifactReadiness(sessionId = "") {
  return {
    artifactReadiness: {},
    ok: true,
    sessionId: String(sessionId || "")
  };
}

function useVibe64ArtifactReadiness({
  active = true,
  readReadiness = readVibe64ArtifactReadiness,
  sessionId = () => ""
} = {}) {
  const readiness = ref(emptyArtifactReadiness());
  const streamError = ref("");

  let eventSource = null;
  let eventSourceSessionId = "";

  function currentSessionId() {
    return String(unref(sessionId) || "").trim();
  }

  function isActive() {
    return unref(active) !== false;
  }

  function closeStream() {
    eventSource?.close?.();
    eventSource = null;
    eventSourceSessionId = "";
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
  }

  async function refresh() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId || !isActive()) {
      readiness.value = emptyArtifactReadiness();
      return readiness.value;
    }
    const response = await readReadiness(nextSessionId);
    applyReadiness(response);
    return response;
  }

  function startStream() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId || !isActive()) {
      closeStream();
      readiness.value = emptyArtifactReadiness();
      return false;
    }
    if (eventSource && eventSourceSessionId === nextSessionId) {
      return true;
    }

    closeStream();
    streamError.value = "";
    readiness.value = emptyArtifactReadiness(nextSessionId);

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
    readiness,
    refresh,
    startStream,
    streamError
  };
}

export {
  useVibe64ArtifactReadiness
};
