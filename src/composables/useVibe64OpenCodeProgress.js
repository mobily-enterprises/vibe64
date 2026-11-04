import { vibe64ProviderPresentation } from "@local/vibe64-runtime/shared";
import { computed, ref } from "vue";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { VIBE64_SESSION_CHANGED_EVENT } from "@/lib/vibe64SessionRequestConfig.js";

/**
 * What the selected OpenCode session is doing, from the progress its realtime
 * session events carry: a tool, reasoning, writing or plain work.
 * @param {{ active: boolean, session: any, sessionSelectionArchived: boolean }} props The Autopilot view's props.
 * @param {{ selectedAssistantSessionId: import("vue").Ref<string> }} options
 */
function useVibe64OpenCodeProgress(props, { selectedAssistantSessionId }) {
  const openCodeProgressLabel = ref("");
  const openCodeProviderLabel = computed(() => vibe64ProviderPresentation(props.session?.assistantSelection).label || "OpenCode");

  function visibleOpenCodeProgressLabel(progress = {}) {
    if (String(progress.tool || "").trim()) {
      return `${openCodeProviderLabel.value} is using a tool…`;
    }
    if (
      String(progress.partType || "").trim() === "reasoning" ||
      String(progress.type || "").includes("reasoning")
    ) {
      return `${openCodeProviderLabel.value} is reasoning…`;
    }
    if (String(progress.text || "").trim()) {
      return `${openCodeProviderLabel.value} is writing…`;
    }
    return `${openCodeProviderLabel.value} is working…`;
  }

  useRealtimeEvent({
    enabled: computed(() => Boolean(
      props.active &&
      !props.sessionSelectionArchived &&
      selectedAssistantSessionId.value &&
      props.session?.assistantSelection?.engineId === "opencode"
    )),
    event: VIBE64_SESSION_CHANGED_EVENT,
    matches: ({ payload = {} } = {}) => Boolean(
      String(payload.sessionId || payload.entityId || "").trim() === selectedAssistantSessionId.value &&
      (
        payload.assistantProgress ||
        [
          "opencode-server-message-delivered",
          "opencode-server-turn-active",
          "opencode-server-turn-idle"
        ].includes(payload.reason)
      )
    ),
    onEvent: ({ payload = {} } = {}) => {
      openCodeProgressLabel.value = payload.reason === "opencode-server-turn-idle"
        ? ""
        : visibleOpenCodeProgressLabel(payload.assistantProgress || {});
    }
  });

  return {
    openCodeProgressLabel
  };
}

export {
  useVibe64OpenCodeProgress
};
