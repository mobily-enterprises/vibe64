import { computed, nextTick, ref, unref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { defineVibe64AssistantSelection, VIBE64_AGENT_PROVIDERS } from "@local/vibe64-runtime/shared";
import { ASSISTANT_SETUP_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import { readLocalStorageJson, writeLocalStorageJson } from "/src/lib/browserLocalStorage.js";
import { useVibe64ColleagueModel } from "/src/lib/vibe64ColleagueModelBridge.js";
import { useAiConnections } from "../composables/useAiConnections.js";
import { useCodexProviderConnections } from "../composables/useCodexProviderConnections.js";
import { useModelRouting } from "../composables/useModelRouting.js";
import { useVibe64Accounts } from "../composables/useVibe64Accounts.js";
import { ACCOUNTS_ENDPOINT } from "../lib/accountsGateApi.js";
import { AI_ONBOARDING_PROVIDERS } from "./aiOnboardingProviders.js";

const SNOOZE_MS = 24 * 60 * 60 * 1000;
const TEAM_SNOOZE_MS = 7 * SNOOZE_MS;
const ENGINES = ["claude", "codex", "opencode"];
// The owner roles "Use as main AI" moves onto a provider; Colleague, Fix it with AI
// and Explain & check follow them.
const MAIN_AI_ROLES = ["senior", "junior", "router", "quickHelper"];
const engineLabel = (id) => VIBE64_AGENT_PROVIDERS.find((provider) => provider.id === id)?.label || id;
const snoozeKey = (actorKey) => `vibe64.aiOnboarding.snoozedUntil:${actorKey || "local"}`;
const teamSnoozeKey = (actorKey) => `vibe64.aiTeamSetup.snoozedUntil:${actorKey || "local"}`;
const routeKey = (selection) => JSON.stringify(["engineId", "agentId", "modelProviderId", "modelId", "variantId"]
  .map((key) => selection?.[key] || ""));

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

// The team setup card's "Not now": seven days per viewer.
function aiTeamSetupSnoozed(actorKey, now = Date.now()) {
  return Number(readLocalStorageJson(teamSnoozeKey(actorKey), 0)) > now;
}

function snoozeAiTeamSetup(actorKey, now = Date.now()) {
  try {
    writeLocalStorageJson(teamSnoozeKey(actorKey), now + TEAM_SNOOZE_MS);
  } catch {
    // Unavailable storage only means Not now lasts for this page load.
  }
}

// "Set up" is any working AI, whichever provider it is, including the free
// GLM option. Redo still recommends Claude.
function aiIsSetUp({ accounts, curated, openCode }) {
  return accounts.some(({ id, connected }) => ["claude", "codex"].includes(id) && connected) ||
    curated.some(({ connected, claudeReady }) => connected || claudeReady) ||
    openCode.some(({ connected }) => connected);
}

// True when a selection uses this card's provider, through any tool.
function usesProvider(selection, { connect }) {
  return Boolean(selection) && selection.modelProviderId === connect.modelProviderId;
}

// The card (or free option) that names a provider's models.
const providerCards = (cards) => cards.flatMap((card) => [card, card.free].filter(Boolean));
const cardForProvider = (cards, modelProviderId) => providerCards(cards).find(({ connect, matches }) =>
  connect.modelProviderId === modelProviderId || matches.curated.includes(modelProviderId) || matches.opencode.includes(modelProviderId));
// A routed selection named by its onboarding card, or by its model id.
const providerName = (selection) => cardForProvider(AI_ONBOARDING_PROVIDERS, selection.modelProviderId)?.name || selection.modelId;
const colleagueChoice = (result) => result?.selection ? { ...result.selection, label: result.modelLabel } : null;
const HELLO = "Say hello to me in one short, friendly sentence. No questions.";

// Tools (engine ids) through which a card's provider is connected.
function aiOnboardingConnections({ matches }, { accounts, curated, openCode }) {
  return [...new Set([
    ...accounts.filter(({ id, connected }) => connected && matches.native.includes(id)).map(({ id }) => id),
    ...curated.filter(({ id }) => matches.curated.includes(id)).flatMap(({ connected, claudeReady }) =>
      [connected && "codex", claudeReady && "claude"].filter(Boolean)),
    ...openCode.filter(({ connected, modelProviderId }) => connected &&
      matches.opencode.includes(modelProviderId)).map(() => "opencode")
  ])];
}

// The tool a card's provider is actually connected through: the card's own
// tool when it is connected there, else Claude Code, Codex, then OpenCode.
function connectedEngine(card, lists) {
  const through = aiOnboardingConnections(card, lists);
  return through.includes(card.connect.engineId) ? card.connect.engineId : ENGINES.find((id) => through.includes(id)) || "";
}

// "Main AI": the card of the owner's Senior, naming the tool when the provider
// is not that tool's own sign-in, as "DeepSeek, via Claude Code".
function aiOnboardingMainAi(cards, senior) {
  const card = senior?.schema ? cardForProvider(cards, senior.modelProviderId) : null;
  if (!card) return null;
  const via = card.matches.native.includes(senior.engineId) ? "" : engineLabel(senior.engineId);
  return { card, via, label: via ? `${card.name}, via ${via}` : card.name };
}

// The AI connection manager's rows (configured pairs, working or not) that
// belong to a card, by the same matches that mark the card Connected.
function aiOnboardingRows({ matches }, rows = []) {
  return rows.filter(({ kind, id, modelProviderId }) => ["claude", "codex"].includes(kind) ? matches.native.includes(id)
    : kind === "codex-provider" ? matches.curated.includes(id)
      : kind === "opencode" && matches.opencode.includes(modelProviderId || id));
}

async function routingRequest(path, body, method = "POST") {
  const result = await getHttpWebClient().request(`${ACCOUNTS_ENDPOINT}/model-routing${path}`, { method, body });
  if (result?.ok !== true) throw new Error(result?.error || "The AI setup could not be read.");
  return result;
}

// "Team members use DeepSeek V4 Pro for Colleague and Fix it with AI, and DeepSeek V4.1 Flash for helpers."
function teamSummary(roles) {
  const model = (selection) => JSON.stringify([selection?.engineId, selection?.modelProviderId, selection?.modelId]);
  const label = (role) => {
    const selection = roles[role]?.effective;
    return selection && (roles[role].choices.find((choice) => model(choice) === model(selection))?.label || selection.modelId);
  };
  const [colleague, helper] = [label("colleague"), label("quickHelper")];
  if (!helper || helper === colleague) return `Team members use ${colleague} for Colleague, Fix it with AI and helpers.`;
  return `Team members use ${colleague} for Colleague and Fix it with AI, and ${helper} for helpers.`;
}

function useAiOnboarding({ endpoint = "", enabled = true } = {}) {
  const accounts = useVibe64Accounts();
  const curated = useCodexProviderConnections({ enabled });
  const openCode = useAiConnections({ ...(endpoint ? { endpoint } : {}), enabled });
  const routingWanted = ref(false);
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
  // The AI setup is read once something is connected, or when finishing asks for it.
  const routing = useModelRouting({ enabled: computed(() => Boolean(unref(enabled)) && (routingWanted.value || isSetUp.value)) });
  const card = (provider) => {
    const through = loaded.value ? aiOnboardingConnections(provider, lists.value) : [];
    return { ...provider, through, connected: through.length > 0 };
  };
  // A free option is a card of its own for connecting, shown inside its provider's card.
  const cards = computed(() => AI_ONBOARDING_PROVIDERS.map((provider) => ({ ...card(provider),
    ...(provider.free ? { free: card({ ...provider, note: "", upgrade: "", crown: false, free: null, ...provider.free }) } : {}) })));
  const ownerRoles = computed(() => routing.setups.value?.owner?.roles || {});
  const mainAi = computed(() => aiOnboardingMainAi(cards.value, ownerRoles.value.senior?.effective));

  function reload() {
    return Promise.all([accounts.statusResource.reload(), curated.resource.reload(), openCode.reload()]);
  }

  async function readRouting() {
    routingWanted.value = true;
    await nextTick();
    await routing.resource.reload();
  }

  // The owner roles' recommendations when the card's provider, in its connected tool, becomes the main AI.
  async function preferredOwnerRoles(provider, engineId) {
    const result = await routingRequest("/preview", { revision: routing.resource.data.value?.revision ?? 0,
      preferProvider: { setup: "owner", modelProviderId: provider.connect.modelProviderId, engineId } });
    return result.setups.owner.roles;
  }

  // Re-reads Colleague's saved selection, when a Colleague is mounted; a failed read counts as unknown.
  async function refreshColleague() {
    colleagueCurrent.value = colleague.available.value ? colleagueChoice(await colleague.current().catch(() => null)) : null;
    return colleagueCurrent.value;
  }

  // Moves Colleague onto the owner's Colleague model when it uses the card's
  // provider, else onto the Senior the card would bring as main AI.
  async function selectForColleague(provider) {
    await readRouting();
    let selection = ownerRoles.value.colleague?.effective;
    if (!usesProvider(selection, provider)) {
      const engineId = connectedEngine(provider, lists.value);
      selection = engineId ? (await preferredOwnerRoles(provider, engineId).catch(() => null))?.senior?.recommendation : null;
    }
    if (!usesProvider(selection, provider)) return { error: `No ${provider.name} model is ready for Colleague.` };
    const result = await colleague.select(defineVibe64AssistantSelection(selection));
    if (!result?.ok) return { error: result?.error || "Colleague couldn't switch models." };
    colleagueCurrent.value = colleagueChoice(result);
    return { selection: colleagueCurrent.value };
  }

  // Proof that Colleague answers: one ordinary message, with a reply or an error.
  function sayHello() {
    return colleague.sayHello(HELLO).catch((error) => ({ ok: false, error: error?.message || "No reply." }));
  }

  // Re-reads the chosen provider's connection and, at the same time, the owner's
  // AI setup, then asks what making it the main AI would change.
  async function verify(provider) {
    await Promise.all([reload(), readRouting()]);
    const engineId = connectedEngine(provider, lists.value);
    if (!engineId) return { connected: false };
    const senior = ownerRoles.value.senior || {};
    const routed = usesProvider(senior.effective, provider);
    const preferred = await preferredOwnerRoles(provider, engineId).catch(() => null);
    const proposed = (role) => preferred?.[role]?.recommendation;
    return {
      connected: true,
      engineId,
      // The owner's Senior is, or would be, this provider and is usable.
      available: routed ? routing.viewerDecisions.value.senior?.available === true : usesProvider(proposed("senior"), provider),
      routed,
      routingWouldChange: MAIN_AI_ROLES.some((role) => usesProvider(proposed(role), provider) &&
        routeKey(proposed(role)) !== routeKey(ownerRoles.value[role]?.value)),
      // The Senior model already in use, which a routing change would replace.
      currentSenior: senior.value?.schema ? { ...senior.value, name: providerName(senior.value) } : null
    };
  }

  // The team card: fills every team role not yet chosen with the provider's
  // recommended models in that tool (one key fills the team setup).
  async function fillTeamSetup({ modelProviderId, engineId }) {
    try {
      await readRouting();
      const revision = routing.resource.data.value?.revision ?? 0;
      const preferProvider = { setup: "nonOwner", modelProviderId, engineId };
      const { setups: { nonOwner } } = await routingRequest("/preview", { revision, preferProvider });
      const values = Object.fromEntries(ASSISTANT_SETUP_ROLES.nonOwner
        .filter((role) => !nonOwner.roles[role].configured && nonOwner.setupValues[role]).map((role) => [role, nonOwner.setupValues[role]]));
      if (!values.colleague?.schema) return { error: `No ${engineLabel(engineId)} model is ready for team members yet. Check the connection, then try again.` };
      const saved = await routingRequest("", { revision, nonOwner: values, preferProvider }, "PATCH");
      await routing.resource.reload();
      return { ok: true, summary: teamSummary(saved.setups.nonOwner.roles) };
    } catch (error) {
      return { error: error?.message || "Team models weren't saved." };
    }
  }

  return { accounts, cards, colleague: colleagueCurrent, colleagueAvailable: colleague.available, fillTeamSetup, isSetUp,
    loadError, loaded, mainAi, refreshColleague, reload, revealColleague: colleague.reveal, routing, sayHello,
    selectForColleague, verify };
}

export { aiIsSetUp, usesProvider, aiOnboardingConnections, aiOnboardingMainAi, aiOnboardingRows, aiOnboardingSnoozed, aiTeamSetupSnoozed,
  connectedEngine, snoozeAiOnboarding, snoozeAiTeamSetup, teamSummary, useAiOnboarding };
