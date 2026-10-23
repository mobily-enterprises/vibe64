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

// "Set up" is any working AI, whichever provider it is, including the free
// GLM option. Redo still recommends Claude.
function aiIsSetUp({ accounts, curated, openCode }) {
  return accounts.some(({ id, connected }) => ["claude", "codex"].includes(id) && connected) ||
    curated.some(({ connected, claudeReady }) => connected || claudeReady) ||
    openCode.some(({ connected }) => connected);
}

// True when a Colleague selection uses this card's orchestrator and provider.
function usesProvider(selection, { connect }) {
  return selection?.engineId === connect.engineId && selection?.modelProviderId === connect.modelProviderId;
}

// A routed selection named by its onboarding card, or by its model id.
const providerName = ({ modelProviderId, modelId }) =>
  AI_ONBOARDING_PROVIDERS.flatMap((provider) => [provider, provider.free].filter(Boolean))
    .find(({ connect }) => connect.modelProviderId === modelProviderId)?.name || modelId;
const colleagueChoice = (result) => result?.selection ? { ...result.selection, label: result.modelLabel } : null;
const HELLO = "Say hello to me in one short, friendly sentence. No questions.";

// Orchestrator labels through which a card's provider is connected.
function aiOnboardingConnections({ matches }, { accounts, curated, openCode }) {
  return [...new Set([
    ...accounts.filter(({ id, connected }) => connected && matches.native.includes(id)).map(({ id }) => engineLabel(id)),
    ...curated.filter(({ id }) => matches.curated.includes(id)).flatMap(({ connected, claudeReady }) =>
      [connected && engineLabel("codex"), claudeReady && engineLabel("claude")].filter(Boolean)),
    ...openCode.filter(({ connected, modelProviderId }) => connected &&
      matches.opencode.includes(modelProviderId)).map(() => engineLabel("opencode"))
  ])];
}

// The AI connection manager's rows (configured pairs, working or not) that
// belong to a card, by the same matches that mark the card Connected.
function aiOnboardingRows({ matches }, rows = []) {
  return rows.filter(({ kind, id, modelProviderId }) => ["claude", "codex"].includes(kind) ? matches.native.includes(id)
    : kind === "codex-provider" ? matches.curated.includes(id)
      : kind === "opencode" && matches.opencode.includes(modelProviderId || id));
}

function useAiOnboarding({ endpoint = "", enabled = true } = {}) {
  const accounts = useVibe64Accounts();
  const curated = useCodexProviderConnections({ enabled });
  const openCode = useAiConnections({ ...(endpoint ? { endpoint } : {}), enabled });
  const routingEnabled = ref(false);
  const routing = useModelRouting({ enabled: routingEnabled });
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
  const card = (provider) => {
    const through = loaded.value ? aiOnboardingConnections(provider, lists.value) : [];
    return { ...provider, engineLabel: engineLabel(provider.connect.engineId), through, connected: through.length > 0 };
  };
  // A free option is a card of its own for connecting, shown inside its provider's card.
  const cards = computed(() => AI_ONBOARDING_PROVIDERS.map((provider) => ({ ...card(provider),
    ...(provider.free ? { free: card({ ...provider, note: "", upgrade: "", crown: false, free: null, ...provider.free }) } : {}) })));

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

  // Re-reads the chosen provider's connection and, at the same time, the owner's AI setup.
  async function verify(provider) {
    const { connect } = provider;
    routingEnabled.value = true;
    await nextTick();
    await Promise.all([reload(), routing.resource.reload()]);
    if (!aiOnboardingConnections(provider, lists.value).length) return { connected: false };
    const senior = routing.setups.value?.owner?.roles?.senior || {};
    const routed = senior.effective?.modelProviderId === connect.modelProviderId;
    return {
      connected: true,
      // The owner's Senior is, or would be, this provider and is usable.
      available: routed ? routing.viewerDecisions.value.senior?.available === true
        : senior.recommendation?.modelProviderId === connect.modelProviderId,
      routed,
      routingWouldChange: routingSuggestsChanges(routing.setups.value, connect.modelProviderId),
      // The Senior model already in use, which a routing change would replace.
      currentSenior: senior.value?.schema ? { ...senior.value, name: providerName(senior.value) } : null
    };
  }

  return { accounts, cards, colleague: colleagueCurrent, colleagueAvailable: colleague.available, refreshColleague,
    isSetUp, loadError, loaded, reload, revealColleague: colleague.reveal, sayHello, selectForColleague, verify };
}

export { aiIsSetUp, usesProvider, aiOnboardingConnections, aiOnboardingRows, aiOnboardingSnoozed, snoozeAiOnboarding, useAiOnboarding };
