import { onBeforeUnmount, ref, unref, watch } from "vue";
import {
  aiStudioAutopilotArtifactsStreamEndpoint,
  clearAiStudioAutopilotArtifacts,
  readAiStudioAutopilotArtifacts
} from "@/lib/aiStudioSessionApi.js";
import { parseJsonStreamEvent } from "@/lib/streamEvents.js";

function emptyAutopilotArtifacts(sessionId = "") {
  return {
    artifactReadiness: {},
    issueDraft: null,
    ok: true,
    promptDone: null,
    questions: null,
    sessionId: String(sessionId || "")
  };
}

function useAiStudioAutopilotArtifacts({
  clearArtifacts = clearAiStudioAutopilotArtifacts,
  readArtifacts = readAiStudioAutopilotArtifacts,
  sessionId = () => ""
} = {}) {
  const artifacts = ref(emptyAutopilotArtifacts());
  const streamError = ref("");

  let eventSource = null;
  let eventSourceSessionId = "";

  function currentSessionId() {
    return String(unref(sessionId) || "").trim();
  }

  function closeStream() {
    eventSource?.close?.();
    eventSource = null;
    eventSourceSessionId = "";
  }

  function applyArtifacts(payload = {}) {
    const payloadSessionId = String(payload.sessionId || currentSessionId());
    if (payloadSessionId !== currentSessionId()) {
      return;
    }
    artifacts.value = {
      ...emptyAutopilotArtifacts(payloadSessionId),
      ...payload,
      sessionId: payloadSessionId
    };
  }

  async function refresh() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId) {
      artifacts.value = emptyAutopilotArtifacts();
      return artifacts.value;
    }
    const response = await readArtifacts(nextSessionId);
    applyArtifacts(response);
    return response;
  }

  async function clear() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId) {
      artifacts.value = emptyAutopilotArtifacts();
      return artifacts.value;
    }
    const response = await clearArtifacts(nextSessionId);
    applyArtifacts(response?.ok === false ? emptyAutopilotArtifacts(nextSessionId) : response);
    return response;
  }

  function startStream() {
    const nextSessionId = currentSessionId();
    if (!nextSessionId) {
      closeStream();
      artifacts.value = emptyAutopilotArtifacts();
      return false;
    }
    if (eventSource && eventSourceSessionId === nextSessionId) {
      return true;
    }

    closeStream();
    streamError.value = "";
    artifacts.value = emptyAutopilotArtifacts(nextSessionId);

    if (typeof EventSource !== "function") {
      void refresh().catch((error) => {
        streamError.value = String(error?.message || error || "Autopilot files could not be read.");
      });
      return false;
    }

    const source = new EventSource(aiStudioAutopilotArtifactsStreamEndpoint(nextSessionId), {
      withCredentials: true
    });
    eventSource = source;
    eventSourceSessionId = nextSessionId;

    const isCurrentStream = () => source === eventSource;
    source.addEventListener("autopilot-artifacts.updated", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      streamError.value = "";
      applyArtifacts(parseJsonStreamEvent(event));
    });
    source.addEventListener("autopilot-artifacts.error", (event) => {
      if (!isCurrentStream()) {
        return;
      }
      streamError.value = parseJsonStreamEvent(event).error || "Autopilot file stream failed.";
    });
    source.onerror = () => {
      if (isCurrentStream()) {
        streamError.value = "Autopilot file stream disconnected.";
      }
    };
    return true;
  }

  watch(currentSessionId, startStream, {
    immediate: true
  });

  onBeforeUnmount(closeStream);

  return {
    artifacts,
    clear,
    closeStream,
    refresh,
    startStream,
    streamError
  };
}

export {
  useAiStudioAutopilotArtifacts
};
