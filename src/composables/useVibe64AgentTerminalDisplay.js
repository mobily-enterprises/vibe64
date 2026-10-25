import { computed } from "vue";

// Where an agent terminal shows and whether it streams: shown inline when
// visible and not headless, and still streaming while hidden when the caller
// listens to a server terminal that exists.
function useVibe64AgentTerminalDisplay(props, serverTerminalId) {
  const displayActive = computed(() => props.visible && props.displayMode !== "headless");
  const hiddenListenActive = computed(() => Boolean(
    props.listenWhenHidden && serverTerminalId.value && !displayActive.value
  ));
  const streamActive = computed(() => Boolean(displayActive.value || hiddenListenActive.value));
  const presentation = computed(() => displayActive.value ? "inline" : "headless");
  return { displayActive, presentation, streamActive };
}

// The server's terminal record for a session, or {} when it has none.
function vibe64ServerAgentTerminal(session = null) {
  const terminal = session?.agentSession?.terminal;
  return terminal && typeof terminal === "object" && !Array.isArray(terminal) ? terminal : {};
}

export { useVibe64AgentTerminalDisplay, vibe64ServerAgentTerminal };
