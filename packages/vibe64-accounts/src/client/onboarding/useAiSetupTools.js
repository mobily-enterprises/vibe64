import { computed, ref } from "vue";
import { useLocalToolRows } from "/src/composables/useLocalToolRows.js";

/**
 * The AI tool behind each provider card on this computer. Where a tool is
 * missing, each card's tool is checked by running it, so a card can say it is
 * ready here or lead with installing it. A host that supplies its own tools
 * reports none missing, and its cards stay as they are. `active`: the setup is
 * open to someone who may configure AI.
 */
function useAiSetupTools({ setup, active }) {
  const installOpen = ref("");
  const checkingTools = ref(false);
  const someToolMissing = computed(() => (setup.accounts?.status.value?.missingTools || []).length > 0);
  const toolCheck = useLocalToolRows(["claude", "codex", "opencode"], {
    enabled: computed(() => active.value && someToolMissing.value)
  });

  /** Before anyone picks: the program a card connects through, when this computer lacks it. */
  function neededTool(card) {
    if (!card || card.connected) return null;
    const tools = setup.accounts?.status.value?.missingTools || [];
    return tools.find((tool) => tool.id === card.connect.engineId) || null;
  }

  /** The tool row for a card or its free option, while it still needs connecting. */
  function cardTool(item) {
    if (!item || item.connected || !someToolMissing.value) return null;
    const id = item.connect.engineId;
    const checked = toolCheck.tools.value.find((tool) => tool.id === id);
    if (checked) return checked;
    const missing = neededTool(item);
    return missing && { id, name: missing.label, status: "missing", install: missing.install, guideUrl: missing.install?.guideUrl };
  }

  /** Whether a card's tool was found ready on this computer. */
  function toolReady(item) {
    return cardTool(item)?.status === "ready";
  }

  /** Opens or closes the install row in a card, by card or free option id. */
  function toggleInstall(item) {
    installOpen.value = installOpen.value === item.id ? "" : item.id;
  }

  /** Reads the connections again and runs the tool check again. */
  async function checkTools() {
    checkingTools.value = true;
    try {
      await Promise.all([setup.accounts?.refresh(), someToolMissing.value && toolCheck.check()]);
    } finally {
      checkingTools.value = false;
    }
  }

  return {
    cardTool,
    checkingTools,
    checkTools,
    installOpen,
    neededTool,
    toggleInstall,
    toolReady
  };
}

export { useAiSetupTools };
