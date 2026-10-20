import { computed, nextTick, ref, unref } from "vue";
import { VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
import { readLocalStorageJson, writeLocalStorageJson } from "/src/lib/browserLocalStorage.js";
import { useVibe64ColleagueModel } from "/src/lib/vibe64ColleagueModelBridge.js";
import { useAiConnections } from "../composables/useAiConnections.js";
import { useCodexProviderConnections } from "../composables/useCodexProviderConnections.js";
import { routingSuggestsChanges, useModelRouting } from "../composables/useModelRouting.js";
import { useVibe64Accounts } from "../composables/useVibe64Accounts.js";
import { AI_ONBOARDING_PROVIDERS } from "./aiOnboardingProviders.js";

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const engineLabel = (id) => VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === id)?.label || id;
// Through OpenCode, the regular Z.AI API serves the free GLM-4.7 Flash starter.
const OPENCODE_STARTERS = ["zai"];
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

// "Set up" is any working AI beyond the free starters, whichever provider it is.
function aiIsSetUp({ accounts, curated, openCode }) {
  return accounts.some(({ id, connected }) => ["claude", "codex"].includes(id) && connected) ||
    curated.some(({ connected, claudeReady }) => connected || claudeReady) ||
    openCode.some(({ builtIn, connected, modelProviderId }) => builtIn !== true && connected &&
      !OPENCODE_STARTERS.includes(modelProviderId));
}

// True when a Colleague selection uses this card's orchestrator and provider.
function usesProvider(selection, { connect }) {
  return selection?.engineId === connect.engineId && selection?.modelProviderId === connect.modelProviderId;
}

const colleagueChoice = (result) => result?.selection ? { ...result.selection, label: result.modelLabel } : null;
const HELLO = "Say hello to me in one short, friendly sentence. No questions.";

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
  const colleagueCurrent = ref(null);

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

  // Re-reads Colleague's saved selection, when a Colleague is mounted; a failed read counts as unknown.
  async function refreshColleague() {
    colleagueCurrent.value = colleague.available.value ? colleagueChoice(await colleague.current().catch(() => null)) : null;
    return colleagueCurrent.value;
  }

  // Moves Colleague onto the routed Senior of the card's provider.
  async function selectForColleague({ connect: { engineId, modelProviderId } }) {
    const result = await colleague.selectForWorkflow({ engineId, modelProviderId });
    if (!result?.ok) return { error: result?.error || "Colleague couldn't switch models." };
    colleagueCurrent.value = colleagueChoice(result);
    return { selection: colleagueCurrent.value };
  }

  // Proof that Colleague answers: one ordinary message, with a reply or an error.
  function sayHello() {
    return colleague.sayHello(HELLO).catch((error) => ({ ok: false, error: error?.message || "No reply." }));
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
    const senior = engine?.roles?.senior || {};
    const routed = senior.assignment?.modelProviderId === connect.modelProviderId;
    return {
      connected: true,
      // The workflow is usable and its Senior is, or would be, this provider.
      available: workflow?.available === true && (routed || senior.recommendation?.modelProviderId === connect.modelProviderId),
      routed,
      routingWouldChange: routingSuggestsChanges(engine, connect.modelProviderId)
    };
  }

  return { cards, colleague: colleagueCurrent, colleagueAvailable: colleague.available, refreshColleague,
    isSetUp, loadError, loaded, reload, sayHello, selectForColleague, verify };
}

export { aiIsSetUp, usesProvider, aiOnboardingConnections, aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding };
