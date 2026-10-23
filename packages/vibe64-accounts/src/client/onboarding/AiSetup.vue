<script setup>
import { computed, inject, nextTick, ref, unref, watch } from "vue";
import { useDisplay } from "vuetify";
import { useRoute } from "vue-router";
import {
  mdiAlertCircleOutline, mdiArrowDown, mdiArrowLeft, mdiArrowRight, mdiCheck, mdiCheckCircle, mdiChevronDown,
  mdiInformationOutline, mdiLaptop, mdiOpenInNew, mdiRobotHappyOutline, mdiShieldLockOutline, mdiTuneVariant
} from "@mdi/js";
import AIAccountsSetup from "../studio/AIAccountsSetup.vue";
import CliInstallNotice, { cliProblem } from "../studio/CliInstallNotice.vue";
import ModelRoutingForm from "../studio/ModelRoutingForm.vue";
import NativeProviderConnections from "../studio/NativeProviderConnections.vue";
import AiConnectionDialogs from "../studio/AiConnectionDialogs.vue";
import AiProviderManage from "../studio/AiProviderManage.vue";
import AiSetupAdvanced from "../studio/AiSetupAdvanced.vue";
import AiWaitStatus from "../studio/AiWaitStatus.vue";
import { provideAiConnectionManager, useAiConnectionManager } from "../composables/useAiConnectionManager.js";
import AiOnboardingKeyConnect from "./AiOnboardingKeyConnect.vue";
import AiOnboardingMark from "./AiOnboardingMark.vue";
import AiTeamSetupCard from "./AiTeamSetupCard.vue";
import { aiOnboardingRows, aiTeamSetupSnoozed, snoozeAiTeamSetup, useAiOnboarding, usesProvider } from "./useAiOnboarding.js";
import { routingSelectionText } from "../studio/ModelRoutingRow.vue";
import { ASSISTANT_SETUP_ROLES } from "@local/vibe64-runtime/shared/assistantRouting";
import { VIBE64_ASSISTANT_VIEWER_KEY, VIBE64_LEARNING_KEY } from "/src/lib/vibe64AssistantHost.js";

// The AI setup stage: choose a provider, connect it, settle routing and prove
// it answers. The onboarding shell shows it after its Why screen; Account
// settings and other hosts show it inline as their AI Accounts. Each
// configured card's Manage, Advanced, and the dialogs behind them act through
// one AI connection manager.
const props = defineProps({
  open: { type: Boolean, default: true },
  // AI connections endpoint; standalone uses the default.
  endpoint: { type: String, default: "" },
  // Opened from the user menu or AI Accounts to review an existing setup.
  redo: Boolean,
  // The onboarding shell's state; an inline screen reads its own.
  onboarding: { type: Object, default: null },
  // Shown in a page or dialog rather than the onboarding shell: it has its own
  // Back and done buttons, and finishing returns to the overview.
  inline: Boolean,
  canConfigure: Boolean,
  // Shown to someone who may not configure AI.
  ownerNotice: { type: String, default: "Only the Vibe64 owner can connect AI accounts." },
  // Where the setup can be changed later.
  changeWhere: { type: String, default: "Account settings → AI Accounts" },
  // "team": opened to set up AI for team members; the team card leads, even when snoozed.
  focus: { type: String, default: "" }
});
// Slot connection-access ({ connection, card, place }): a host's note on who may
// use a connection, on the card's Connected badge ("badge"), below a connected
// card's name ("card"), a connection's tile ("row") and the success screen
// ("success").
const emit = defineEmits(["close", "changed", "connected", "busy"]);
const setup = props.onboarding || useAiOnboarding({ endpoint: props.endpoint, enabled: computed(() => props.canConfigure) });
const { xs } = useDisplay();

const RATINGS = ["", "poor", "limited", "good", "very good", "excellent"];
// Rank order follows how much each provider is worth: the button weight drops with it.
const CTA_VARIANT = ["flat", "tonal", "outlined", "outlined"];
// The crown settles once the cards have risen in.
const CROWN_SETTLE_MS = 420;

const screen = ref("choose");
const direction = ref("forward");
const stage = ref(null);
const routingForm = ref(null);
const wasSetUp = ref(false);
// Setup was read and absent: only then does finishing move Colleague unasked.
const firstRun = ref(false);
const chosen = ref(null);
// How step 1 stands: "" (not yet), "opened" (sign-up page opened) or "have".
const signUp = ref("");
const expandedId = ref("");
const setupBusy = ref(false);
const routingBusy = ref(false);
const verifying = ref(false);
const warning = ref("");
const notReady = ref(false);
const makeMain = ref(false);
const routingReviewed = ref(false);
const fullRouting = ref(false);
const routingDetails = ref(false);
// The Senior model in use when routing would change; none means apply without asking.
const currentSenior = ref(null);
// The tool the chosen provider is connected through, which "Use as main AI" keeps.
const chosenEngine = ref("");
// The team card: snoozed, connecting DeepSeek for the team, filling the team setup, and its outcome.
const teamSnoozed = ref(false);
const teamFlow = ref(false);
const teamBusy = ref(false);
const teamError = ref("");
const teamSummary = ref("");
const teamCard = ref(null);
const autoRouting = ref(false);
const outcome = ref({ routed: true, colleague: null, error: "" });
// Success proof: Colleague's reply to a hello ("", "waiting", "replied", "failed" or "dismissed").
const hello = ref({ state: "", reply: "", error: "" });
const announcement = ref("");
// Hover styling waits for real pointer movement, so a resting cursor stays still.
const pointerMoved = ref(false);

const manager = provideAiConnectionManager(useAiConnectionManager({
  ...(props.endpoint ? { endpoint: props.endpoint } : {}),
  isOwner: computed(() => props.canConfigure),
  emit: (event, value) => emit(event, value),
  // Inline, a route's providerId and providerRevision open that provider's key editor.
  followRoute: props.inline
}));
// Manage: the card whose connections are open, if any.
const manageOpen = ref(false);
const managedCard = ref(null);

const busy = computed(() => setupBusy.value || routingBusy.value || verifying.value || manager.busy.value);
const cards = computed(() => setup.cards.value);
const loaded = computed(() => setup.loaded.value);
const loadError = computed(() => setup.loadError.value);
const featured = computed(() => cards.value.find((card) => card.crown));
const others = computed(() => cards.value.filter((card) => !card.crown));
const connectedCards = computed(() => cards.value.filter((card) => card.connected));
// A configured setup leads with the cards it uses: connected or needing reconnection, then the rest by rank.
const orderedCards = computed(() => {
  const ranked = [featured.value, ...others.value];
  return wasSetUp.value ? [...ranked.filter(configured), ...ranked.filter((card) => !configured(card))] : ranked;
});
// Configured connections no card shows (OpenCode Zen, other catalog providers):
// they count as connected and are managed under Advanced.
const otherRows = computed(() => manager.configuredAiRows.value
  .filter((row) => !cards.value.some((card) => [card, card.free].some((item) => item && aiOnboardingRows(item, [row]).length))));
const otherConnected = computed(() => [...new Set(otherRows.value.filter((row) => row.connected !== false).map((row) => row.providerLabel))]);
// The strip names every connected provider; those without a card share one "+N" mark.
const currentMarks = computed(() => [...connectedCards.value, ...(otherConnected.value.length
  ? [{ id: "other", mark: `+${otherConnected.value.length}`, shape: "circle", tone: "neutral" }] : [])]);
const currentNames = computed(() => [...connectedCards.value.map(({ name }) => name), ...otherConnected.value]);
// Advanced appears once anything is configured.
const showAdvanced = computed(() => props.canConfigure && (wasSetUp.value || manager.configuredAiRows.value.length > 0));
// Main AI: the card of the owner's Senior; before the AI setup is read, Colleague's model stands in.
const ownerRoles = computed(() => setup.routing?.setups.value?.owner?.roles || null);
const ownerSenior = computed(() => ownerRoles.value ? ownerRoles.value.senior?.effective || null : setup.colleague.value);
const mainAi = computed(() => setup.mainAi?.value?.card.connected ? setup.mainAi.value : null);
const mainCard = computed(() => mainAi.value?.card || null);
const nativeLogin = computed(() => ["anthropic", "openai"].includes(chosen.value?.connect.modelProviderId));
// The chosen engine's CLI, when this computer lacks it or it did not start.
const missingTool = computed(() => {
  const id = chosen.value?.connect.engineId;
  const status = setup.accounts?.status.value || {};
  return status.accounts?.find((account) => account.id === id && cliProblem(account)) ||
    status.missingTools?.find((tool) => tool.id === id) || null;
});
// Before anyone picks: the program a card connects through, when this computer lacks it.
function neededTool(card) {
  if (!card || card.connected) return null;
  const tools = setup.accounts?.status.value?.missingTools || [];
  return tools.find((tool) => tool.id === card.connect.engineId) || null;
}
const checkingTools = ref(false);
async function checkTools() {
  checkingTools.value = true;
  try {
    await setup.accounts?.refresh();
  } finally {
    checkingTools.value = false;
  }
}
// Set up later snoozes first-run onboarding; a redo just closes. Inline has nothing to put off.
const skippable = computed(() => !props.inline && !wasSetUp.value && !["success", "owner"].includes(screen.value));
// The shell supplies Back and Done on a phone; inline shows its own.
const ownButtons = computed(() => props.inline || !xs.value);
// Success says one thing about Colleague: it uses the choice, can switch to it, or isn't open here.
const colleagueNote = computed(() => usesProvider(outcome.value.colleague, chosen.value) ? "uses"
  : setup.colleagueAvailable.value ? "switch" : "menu");
// In Learn mode Colleague's conversation is the teacher's: no hello goes into
// it, and the teacher uses the choice from the next message. Develop is as ever.
const learning = inject(VIBE64_LEARNING_KEY, null);
const learn = computed(() => Boolean(unref(learning)?.learnMode));
const inLesson = computed(() => learn.value && Boolean(unref(learning)?.mode?.currentAttemptId));
const doneLabel = computed(() => inLesson.value ? "Back to the lesson" : learn.value ? "Back to Learn" : "Start building");
// The check waits for Colleague's hello when there is one to wait for.
const proven = computed(() => colleagueNote.value !== "uses" || learn.value ||
  ["replied", "dismissed"].includes(hello.value.state));

// What finishing is doing while it checks the chosen provider.
const verifyLabel = computed(() => !chosen.value ? "" : firstRun.value || makeMain.value
  ? `Setting up ${chosen.value.name} as your main AI…` : `Checking ${chosen.value.name}…`);

function readSetup() {
  const { isSetUp, loaded: known } = setup;
  wasSetUp.value = props.redo || isSetUp.value;
  firstRun.value = !props.redo && known.value && !isSetUp.value;
}

watch(() => props.open, (open) => {
  if (!open) return;
  readSetup();
  setup.refreshColleague();
  direction.value = "forward";
  screen.value = props.canConfigure ? "choose" : "owner";
  chosen.value = null;
  expandedId.value = "";
  announcement.value = "";
  resetAttempt();
}, { immediate: true });

// Opened before the connections were read: settle once they are, before any choice.
watch(() => setup.loaded.value, (known) => {
  if (props.open && known && !chosen.value) readSetup();
});

// Success proves Colleague answers when it runs on the chosen provider.
watch(() => screen.value === "success" && colleagueNote.value === "uses", (proving) => {
  if (proving && !learn.value && !hello.value.state) sayHello();
});

// With no Senior model in use there is nothing to keep: the suggestions apply unasked.
watch(routingForm, (form) => {
  if (form && autoRouting.value) useAsMain();
});

async function sayHello() {
  hello.value = { state: "waiting", reply: "", error: "" };
  const result = await setup.sayHello();
  hello.value = result?.ok ? { state: "replied", reply: result.reply, error: "" }
    : { state: "failed", reply: "", error: result?.error || "No reply." };
  announcement.value = result?.ok ? `${chosen.value.name} is ready.` : `Colleague couldn't reach ${chosen.value.name}.`;
}

function resetAttempt() {
  teamFlow.value = false;
  warning.value = "";
  chosenEngine.value = "";
  notReady.value = false;
  makeMain.value = false;
  routingReviewed.value = false;
  fullRouting.value = false;
  routingDetails.value = false;
  autoRouting.value = false;
  hello.value = { state: "", reply: "", error: "" };
}

function go(next, back = false) {
  direction.value = back ? "back" : "forward";
  screen.value = next;
}

function close(reason, card = null) {
  if (busy.value) return;
  // Inline, finishing returns to the overview, which now shows the new setup.
  if (props.inline && reason === "done") {
    chosen.value = null;
    readSetup();
    go("choose", true);
    return;
  }
  emit("close", reason, card);
}

// A request to show one provider (from a session, Colleague or a route): the
// card's Manage when it has connections, else its connect step; a catalogue
// provider with its revision, opencode or anything unknown goes to the key
// editor, provider picker or Add a connection.
function openProvider(providerId = "", options = {}) {
  const id = String(providerId || "").trim();
  const revision = Boolean(String(options.providerRevision || "").trim());
  const card = revision ? null : cards.value.find((item) => item.matches.native.includes(id) || item.matches.curated.includes(id));
  if (!card || !props.canConfigure) {
    manager.openProvider(id, options);
    return;
  }
  if (cardRows(card).length) openManage(card);
  else connect(card, "have");
}

function focusTitle() {
  nextTick(() => stage.value?.querySelector("h1")?.focus({ preventScroll: true }));
}

function connect(card, step = "") {
  chosen.value = card;
  signUp.value = step;
  resetAttempt();
  go("connect");
}

function makeMainAi(card) {
  chosen.value = card;
  resetAttempt();
  makeMain.value = true;
  return finish();
}

function keep(card) {
  chosen.value = card;
  resetAttempt();
  return finish({ keep: true });
}

// The card's configured connections, working or not.
function cardRows(card) {
  return card ? aiOnboardingRows(card, manager.configuredAiRows.value) : [];
}

// Cards with connections of their own or of their free option.
function configured(card) {
  return card.connected || cardRows(card).length > 0 || cardRows(card.free).length > 0;
}

function openManage(card) {
  managedCard.value = card;
  manageOpen.value = true;
}

function cardClass(card) {
  return { "aio-card--featured": card.crown, "aio-card--connected": card.connected,
    "aio-card--reconnect": cardAction(card) === "reconnect", "aio-card--collapsed": !expanded(card) };
}

// Configured but none of its connections works any more.
function needsReconnect(card) {
  const rows = cardRows(card);
  return rows.length > 0 && !rows.some((row) => row.kind === "opencode" ? row.connected !== false : row.connected === true);
}

function cardAction(card) {
  if (!card.connected) return needsReconnect(card) ? "reconnect" : "get";
  if (!wasSetUp.value) return "get";
  return usesProvider(ownerSenior.value, card) ? "keep" : "main";
}

// Notes point the person to Claude; a connected card in a redo no longer sells itself.
function cardNote(card) {
  if (cardAction(card) === "reconnect") return "";
  if (wasSetUp.value && card.connected) return "";
  return card.crown && wasSetUp.value && connectedCards.value.length ? card.upgrade : card.note;
}

// Success needs the provider connected, a Senior model of it ready and, on a
// known first setup or an explicit switch, Colleague moved onto that provider.
async function finish({ keep: keeping = false } = {}) {
  if (teamFlow.value) return finishTeam();
  const card = chosen.value;
  verifying.value = true;
  warning.value = "";
  notReady.value = false;
  try {
    const [result, current] = await Promise.all([setup.verify(card), setup.refreshColleague()]);
    if (!result.connected) {
      warning.value = `${card.name} isn't connected yet. Finish the connection step, then try again.`;
      if (screen.value !== "connect") go("connect");
      return;
    }
    chosenEngine.value = result.engineId;
    if (wasSetUp.value && !keeping && !routingReviewed.value && result.routingWouldChange) {
      currentSenior.value = result.currentSenior;
      autoRouting.value = !result.currentSenior;
      go("routing");
      return;
    }
    if (!result.available) {
      notReady.value = true;
      if (screen.value !== "connect") go("connect");
      announcement.value = `${card.name} is connected, but no model is ready for Colleague yet.`;
      return;
    }
    let colleague = current;
    let error = "";
    if ((firstRun.value || makeMain.value) && !usesProvider(colleague, card)) {
      ({ selection: colleague = colleague, error = "" } = await setup.selectForColleague(card));
    }
    outcome.value = { routed: result.routed, colleague, error };
    go("success");
  } catch (error) {
    warning.value = error?.message || "We couldn't check the connection. Try again.";
  } finally {
    verifying.value = false;
  }
}

// Team setup: shown to the owner of a workspace with a team, once Claude is the
// connected main AI and the team setup has no model yet; Not now waits a week.
const viewer = inject(VIBE64_ASSISTANT_VIEWER_KEY, { actorKey: "local" });
const team = computed(() => setup.routing?.team.value || { available: false });
const deepseekCard = computed(() => cards.value.find(({ id }) => id === "deepseek"));
const deepseekInClaude = computed(() => Boolean(deepseekCard.value?.through.includes("claude")));
const teamUnset = computed(() => Boolean(ownerRoles.value) &&
  ASSISTANT_SETUP_ROLES.nonOwner.every((role) => !setup.routing.setups.value.nonOwner?.roles?.[role]?.configured));
const claudeMain = computed(() => ownerSenior.value?.engineId === "claude" && ownerSenior.value.modelProviderId === "anthropic" &&
  setup.routing?.viewerDecisions.value.senior?.available === true);
const teamCardState = computed(() => {
  if (!props.canConfigure || !wasSetUp.value) return "";
  if (teamSummary.value) return "ready";
  return team.value.available && claudeMain.value && teamUnset.value && (!teamSnoozed.value || props.focus === "team") ? "offer" : "";
});
watch(() => unref(viewer)?.actorKey, (actorKey) => { teamSnoozed.value = aiTeamSetupSnoozed(actorKey); }, { immediate: true });
// Opened for the team ("Set up team AI"): lead with the team card, or open the
// team members' models when there is no card to offer. Once per opening.
let teamFocusHandled = false;
watch(() => props.focus, () => { teamFocusHandled = false; });
watch([() => props.focus, teamCardState, () => Boolean(ownerRoles.value)], async ([focus, state, loaded]) => {
  if (focus !== "team" || !loaded || teamFocusHandled) return;
  teamFocusHandled = true;
  if (!state) {
    if (props.canConfigure) openModels("nonOwner");
    return;
  }
  await nextTick();
  teamCard.value?.$el?.scrollIntoView?.({ block: "center" });
  teamCard.value?.$el?.focus?.({ preventScroll: true });
}, { immediate: true });

function snoozeTeam() {
  snoozeAiTeamSetup(unref(viewer)?.actorKey);
  teamSnoozed.value = true;
}

// Add a DeepSeek key: the DeepSeek connect step (inside Claude Code), then the
// team setup fills; with DeepSeek already in Claude Code it fills at once.
function startTeamSetup() {
  teamError.value = "";
  if (deepseekInClaude.value) return fillTeam();
  connect(deepseekCard.value, "have");
  teamFlow.value = true;
}

async function fillTeam() {
  teamBusy.value = true;
  try {
    const result = await setup.fillTeamSetup({ modelProviderId: "deepseek", engineId: "claude" });
    teamSummary.value = result.ok ? result.summary : "";
    teamError.value = result.ok ? "" : result.error;
    if (result.ok) announcement.value = "Team AI is ready.";
    return result;
  } finally {
    teamBusy.value = false;
  }
}

async function finishTeam() {
  verifying.value = true;
  warning.value = "";
  try {
    await setup.reload();
    if (!deepseekInClaude.value) {
      warning.value = "DeepSeek isn't connected in Claude Code yet. Finish the connection step, then try again.";
      return;
    }
    const result = await fillTeam();
    if (!result.ok) {
      warning.value = result.error;
      return;
    }
    teamFlow.value = false;
    chosen.value = null;
    go("choose", true);
  } finally {
    verifying.value = false;
  }
}

// Models: the setup screen with both setups; Team members opens on theirs.
function openModels(initialSetup = "owner") {
  manager.routingSetup.value = initialSetup;
  manager.routingOpen.value = true;
}
watch(() => manager.teamKeyRequests.value, startTeamSetup);
// The overview's one-line Models summary: main chat's Senior and Junior, and the team's Colleague.
const modelsSummary = computed(() => {
  const text = (setupId, role) => {
    const state = setup.routing?.setups.value?.[setupId]?.roles?.[role];
    return state ? routingSelectionText(state.choices, state.effective) : "";
  };
  return [["Senior", text("owner", "senior")], ["Junior", text("owner", "junior")],
    ...(team.value.available ? [["Team members", text("nonOwner", "colleague") || "Not set up"]] : [])]
    .filter(([, value]) => value);
});

function reviewRouting() {
  fullRouting.value = true;
  go("routing");
}

function routingDone() {
  routingReviewed.value = true;
  return finish();
}

// "Use" saves the routing suggestions through the routing form; a failed save
// leaves the form open with its errors.
async function useAsMain() {
  makeMain.value = true;
  await routingForm.value?.applySuggested();
  if (screen.value !== "routing") return;
  autoRouting.value = false;
  routingDetails.value = true;
}

async function switchColleague() {
  verifying.value = true;
  try {
    const { selection = outcome.value.colleague, error = "" } = await setup.selectForColleague(chosen.value);
    outcome.value = { ...outcome.value, colleague: selection, error };
  } finally {
    verifying.value = false;
  }
}

function meterLabel([aspect, rating]) {
  return `${aspect[0].toUpperCase()}${aspect.slice(1)}: ${RATINGS[rating]}`;
}

function connectedLabel(card) {
  return cardAction(card) === "keep" ? "Connected · in use" : "Connected";
}

// Phone: lower-ranked cards collapse to a row, one open at a time; connected ones stay open.
function collapsible(card) {
  return xs.value && !card.crown && !configured(card);
}

function expanded(card) {
  return !collapsible(card) || expandedId.value === card.id;
}

watch(busy, (value) => emit("busy", value));

// Inline, a route naming a provider without a catalogue revision opens its
// card once connections are read (the manager opens revision-bearing ones).
const route = useRoute();
let routedProviderId = "";
watch(() => [props.inline ? String(route?.query?.providerId || "") : "", String(route?.query?.providerRevision || ""),
  manager.accountsInitialLoading.value], ([id, revision, loading]) => {
  if (!id || revision || loading || id === routedProviderId) return;
  routedProviderId = id;
  openProvider(id, { providerLabel: String(route.query.providerLabel || "") });
}, { immediate: true });

// The shell's top bar and phone dock follow the stage.
defineExpose({ busy, doneLabel, screen, skippable, wasSetUp, back: () => go("choose", true), openProvider });
</script>


<template>
  <div
    ref="stage" class="ai-setup" :class="{ 'ai-setup--phone': xs, 'ai-setup--pointer': pointerMoved, 'ai-setup--inline': inline }"
    @pointermove.once="pointerMoved = true"
  >
    <Transition :name="`aio-${direction}`" mode="out-in" @after-enter="focusTitle">
      <section v-if="screen === 'choose'" key="choose" class="ai-onboarding__choose">
        <header class="ai-onboarding__intro">
          <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">{{ wasSetUp ? "Your AI setup" : "Pick the AI behind Vibe64" }}</h1>
          <p class="ai-onboarding__lede">
            {{ wasSetUp ? "Keep what you have, switch your main AI, or add another. Nothing is removed."
              : "Ranked by how good Vibe64 feels. Our honest advice: Claude." }}
          </p>
        </header>
        <div v-if="wasSetUp && currentMarks.length" class="aio-current" role="group" aria-label="Currently using">
          <span class="aio-current__marks">
            <AiOnboardingMark v-for="card in currentMarks" :key="card.id" :provider="{ ...card, crown: false }" :size="36" />
          </span>
          <span class="aio-current__text">
            <span class="aio-current__label">{{ mainCard ? "Currently using" : "Connected" }}</span>
            <span class="aio-current__value">
              {{ mainAi ? `Main AI: ${mainAi.label}` : currentNames.join(", ") }}
            </span>
          </span>
          <v-btn
            v-if="mainCard" color="primary" variant="flat" size="large" :disabled="verifying && chosen?.id !== mainCard.id" :loading="verifying && chosen?.id === mainCard.id"
            class="aio-current__keep" @click="keep(mainCard)"
          >
            Keep using {{ mainCard.name }}
          </v-btn>
          <span v-else class="aio-current__hint">
            <v-icon :icon="mdiArrowDown" size="18" aria-hidden="true" />Choose a main AI below. We recommend Claude.
          </span>
        </div>
        <AiTeamSetupCard
          v-if="teamCardState" ref="teamCard" :state="teamCardState" :key-connected="deepseekInClaude" :busy="teamBusy"
          :error="teamError" :summary="teamSummary" @add="startTeamSetup" @snooze="snoozeTeam" @review="openModels('nonOwner')"
        />
        <v-alert v-if="loadError" type="error" variant="tonal" class="mb-6">
          We couldn't check your current AI connections.
          <template #append><v-btn variant="text" @click="setup.reload()">Try again</v-btn></template>
        </v-alert>
        <AiWaitStatus :active="verifying" :label="verifyLabel" class="mb-6" />
        <div class="ai-onboarding__cards">
          <article
            v-for="(card, index) in orderedCards" :key="card.id"
            class="aio-card" :class="cardClass(card)"
            :style="{ '--aio-index': index }" :aria-labelledby="`aio-card-${card.id}`"
          >
            <span v-if="card.crown" class="aio-card__ribbon">Recommended</span>
            <span v-if="card.connected" class="aio-card__connected">
              <v-icon :icon="mdiCheckCircle" size="16" aria-hidden="true" />{{ connectedLabel(card) }}<slot name="connection-access" :card="card" place="badge" />
            </span>
            <span v-else-if="cardAction(card) === 'reconnect'" class="aio-card__connected aio-card__connected--warn">
              <v-icon :icon="mdiAlertCircleOutline" size="16" aria-hidden="true" />Reconnect required
            </span>
            <component
              :is="collapsible(card) ? 'button' : 'div'" class="aio-card__head"
              :type="collapsible(card) ? 'button' : undefined"
              :aria-expanded="collapsible(card) ? String(expanded(card)) : undefined"
              @click="collapsible(card) && (expandedId = expandedId === card.id ? '' : card.id)"
            >
              <span v-if="!card.crown" class="aio-card__rank" aria-hidden="true">{{ card.rank }}</span>
              <AiOnboardingMark
                :provider="card" :size="card.crown ? (xs ? 52 : 64) : 44"
                :settle-delay="card.crown ? CROWN_SETTLE_MS : -1"
              />
              <span class="aio-card__identity">
                <span :id="`aio-card-${card.id}`" class="aio-card__name">{{ card.name }}</span>
                <span class="aio-card__tagline">{{ card.tagline }}</span>
              </span>
              <v-icon v-if="collapsible(card)" :icon="mdiChevronDown" class="aio-card__chevron" aria-hidden="true" />
            </component>
            <slot v-if="card.connected" name="connection-access" :card="card" place="card" />
            <template v-if="expanded(card)">
              <div class="aio-card__facts">
                <v-skeleton-loader v-if="!loaded && !loadError" type="chip" width="120" height="24" />
                <ul class="aio-card__bullets">
                  <li v-for="bullet in card.bullets" :key="bullet[0]">
                    <span
                      class="aio-meter" :class="{ 'aio-meter--low': bullet[1] <= 2 }" role="img"
                      :aria-label="meterLabel(bullet)" :title="meterLabel(bullet)"
                    >
                      <i v-for="segment in 5" :key="segment" :class="{ 'is-filled': segment <= bullet[1] }" />
                    </span>
                    <span>{{ bullet[2] }}</span>
                  </li>
                </ul>
                <p v-if="card.why" class="aio-card__why">{{ card.why }}</p>
              </div>
              <div class="aio-card__note-row">
                <p v-if="cardNote(card)" class="aio-card__note">
                  <v-icon :icon="mdiInformationOutline" size="18" aria-hidden="true" />{{ cardNote(card) }}
                </p>
              </div>
              <div class="aio-card__offer">
                <div v-if="cardAction(card) === 'get'" class="aio-plan">
                  <span class="aio-plan__name">{{ card.plan.name }}</span>
                  <span class="aio-plan__price">{{ card.plan.price }}</span>
                  <span v-if="card.plan.budget" class="aio-plan__budget">{{ card.plan.budget }}</span>
                  <span v-if="card.plan.more" class="aio-plan__more">{{ card.plan.more }}</span>
                </div>
                <div class="aio-card__ctas">
                  <v-btn
                    v-if="cardAction(card) === 'main'" color="primary" variant="tonal" size="large"
                    :disabled="verifying" :aria-label="`Use ${card.name} as my main AI`" @click="makeMainAi(card)"
                  >
                    {{ card.crown ? `Use ${card.name} as my main AI` : "Use as main AI" }}
                  </v-btn>
                  <v-btn
                    v-else-if="cardAction(card) === 'reconnect'" color="warning" variant="flat" size="large"
                    :disabled="verifying" @click="connect(card, 'have')"
                  >
                    Reconnect {{ card.name }}
                  </v-btn>
                  <template v-else-if="cardAction(card) === 'get'">
                    <v-btn
                      color="primary" :variant="CTA_VARIANT[card.rank - 1]" size="large"
                      :href="card.signUp.url" target="_blank" rel="noopener noreferrer" :append-icon="mdiOpenInNew"
                      @click="connect(card, 'opened')"
                    >
                      Get {{ card.name }}<span class="d-sr-only"> (opens in a new tab)</span>
                    </v-btn>
                    <v-btn variant="text" color="primary" class="aio-card__link" @click="connect(card, 'have')">{{ card.have }}</v-btn>
                  </template>
                  <v-btn
                    v-if="cardRows(card).length" variant="text" color="primary" class="aio-card__link" :prepend-icon="mdiTuneVariant"
                    :aria-label="`Manage ${card.name}`" @click="openManage(card)"
                  >
                    Manage
                  </v-btn>
                </div>
                <p v-if="neededTool(card)" class="aio-card__needs">
                  <v-icon :icon="mdiLaptop" size="18" aria-hidden="true" />Needs {{ neededTool(card).label }} on this computer
                </p>
                <div v-if="card.free" class="aio-card__free">
                  <p class="aio-card__free-label">
                    <strong>{{ card.free.label }}</strong>
                    <span>{{ card.free.connected ? "Connected." : card.free.detail }}</span>
                    <span v-if="neededTool(card.free)" class="aio-card__needs">
                      <v-icon :icon="mdiLaptop" size="18" aria-hidden="true" />Needs {{ neededTool(card.free).label }} on this computer
                    </span>
                  </p>
                  <v-btn
                    v-if="!card.free.connected" variant="outlined" color="primary" :href="card.free.signUp.url" target="_blank"
                    rel="noopener noreferrer" :append-icon="mdiOpenInNew" @click="connect(card.free, 'opened')"
                  >
                    Start free<span class="d-sr-only"> (opens Z.AI in a new tab)</span>
                  </v-btn>
                  <v-btn v-if="!card.free.connected" variant="text" color="primary" class="aio-card__link" @click="connect(card.free, 'have')">
                    {{ card.free.have }}
                  </v-btn>
                  <v-btn
                    v-else-if="cardAction(card.free) === 'main'" variant="text" color="primary" :disabled="verifying"
                    @click="makeMainAi(card.free)"
                  >
                    Use the free option as my main AI
                  </v-btn>
                  <v-btn
                    v-if="cardRows(card.free).length && !cardRows(card).length" variant="text" color="primary" class="aio-card__link"
                    :prepend-icon="mdiTuneVariant" :aria-label="`Manage ${card.free.name}`" @click="openManage(card)"
                  >
                    Manage
                  </v-btn>
                </div>
              </div>
            </template>
          </article>
        </div>
        <section v-if="canConfigure && wasSetUp && modelsSummary.length" class="aio-models" aria-labelledby="aio-models-title">
          <div class="aio-models__text">
            <h2 id="aio-models-title" class="aio-models__title">Models</h2>
            <dl class="aio-models__list">
              <div v-for="[label, value] in modelsSummary" :key="label"><dt>{{ label }}</dt><dd>{{ value }}</dd></div>
            </dl>
          </div>
          <v-btn color="primary" variant="tonal" :prepend-icon="mdiTuneVariant" class="aio-models__open" @click="openModels()">Review models</v-btn>
        </section>
        <AiSetupAdvanced v-if="showAdvanced" :other-rows="otherRows">
          <template #connection-access="scope"><slot name="connection-access" v-bind="scope" /></template>
        </AiSetupAdvanced>
        <p class="ai-onboarding__footnote">Prices are set by each provider and can change. You pay them directly; Vibe64 never resells AI.</p>
        <v-btn v-if="xs && skippable" block variant="text" class="mt-4" @click="close('later')">Set up later</v-btn>
      </section>

      <section v-else-if="screen === 'connect'" key="connect" class="ai-onboarding__connect">
        <v-btn v-if="ownButtons" variant="text" class="aio-back" :prepend-icon="mdiArrowLeft" :disabled="busy" @click="go('choose', true)">Back</v-btn>
        <header class="aio-chosen">
          <AiOnboardingMark :provider="chosen" :size="56" :settle-delay="chosen.crown ? 150 : -1" />
          <div class="aio-chosen__text">
            <h1 id="ai-onboarding-title" tabindex="-1" class="aio-chosen__title">Connect {{ chosen.name }}</h1>
            <p class="aio-chosen__plan">
              <template v-if="teamFlow">For team members · runs inside Claude Code</template>
              <template v-else>{{ chosen.plan.name }} · <span class="aio-tabular">{{ chosen.plan.price }}</span></template>
            </p>
          </div>
        </header>
        <ol class="aio-checklist">
          <li :class="{ 'is-done': signUp === 'opened' }">
            <span class="aio-checklist__marker" aria-hidden="true">
              <v-icon v-if="signUp === 'opened'" :icon="mdiCheck" size="18" /><template v-else>1</template>
            </span>
            <div>
              <h2 class="aio-checklist__title">
                {{ signUp === "have" ? chosen.haveTitle : "Get a plan" }}<span v-if="signUp === 'opened'" class="d-sr-only"> (done)</span>
              </h2>
              <p class="aio-checklist__body">
                {{ signUp === "have" ? "Go straight to the next step. Need one after all? Open the sign-up page." : [chosen.signUp.step, chosen.plan.budget].filter(Boolean).join(" ") }}
              </p>
              <v-btn
                variant="tonal" color="primary" :href="chosen.signUp.url" target="_blank" rel="noopener noreferrer"
                :append-icon="mdiOpenInNew" @click="signUp = 'opened'"
              >
                {{ chosen.signUp.label }}<span class="d-sr-only"> (opens in a new tab)</span>
              </v-btn>
            </div>
          </li>
          <li>
            <span class="aio-checklist__marker" aria-hidden="true">2</span>
            <div class="aio-checklist__setup">
              <h2 class="aio-checklist__title">{{ chosen.connectStep.title }}</h2>
              <p class="aio-checklist__body">{{ chosen.connectStep.body }}</p>
              <AIAccountsSetup
                v-if="nativeLogin" embedded :provider-id="chosen.connect.engineId"
                :model-provider-id="chosen.connect.modelProviderId" @connected="finish()" @back="go('choose', true)"
              />
              <CliInstallNotice v-else-if="missingTool" :account="missingTool" :checking="checkingTools" @check="checkTools">
                <v-btn variant="text" @click="go('choose', true)">Choose another AI</v-btn>
              </CliInstallNotice>
              <AiOnboardingKeyConnect
                v-else-if="chosen.connect.engineId === 'opencode'" :model-provider-id="chosen.connect.modelProviderId"
                :label="chosen.name" @busy="setupBusy = $event" @connected="finish()"
              />
              <NativeProviderConnections
                v-else embedded adding :select-provider="false" :engine-id="chosen.connect.engineId"
                :model-value="chosen.connect.modelProviderId" @busy="setupBusy = $event" @close="finish()"
              />
              <AiWaitStatus :active="verifying" :label="verifyLabel" class="mt-4" />
              <v-alert v-if="warning" type="warning" variant="tonal" class="mt-4">
                {{ warning }}
                <template #append><v-btn variant="text" :disabled="busy" @click="finish()">Try again</v-btn></template>
              </v-alert>
              <v-alert v-if="notReady" type="warning" variant="tonal" class="mt-4">
                {{ chosen.name }} is connected, but no model is ready for Colleague yet.
                <template #append><v-btn variant="text" @click="reviewRouting">Review models</v-btn></template>
              </v-alert>
              <p v-if="nativeLogin" class="ai-onboarding__security">
                <v-icon :icon="mdiShieldLockOutline" size="18" aria-hidden="true" />
                Your sign-in is stored privately, outside your projects.
              </p>
            </div>
          </li>
        </ol>
        <v-btn v-if="xs && skippable" block variant="text" class="mt-6" :disabled="busy" @click="close('later')">Set up later</v-btn>
      </section>

      <section v-else-if="screen === 'routing'" key="routing" class="ai-onboarding__routing">
        <v-btn v-if="ownButtons" variant="text" class="aio-back" :prepend-icon="mdiArrowLeft" :disabled="busy" @click="go('choose', true)">Back</v-btn>
        <header class="ai-onboarding__intro">
          <AiOnboardingMark v-if="!fullRouting" :provider="chosen" :size="56" class="mb-5" />
          <p class="ai-onboarding__eyebrow">YOUR MAIN AI</p>
          <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
            {{ fullRouting ? "Review models" : autoRouting ? `Setting up ${chosen.name}…` : `Build with ${chosen.name}?` }}
          </h1>
          <p v-if="!fullRouting && !autoRouting" class="ai-onboarding__lede">{{ chosen.name }} is connected. Choose what Vibe64 builds with.</p>
        </header>
        <div v-if="autoRouting" class="aio-progress" role="status">
          <v-progress-circular indeterminate color="primary" size="24" width="3" />Making {{ chosen.name }} your main AI
        </div>
        <div v-else-if="!fullRouting" class="aio-options" role="group" aria-label="Your main AI">
          <button type="button" class="aio-option aio-option--primary" :disabled="busy" @click="useAsMain">
            <span class="aio-option__title">Use {{ chosen.name }} for building</span>
            <span class="aio-option__body">Vibe64 uses {{ chosen.name }} for its main work. {{ currentSenior?.name }} stays connected.</span>
            <v-progress-circular v-if="routingBusy" indeterminate size="20" width="2" class="aio-option__busy" />
          </button>
          <button type="button" class="aio-option" :disabled="busy" @click="routingDone">
            <span class="aio-option__title">Keep {{ currentSenior?.name }} for building</span>
            <span class="aio-option__body">{{ chosen.name }} stays connected and ready in AI Accounts.</span>
          </button>
        </div>
        <v-btn
          v-if="!fullRouting && !autoRouting" variant="text" class="aio-details-toggle" :append-icon="mdiChevronDown"
          :class="{ 'is-open': routingDetails }" :aria-expanded="String(routingDetails)" @click="routingDetails = !routingDetails"
        >
          {{ routingDetails ? "Hide details" : "Show details" }}
        </v-btn>
        <div v-show="fullRouting || routingDetails" class="ai-onboarding__panel">
          <ModelRoutingForm
            ref="routingForm"
            :plain="!fullRouting"
            :connection-id="fullRouting ? '' : chosen.connect.modelProviderId"
            :connection-label="fullRouting ? '' : chosen.name"
            :prefer-engine-id="fullRouting ? '' : chosenEngine"
            @busy="routingBusy = $event" @saved="routingDone" @close="routingDone"
          />
        </div>
      </section>

      <section v-else-if="screen === 'success'" key="success" class="ai-onboarding__success">
        <div class="aio-success-mark" :class="`aio-success-mark--${chosen.tone}`">
          <AiOnboardingMark :provider="chosen" :size="96" :settle-delay="chosen.crown ? 350 : -1" />
          <svg v-if="proven" class="aio-check" viewBox="0 0 40 40" aria-hidden="true">
            <circle cx="20" cy="20" r="18" />
            <path d="M12 20.5 l5.5 5.5 l10.5 -11" />
          </svg>
        </div>
        <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
          {{ hello.state === "failed" ? "Almost there" : hello.state === "waiting" ? `${chosen.name} is connected` : `${chosen.name} is ready` }}
        </h1>
        <p v-if="colleagueNote !== 'menu' && hello.state !== 'failed'" class="ai-onboarding__lede">
          {{ learn ? `Next: ${inLesson ? "back to your lesson" : "choose a lesson"}.` : "Next: Colleague opens so you can ask it to build your first page." }}
        </p>
        <div
          v-if="colleagueNote === 'uses'" class="aio-proof" :class="{ 'aio-proof--failed': hello.state === 'failed' }"
          :aria-busy="hello.state === 'waiting' ? 'true' : undefined"
        >
          <span class="aio-proof__avatar" aria-hidden="true">
            <svg viewBox="0 0 24 24"><path :d="hello.state === 'failed' ? mdiAlertCircleOutline : mdiRobotHappyOutline" /></svg>
          </span>
          <div class="aio-proof__body">
            <template v-if="hello.state === 'failed'">
              <span class="aio-proof__name">Colleague couldn't reach {{ chosen.name }}</span>
              <p class="aio-proof__reply">{{ hello.error }}</p>
              <div class="aio-proof__actions">
                <v-btn color="primary" variant="tonal" @click="sayHello">Retry</v-btn>
                <v-btn variant="text" color="primary" @click="go('connect', true)">Check connection</v-btn>
                <v-btn variant="text" @click="hello.state = 'dismissed'">Continue anyway</v-btn>
              </div>
            </template>
            <template v-else>
              <span class="aio-proof__name">Colleague</span>
              <span v-if="hello.state === 'waiting'" class="aio-proof__typing" role="status">
                <span class="d-sr-only">Colleague is replying…</span><i /><i /><i />
              </span>
              <p v-else-if="hello.state === 'replied'" class="aio-proof__reply">{{ hello.reply }}</p>
              <p v-else class="aio-proof__reply aio-proof__reply--quiet">
                {{ learn ? `Your teacher uses ${chosen.name} from your next message.` : "Ready when you are. Say hi in the Colleague panel." }}
              </p>
            </template>
          </div>
        </div>
        <div v-else-if="colleagueNote === 'switch'" class="ai-onboarding__colleague">
          <v-chip v-if="outcome.colleague" variant="tonal">Colleague: still using {{ outcome.colleague.label }}</v-chip>
          <v-btn variant="tonal" color="primary" :loading="verifying" @click="switchColleague">Use {{ chosen.name }} for Colleague</v-btn>
        </div>
        <p v-else class="ai-onboarding__lede">Choose {{ chosen.name }} in Colleague's model menu to use it there.</p>
        <v-alert v-if="outcome.error" type="warning" variant="tonal" class="ai-onboarding__colleague-error">
          Colleague couldn't switch to {{ chosen.name }}: {{ outcome.error }}
        </v-alert>
        <dl v-if="colleagueNote === 'uses'" class="aio-recap">
          <dt>Main AI</dt>
          <dd>{{ mainAi?.card.id === chosen.id ? mainAi.label : chosen.name }}<span v-if="outcome.colleague?.label"> · {{ outcome.colleague.label }}</span></dd>
        </dl>
        <p class="ai-onboarding__note">Change it any time in {{ changeWhere }}.</p>
        <p v-if="!outcome.routed" class="ai-onboarding__note">
          Your current models stay as they are. {{ chosen.name }} is ready in AI Accounts whenever you want it.
        </p>
        <slot name="connection-access" :card="chosen" place="success" />
        <v-btn v-if="ownButtons" color="primary" variant="flat" size="large" :block="xs" :append-icon="mdiArrowRight" @click="close('done')">{{ inline ? "Done" : doneLabel }}</v-btn>
      </section>

      <section v-else key="owner" class="ai-onboarding__success">
        <v-icon :icon="mdiAlertCircleOutline" size="48" color="primary" aria-hidden="true" />
        <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">{{ ownerNotice }}</h1>
        <v-btn variant="tonal" color="primary" size="large" @click="openModels('nonOwner')">See team members' models</v-btn>
        <v-btn color="primary" variant="flat" size="large" @click="close('dismiss')">Close</v-btn>
      </section>
    </Transition>
    <p class="d-sr-only" aria-live="polite">{{ announcement }}</p>
    <AiProviderManage v-model="manageOpen" :card="managedCard" @connect="connect($event, 'have')">
      <template #connection-access="scope"><slot name="connection-access" v-bind="scope" /></template>
    </AiProviderManage>
    <AiConnectionDialogs />
  </div>
</template>

<style scoped>
.ai-setup {
  --aio-crown: #f5c518;
  --aio-crown-ink: #2b2100;
  --aio-crown-strong: #8a6a00;
  --aio-type-body-sm: 400 0.8125rem/1.125rem var(--v64-font-family);
  --aio-stage-top: clamp(24px, 6vh, 72px);
  --v64-on-success-container: color-mix(in srgb, var(--v64-success) 55%, #000);
  --aio-warn-ink: color-mix(in srgb, rgb(var(--v-theme-warning)) 45%, #000);
  color: var(--v64-on-surface);
  font-family: var(--v64-font-family);
}
.v-theme--dark .ai-setup {
  --aio-crown-strong: #f5c518;
  --aio-warn-ink: color-mix(in srgb, rgb(var(--v-theme-warning)) 55%, #fff);
  --v64-on-success-container: color-mix(in srgb, var(--v64-success) 45%, #fff);
}
/* One button shape across the flow, embedded AI Accounts parts included. */
.ai-setup :deep(.v-btn:not(.v-btn--icon)) { border-radius: var(--v64-shape-md); letter-spacing: 0; text-transform: none; }
/* Dark: filled primary buttons take dark ink on a lighter primary (AA contrast). */
.v-theme--dark .ai-setup :deep(.v-btn--variant-flat.bg-primary:not(.v-btn--disabled)) {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 45%, #fff) !important;
  color: #0b1d33 !important;
}
/* Disabled primaries use the neutral disabled tokens, not a faded primary. */
.ai-setup :deep(.v-btn--disabled.v-btn--variant-flat) {
  background: color-mix(in srgb, var(--v64-on-surface) 12%, transparent) !important;
  color: color-mix(in srgb, var(--v64-on-surface) 38%, transparent) !important;
  opacity: 1;
}
.ai-setup :deep(.v-btn--disabled .v-btn__overlay) { opacity: 0; }
/* Touch: a tap leaves no hover layer behind on the control now under the finger. */
@media (hover: none) {
  .ai-setup :deep(.v-btn:hover:not(:focus-visible) > .v-btn__overlay) { opacity: 0; }
}
/* Field helper text and alerts in the flow's type scale. */
.ai-setup :deep(.v-messages),
.ai-setup :deep(.text-body-small) { font: var(--aio-type-body-sm); letter-spacing: 0; }
.ai-setup :deep(.v-alert-title) { font: var(--v64-type-title-md); letter-spacing: 0; margin-bottom: 2px; }
.ai-setup :deep(.v-alert__content) { font: var(--v64-type-body-md); }
.aio-tabular { font-variant-numeric: tabular-nums; }

/* Stage: content sits at a fixed offset from the top, never floating mid-screen. */
.ai-setup > section { margin-inline: auto; max-width: 1040px; padding-top: var(--aio-stage-top); width: 100%; }
.ai-setup > .ai-onboarding__choose { padding-top: var(--v64-space-3); }
.ai-setup--phone > section { padding-top: var(--v64-space-4); }
/* Inline: the page or dialog around it sets the spacing, not its type. */
.ai-setup--inline { letter-spacing: normal; }
.aio-card__facts :deep(.v-skeleton-loader) { background: transparent; }
.ai-setup--inline > section, .ai-setup--inline > .ai-onboarding__choose { padding-top: 0; }
.ai-onboarding__eyebrow {
  color: var(--v64-primary);
  font: var(--v64-type-label-lg);
  letter-spacing: 0.12em;
  margin: 0 0 var(--v64-space-3);
}
.ai-onboarding__headline {
  font: var(--v64-type-display-sm);
  letter-spacing: -0.02em;
  margin: 0 0 var(--v64-space-4);
  outline: none;
  text-wrap: balance;
}
.ai-onboarding__lede {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-lg);
  margin: 0 0 var(--v64-space-4);
  max-width: 60ch;
  text-wrap: pretty;
}
.ai-onboarding__footnote { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: var(--v64-space-6) 0 0; }
.ai-onboarding__intro { margin-bottom: var(--v64-space-6); }
/* Choose: a compact header, so the cards start near the top. */
.ai-onboarding__choose .ai-onboarding__intro { margin-bottom: var(--v64-space-5); }
.ai-onboarding__choose .ai-onboarding__headline { font: var(--v64-type-headline-md); margin-bottom: var(--v64-space-1); }
.ai-onboarding__choose .ai-onboarding__lede { margin: 0; }
.ai-onboarding__choose .ai-onboarding__footnote { margin-top: var(--v64-space-4); }
.aio-back { margin: 0 0 var(--v64-space-4) calc(var(--v64-space-4) * -1); }

/* Rating meters: five segments, low ratings in the warning tone. */
.aio-meter { display: inline-flex; flex: none; gap: 3px; }
.aio-meter i { border-radius: 3px; box-shadow: inset 0 0 0 1px var(--v64-outline); height: 6px; width: 10px; }
.aio-meter i.is-filled { background: var(--v64-primary); box-shadow: none; }
.aio-meter--low i.is-filled { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, transparent); }

/* Currently using (redo) */
.aio-current {
  align-items: center;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-3) var(--v64-space-4);
  margin: calc(var(--v64-space-2) * -1) 0 var(--v64-space-6);
  padding: var(--v64-space-4) var(--v64-space-5);
}
.aio-current__marks { display: flex; gap: var(--v64-space-2); }
.aio-current__text { display: grid; flex: 1 1 12rem; }
.aio-current__label { color: var(--v64-on-surface-variant); font: var(--v64-type-label-md); letter-spacing: 0.06em; text-transform: uppercase; }
.aio-current__value { font: var(--v64-type-title-md); }
.aio-current__hint { align-items: center; color: var(--v64-primary); display: inline-flex; font: var(--v64-type-label-lg); gap: var(--v64-space-1); }

/* Models: the overview's one-line summary of the AI setup. */
.aio-models {
  align-items: center;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-3) var(--v64-space-5);
  margin-top: var(--v64-space-6);
  padding: var(--v64-space-4) var(--v64-space-5);
}
.aio-models__text { display: grid; flex: 1 1 18rem; gap: var(--v64-space-1); min-width: 0; }
.aio-models__title { font: var(--v64-type-title-md); margin: 0; }
.aio-models__list { display: flex; flex-wrap: wrap; font: var(--v64-type-body-md); gap: var(--v64-space-1) var(--v64-space-5); margin: 0; }
.aio-models__list div { display: flex; gap: var(--v64-space-2); min-width: 0; }
.aio-models__list dt { color: var(--v64-on-surface-variant); }
.aio-models__list dd { margin: 0; overflow-wrap: anywhere; }
.aio-models__open { min-height: 44px; }

/* Provider cards: one column, Claude first. On desktop each card is one row:
   Claude's offer sits beside its facts; the others run head, facts, plan, actions. */
.ai-onboarding__cards { display: grid; gap: var(--v64-space-4); }
.aio-card {
  animation: aio-rise var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) both;
  animation-delay: calc(var(--aio-index) * 40ms);
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-3);
  min-width: 0;
  padding: var(--v64-space-4) var(--v64-space-5);
  position: relative;
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard), box-shadow var(--v64-duration-short) var(--v64-ease-standard);
}
@media (hover: hover) {
  .ai-setup--pointer .aio-card:hover { border-color: var(--v64-outline); box-shadow: var(--v64-elevation-1); }
}
.aio-card--featured {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 10%, var(--v64-surface)), var(--v64-surface) 55%);
  border-radius: var(--v64-shape-xl);
  box-shadow: 0 24px 48px -30px color-mix(in srgb, var(--aio-crown-strong) 60%, transparent), var(--v64-elevation-1);
  padding: var(--v64-space-5) var(--v64-space-6) var(--v64-space-4);
}
@media (hover: hover) {
  .ai-setup--pointer .aio-card--featured:hover { box-shadow: 0 28px 56px -30px color-mix(in srgb, var(--aio-crown-strong) 70%, transparent), var(--v64-elevation-2); }
}
.v-theme--dark .aio-card--featured {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 14%, var(--v64-surface)), var(--v64-surface) 60%);
  border-color: color-mix(in srgb, var(--aio-crown) 35%, var(--v64-outline-variant));
}
@media (min-width: 960px) {
  .aio-card { column-gap: var(--v64-space-5); display: grid; row-gap: var(--v64-space-2); }
  .aio-card__head { align-self: start; grid-area: head; }
  .aio-card__facts { grid-area: facts; }
  .aio-card__note-row { grid-area: note; }
  .aio-card--featured {
    column-gap: var(--v64-space-7);
    grid-template-areas: "head offer" "facts offer" "note offer";
    grid-template-columns: minmax(0, 1fr) minmax(0, 25rem);
    grid-template-rows: auto auto 1fr;
    row-gap: var(--v64-space-3);
  }
  .aio-card--featured .aio-card__facts { padding-left: calc(64px + var(--v64-space-6)); }
  .aio-card--featured .aio-card__offer { align-self: center; grid-area: offer; }
  .aio-card--featured .aio-card__ctas { align-items: center; grid-template-columns: auto auto; justify-content: start; }
  .aio-card--featured .aio-card__ctas .v-btn:first-child { min-width: 12rem; }
  .aio-card:not(.aio-card--featured) {
    grid-template-areas: "head facts plan ctas" "head note plan ctas" "free free free free";
    grid-template-columns: minmax(0, 15rem) minmax(0, 1fr) minmax(0, 12rem) minmax(0, 12rem);
    grid-template-rows: auto 1fr auto;
  }
  .aio-card:not(.aio-card--featured) .aio-card__offer { display: contents; }
  .aio-card:not(.aio-card--featured) .aio-plan { background: none; grid-area: plan; padding: 0; }
  .aio-card:not(.aio-card--featured) .aio-plan__more { border: 0; margin: 0; padding: 0; }
  .aio-card:not(.aio-card--featured) .aio-card__ctas { align-content: start; grid-area: ctas; }
  .aio-card:not(.aio-card--featured) .aio-card__free { grid-area: free; margin-top: var(--v64-space-1); }
}
.aio-card--connected { border: 2px solid var(--v64-success); }
.aio-card--reconnect { border: 2px solid color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, transparent); }
/* Badges straddle the top border, so they never compete with the name for width. */
.aio-card__ribbon,
.aio-card__connected {
  align-items: center;
  border-radius: var(--v64-shape-full);
  box-shadow: 0 0 0 3px var(--v64-surface);
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-1);
  letter-spacing: 0.02em;
  padding: 3px 12px;
  position: absolute;
  top: -14px;
}
.aio-card__ribbon { background: var(--aio-crown); color: var(--aio-crown-ink); right: var(--v64-space-6); }
.aio-card__connected { background: var(--v64-success-container); color: var(--v64-on-success-container); left: var(--v64-space-5); }
.aio-card__connected--warn { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 22%, var(--v64-surface)); color: var(--aio-warn-ink); }
.aio-card__head {
  align-items: center;
  background: none;
  border: 0;
  color: inherit;
  display: flex;
  gap: var(--v64-space-3);
  min-width: 0;
  padding: 0;
  text-align: left;
  width: 100%;
}
.aio-card--featured .aio-card__head { gap: var(--v64-space-4); padding: var(--v64-space-4) 0 0 var(--v64-space-2); }
.aio-card__rank {
  align-items: center;
  background: var(--v64-surface-container-highest);
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-surface);
  display: inline-flex;
  flex: none;
  font: var(--v64-type-label-lg);
  height: 28px;
  justify-content: center;
  width: 28px;
}
.aio-card__identity { display: grid; flex: 1; min-width: 0; }
.aio-card__name { font: var(--v64-type-title-lg); }
.aio-card--featured .aio-card__name { font: 600 1.75rem/2.25rem var(--v64-font-family); letter-spacing: -0.015em; }
.aio-card__tagline { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.aio-card__chevron { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.aio-card__head[aria-expanded="true"] .aio-card__chevron { transform: rotate(180deg); }
.aio-card__facts { align-content: start; display: grid; gap: var(--v64-space-3); }
.aio-card__bullets { display: grid; gap: var(--v64-space-2); list-style: none; margin: 0; padding: 0; }
.aio-card__bullets li { align-items: center; display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-3); }
.aio-card--featured .aio-card__bullets li { font: var(--v64-type-body-lg); }
.aio-card__why { font: var(--v64-type-body-lg); margin: 0; }
.aio-card__free { align-items: center; border-top: 1px solid var(--v64-outline-variant); display: flex; flex-wrap: wrap;
  gap: var(--v64-space-2); margin-top: var(--v64-space-3); padding-top: var(--v64-space-3); }
.aio-card__free-label { display: grid; flex: 1 1 16rem; font: var(--v64-type-body-md); gap: 2px; margin: 0; }
.aio-card__free-label span { color: var(--v64-on-surface-variant); }
.aio-card__note { color: var(--v64-on-surface-variant); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: 0; }
.aio-card__note .v-icon { flex: none; margin-top: 1px; }
.aio-card__offer { display: grid; gap: var(--v64-space-3); }
.aio-card__needs {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-2);
  justify-content: center;
  margin: 0;
}
.aio-card__free .aio-card__needs { justify-content: flex-start; margin-top: var(--v64-space-1); }
.aio-card__note-row:empty { display: none; }

/* The plan: official name and price first, the budget advice beneath. */
.aio-plan {
  align-content: start;
  background: var(--v64-surface-container);
  border-radius: var(--v64-shape-md);
  display: grid;
  gap: 2px;
  padding: var(--v64-space-3) var(--v64-space-4);
}
.aio-card--featured .aio-plan { border-left: 3px solid var(--aio-crown); padding: var(--v64-space-3) var(--v64-space-5); }
.aio-plan__name { font: var(--v64-type-label-lg); }
.aio-plan__price { font: var(--v64-type-title-lg); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.aio-card--featured .aio-plan__price { font: 600 2rem/2.5rem var(--v64-font-family); letter-spacing: -0.02em; }
.aio-plan__budget { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.aio-plan__more { border-top: 1px solid var(--v64-outline-variant); font: var(--v64-type-label-lg); margin-top: var(--v64-space-2); padding-top: var(--v64-space-2); }
.aio-card__ctas { display: grid; gap: var(--v64-space-1); }
.aio-card__ctas .v-btn { min-height: 48px; }
.aio-card__ctas .aio-card__link { font: var(--v64-type-label-lg); height: 40px; min-height: 40px; }

/* Connect and routing: one centred column. */
.ai-setup > .ai-onboarding__connect,
.ai-setup > .ai-onboarding__routing { max-width: 560px; }
.aio-chosen { align-items: center; margin-top: var(--v64-space-6); padding-inline-start: var(--v64-space-5); animation: aio-lift var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) both; display: flex; gap: var(--v64-space-4); margin-bottom: var(--v64-space-6); }
.aio-chosen__text { flex: 1; min-width: 0; }
.aio-chosen__title { font: var(--v64-type-headline-md); letter-spacing: -0.015em; margin: 0; outline: none; }
.aio-chosen__plan { color: var(--v64-on-surface-variant); font: var(--v64-type-body-lg); margin: 2px 0 0; }
.aio-checklist { display: grid; gap: var(--v64-space-6); list-style: none; margin: 0; padding: 0; }
.aio-checklist li { display: grid; gap: var(--v64-space-4); grid-template-columns: 32px minmax(0, 1fr); }
.aio-checklist__marker {
  align-items: center;
  border: 1.5px solid var(--v64-outline);
  border-radius: var(--v64-shape-full);
  display: inline-flex;
  font: var(--v64-type-label-lg);
  height: 32px;
  justify-content: center;
  width: 32px;
}
.aio-checklist .is-done .aio-checklist__marker { background: var(--v64-primary); border-color: var(--v64-primary); color: var(--v64-on-primary); }
.aio-checklist__title { font: var(--v64-type-title-md); margin: 4px 0 0; }
.aio-checklist__body { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 4px 0 var(--v64-space-4); }
.aio-checklist__setup { min-width: 0; }
/* The embedded sign-in sits flat inside its step. */
.aio-checklist__setup :deep(.accounts-setup__item) { background: transparent; border: 0 !important; padding: 0 !important; }
.ai-onboarding__panel {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  margin-top: var(--v64-space-4);
  min-width: 0;
  padding: var(--v64-space-5);
}
.ai-onboarding__security { align-items: center; color: var(--v64-on-surface-variant); display: flex; font: var(--aio-type-body-sm); gap: var(--v64-space-2); margin: var(--v64-space-4) 0 0; }
.aio-options { display: grid; gap: var(--v64-space-3); }
.aio-option {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 2px;
  padding: var(--v64-space-4) var(--v64-space-5);
  position: relative;
  text-align: left;
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard), background-color var(--v64-duration-short) var(--v64-ease-standard);
}
.aio-option--primary { background: color-mix(in srgb, var(--v64-primary-container) 55%, var(--v64-surface)); border-color: var(--v64-primary); }
@media (hover: hover) {
  .aio-option:hover:not(:disabled) { border-color: var(--v64-primary); }
}
.aio-option:focus-visible { outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color); outline-offset: var(--v64-focus-ring-offset); }
.aio-option:disabled { cursor: default; opacity: 0.6; }
.aio-option__title { font: var(--v64-type-title-md); }
.aio-option__body { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.aio-option__busy { position: absolute; right: var(--v64-space-4); top: var(--v64-space-4); }
.aio-progress { align-items: center; color: var(--v64-on-surface-variant); display: flex; font: var(--v64-type-body-lg); gap: var(--v64-space-3); }
.aio-details-toggle { margin-top: var(--v64-space-4); }
.aio-details-toggle :deep(.v-btn__append) { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.aio-details-toggle.is-open :deep(.v-btn__append) { transform: rotate(180deg); }

/* Success */
.ai-setup > .ai-onboarding__success {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-2);
  max-width: 560px;
  text-align: center;
}
.ai-onboarding__success .ai-onboarding__lede { margin-inline: auto; }
.ai-onboarding__success > .v-btn { margin-top: var(--v64-space-5); }
.aio-success-mark {
  animation: aio-arrive var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) both;
  margin-bottom: var(--v64-space-6);
  position: relative;
}
/* A soft glow in the provider's tone behind the tile. */
.aio-success-mark::before {
  animation: aio-glow 1400ms var(--v64-ease-emphasized-decelerate) 120ms both;
  background: radial-gradient(closest-side, var(--aio-glow), transparent);
  content: "";
  inset: -56px;
  position: absolute;
  z-index: -1;
}
.aio-success-mark--primary { --aio-glow: color-mix(in srgb, var(--aio-crown) 45%, transparent); }
.aio-success-mark--secondary { --aio-glow: color-mix(in srgb, var(--v64-primary) 30%, transparent); }
.aio-success-mark--tertiary { --aio-glow: color-mix(in srgb, #b5838f 40%, transparent); }
.aio-success-mark--neutral { --aio-glow: color-mix(in srgb, var(--v64-outline) 40%, transparent); }
.aio-check {
  animation: aio-pop var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) both;
  bottom: -10px;
  height: 40px;
  position: absolute;
  right: -12px;
  width: 40px;
}
.aio-check circle { fill: var(--v64-success); stroke: var(--v64-surface); stroke-width: 3; }
.aio-check path {
  animation: aio-draw calc(var(--v64-duration-medium) + 100ms) var(--v64-ease-emphasized-decelerate) 150ms both;
  fill: none;
  stroke: #fff;
  stroke-dasharray: 28;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 3.5;
}
.aio-proof {
  align-items: flex-start;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  gap: var(--v64-space-3);
  margin: var(--v64-space-3) 0 var(--v64-space-2);
  max-width: 32rem;
  padding: var(--v64-space-4);
  text-align: left;
  width: 100%;
}
.aio-proof--failed { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 10%, var(--v64-surface)); border-color: color-mix(in srgb, rgb(var(--v-theme-warning)) 55%, transparent); }
.aio-proof__avatar {
  align-items: center;
  background: var(--v64-primary-container);
  border-radius: var(--v64-shape-full);
  display: inline-flex;
  flex: none;
  height: 36px;
  justify-content: center;
  width: 36px;
}
.aio-proof__avatar svg { fill: var(--v64-on-primary-container); height: 20px; width: 20px; }
.aio-proof--failed .aio-proof__avatar { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 22%, var(--v64-surface)); }
.aio-proof--failed .aio-proof__avatar svg { fill: rgb(var(--v-theme-warning)); }
.aio-proof__body { display: grid; gap: 2px; min-width: 0; }
.aio-proof__name { font: var(--v64-type-label-lg); }
.aio-proof__reply { font: var(--v64-type-body-lg); margin: 0; overflow-wrap: anywhere; }
.aio-proof__reply--quiet { color: var(--v64-on-surface-variant); }
.aio-proof--failed .aio-proof__reply { -webkit-box-orient: vertical; display: -webkit-box; font: var(--v64-type-body-md); -webkit-line-clamp: 3; line-clamp: 3; overflow: hidden; }
.aio-proof__actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-1); margin: var(--v64-space-2) 0 0 calc(var(--v64-space-2) * -1); }
.aio-proof__actions .v-btn:first-child { margin-left: var(--v64-space-2); }
.aio-proof__typing { display: inline-flex; gap: 4px; padding: 8px 0; }
.aio-proof__typing i {
  animation: aio-typing 1.2s ease-in-out infinite;
  background: var(--v64-on-surface-variant);
  border-radius: 50%;
  height: 7px;
  width: 7px;
}
.aio-proof__typing i:nth-child(3) { animation-delay: 0.15s; }
.aio-proof__typing i:nth-child(4) { animation-delay: 0.3s; }
.aio-recap { display: flex; font: var(--v64-type-body-lg); gap: var(--v64-space-2); justify-content: center; margin: var(--v64-space-2) 0 0; }
.aio-recap dt { color: var(--v64-on-surface-variant); }
.aio-recap dt::after { content: ":"; }
.aio-recap dd { font-weight: 500; margin: 0; }
.aio-recap dd span { color: var(--v64-on-surface-variant); font-weight: 400; }
.ai-onboarding__colleague { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-3); justify-content: center; margin-bottom: var(--v64-space-3); }
.ai-onboarding__colleague-error { margin: 0 auto var(--v64-space-3); max-width: 36rem; text-align: left; }
.ai-onboarding__note { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 0 0 var(--v64-space-2); }

/* Screen motion */
.aio-forward-enter-active, .aio-back-enter-active {
  transition: opacity var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate), transform var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate);
}
.aio-forward-leave-active, .aio-back-leave-active {
  transition: opacity calc(var(--v64-duration-medium) * 2 / 3) var(--v64-ease-emphasized-accelerate),
    transform calc(var(--v64-duration-medium) * 2 / 3) var(--v64-ease-emphasized-accelerate);
}
.aio-forward-enter-from, .aio-back-leave-to { opacity: 0; transform: translateX(24px); }
.aio-forward-leave-to, .aio-back-enter-from { opacity: 0; transform: translateX(-24px); }
@keyframes aio-rise { from { opacity: 0; transform: translateY(8px); } }
@keyframes aio-lift { from { opacity: 0.4; transform: scale(0.96) translateY(12px); } }
@keyframes aio-arrive { from { opacity: 0; transform: scale(0.6); } 70% { opacity: 1; transform: scale(1.06); } }
@keyframes aio-glow { from { opacity: 0; transform: scale(0.4); } }
@keyframes aio-draw { from { stroke-dashoffset: 28; } to { stroke-dashoffset: 0; } }
@keyframes aio-pop { from { opacity: 0; transform: scale(0.4); } 60% { opacity: 1; transform: scale(1.12); } }
@keyframes aio-typing { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* Tablet */
@media (max-width: 959.98px) {
  .ai-setup > section { max-width: 640px; }
  .ai-onboarding__headline { font: var(--v64-type-headline-md); }
}

/* Phone */
@media (max-width: 599.98px) {
  .ai-onboarding__headline { font: var(--v64-type-headline-sm); }
  .aio-card, .aio-card--featured { padding: var(--v64-space-4); }
  .aio-card--collapsed { gap: 0; justify-content: center; min-height: 72px; }
  .aio-card__head[type="button"] { cursor: pointer; min-height: 48px; }
  .aio-card__ribbon { right: var(--v64-space-4); }
  .aio-card__connected { left: var(--v64-space-4); }
  .aio-card--featured .aio-card__name { font: var(--v64-type-headline-sm); }
  .aio-card--featured .aio-plan__price { font: var(--v64-type-headline-sm); }
  .aio-current { padding: var(--v64-space-3) var(--v64-space-4); }
  .aio-current__keep { width: 100%; }
  .aio-models { padding: var(--v64-space-4); }
  .aio-models__open { width: 100%; }
  .aio-chosen__title { font: var(--v64-type-headline-sm); }
  .ai-onboarding__panel { padding: var(--v64-space-4); }
  .ai-setup > .ai-onboarding__success { padding-top: var(--v64-space-6); }
}

.aio-card__head:focus-visible { border-radius: var(--v64-shape-sm); }
.ai-setup :deep(.v-btn:focus-visible),
.aio-card__head:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .aio-card, .aio-chosen, .aio-success-mark, .aio-success-mark::before, .aio-check, .aio-check path, .aio-proof__typing i { animation: none; }
  .aio-card, .aio-card__chevron, .aio-option { transition: none; }
  .aio-forward-enter-from, .aio-forward-leave-to, .aio-back-enter-from, .aio-back-leave-to { transform: none; }
}
</style>
