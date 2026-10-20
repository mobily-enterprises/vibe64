import { computed, nextTick, ref, unref } from "vue";
import { VIBE64_AGENT_PROVIDERS, vibe64AssistantSelectionLabel } from "@local/vibe64-runtime/shared";
import { useVibe64ColleagueModel } from "@local/vibe64-colleague/client";
import { readLocalStorageJson, writeLocalStorageJson } from "/src/lib/browserLocalStorage.js";
import { useAiConnections } from "../composables/useAiConnections.js";
import { useCodexProviderConnections } from "../composables/useCodexProviderConnections.js";
import { routingSuggestsChanges, useModelRouting } from "../composables/useModelRouting.js";
import { useVibe64Accounts } from "../composables/useVibe64Accounts.js";
import { AI_ONBOARDING_PROVIDERS } from "./aiOnboardingProviders.js";

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const engineLabel = (id) => VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === id)?.label || id;
const snoozeKey = (actorKey) => `vibe64.aiOnboarding.snoozedUntil:${actorKey || "local"}`;

function aiOnboardingSnoozed(actorKey, now = Date.now()) {
  return Number(readLocalStorageJson(snoozeKey(actorKey), 0)) > now;
}

function snoozeAiOnboarding(actorKey, now = Date.now()) {
  try {
    writeLocalStorageJson(snoozeKey(actorKey), now + SNOOZE_MS);
  } catch {
    // Unavailable storage only means Set up later lasts for this page load.
  }
}

// "Set up" is any AI beyond the built-in starter, whichever provider it is.
function aiIsSetUp({ accounts, curated, openCode }) {
  return accounts.some(({ id, connected }) => ["claude", "codex"].includes(id) && connected) ||
    curated.some(({ connected, claudeReady }) => connected || claudeReady) ||
    openCode.some(({ builtIn }) => builtIn !== true);
}

// Orchestrator labels through which a card's provider is connected.
function aiOnboardingConnections({ matches }, { accounts, curated, openCode }) {
  return [...new Set([
    ...accounts.filter(({ id, connected }) => connected && matches.native.includes(id)).map(({ id }) => engineLabel(id)),
    ...curated.filter(({ id }) => matches.curated.includes(id)).flatMap(({ connected, claudeReady }) =>
      [connected && engineLabel("codex"), claudeReady && engineLabel("claude")].filter(Boolean)),
    ...openCode.filter(({ builtIn, connected, modelProviderId }) => builtIn !== true && connected &&
      matches.opencode.includes(modelProviderId)).map(() => engineLabel("opencode"))
  ])];
}

function useAiOnboarding({ endpoint = "", enabled = true } = {}) {
  const accounts = useVibe64Accounts();
  const curated = useCodexProviderConnections({ enabled });
  const openCode = useAiConnections({ ...(endpoint ? { endpoint } : {}), enabled });
  const routingEngineId = ref("");
  const routingEnabled = ref(false);
  const workflows = useModelRouting({ workflowsOnly: true, enabled: routingEnabled });
  const routing = useModelRouting({ engineId: routingEngineId, enabled: routingEnabled });
  const colleague = useVibe64ColleagueModel();

  const lists = computed(() => ({
    accounts: accounts.status.value?.accounts,
    curated: curated.resource.data.value?.providers,
    openCode: openCode.connections.value
  }));
  const loadError = computed(() => accounts.loadError.value || curated.loadError.value || openCode.loadError.value || "");
  const loaded = computed(() => !loadError.value && unref(enabled) && Array.isArray(lists.value.accounts) &&
    Array.isArray(lists.value.curated) && !openCode.isInitialLoading.value);
  const isSetUp = computed(() => loaded.value && aiIsSetUp(lists.value));
  const cards = computed(() => AI_ONBOARDING_PROVIDERS.map((provider) => {
    const through = loaded.value ? aiOnboardingConnections(provider, lists.value) : [];
    return { ...provider, engineLabel: engineLabel(provider.connect.engineId), through, connected: through.length > 0 };
  }));

  function reload() {
    return Promise.all([accounts.statusResource.reload(), curated.resource.reload(), openCode.reload()]);
  }

  // Colleague's saved selection with its label, when a Colleague is mounted.
  function colleagueSelection() {
    const selection = colleague.available.value ? colleague.current() : null;
    return selection ? { ...selection, label: vibe64AssistantSelectionLabel(selection, { includeThinking: false }) } : null;
  }

  async function selectForColleague(engineId) {
    await colleague.selectForWorkflow(engineId);
    return colleagueSelection();
  }

  // Re-reads the chosen provider's connection, then its orchestrator's routing.
  async function verify(provider) {
    const { connect } = provider;
    await reload();
    if (!aiOnboardingConnections(provider, lists.value).length) return { connected: false };
    routingEngineId.value = connect.engineId;
    routingEnabled.value = true;
    await nextTick();
    await Promise.all([workflows.resource.reload(), routing.resource.reload()]);
    const workflow = workflows.workflows.value.find(({ engineId }) => engineId === connect.engineId);
    const engine = routing.engines.value.find(({ engineId }) => engineId === connect.engineId);
    return {
      connected: true,
      available: workflow?.available === true,
      routed: engine?.roles?.senior?.assignment?.modelProviderId === connect.modelProviderId,
      routingWouldChange: routingSuggestsChanges(engine, connect.modelProviderId)
    };
  }

  return { cards, colleagueAvailable: colleague.available, colleagueSelection,
    isSetUp, loadError, loaded, reload, selectForColleague, verify };
}

export { aiIsSetUp, aiOnboardingConnections, aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding };
