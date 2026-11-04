<script setup>
import { computed, nextTick, ref, toRef, watch } from "vue";
import { useDisplay } from "vuetify";
import { mdiAlertCircleOutline, mdiArrowDown, mdiArrowLeft, mdiArrowRight, mdiCheckCircle, mdiChevronDown, mdiMapMarkerPath } from "@mdi/js";
import { cliProblem } from "../studio/CliInstallNotice.vue";
import ModelRoutingForm from "../studio/ModelRoutingForm.vue";
import AiConnectionDialogs from "../studio/AiConnectionDialogs.vue";
import AiProviderManage from "../studio/AiProviderManage.vue";
import AiSetupAdvanced from "../studio/AiSetupAdvanced.vue";
import AiWaitStatus from "../studio/AiWaitStatus.vue";
import { provideAiConnectionManager, useAiConnectionManager } from "../composables/useAiConnectionManager.js";
import AiOnboardingMark from "./AiOnboardingMark.vue";
import AiSetupConnectSteps from "./AiSetupConnectSteps.vue";
import AiSetupHelloProof from "./AiSetupHelloProof.vue";
import AiSetupModelsSummary from "./AiSetupModelsSummary.vue";
import AiSetupProviderCard from "./AiSetupProviderCard.vue";
import AiSetupRoutingChoice from "./AiSetupRoutingChoice.vue";
import AiSetupSuccessMark from "./AiSetupSuccessMark.vue";
import AiTeamSetupCard from "./AiTeamSetupCard.vue";
import { useAiOnboarding, usesProvider } from "./useAiOnboarding.js";
import { provideAiSetupCards, useAiSetupCards } from "./useAiSetupCards.js";
import { useAiSetupProviderLinks } from "./useAiSetupProviderLinks.js";
import { useAiSetupSuccess } from "./useAiSetupSuccess.js";
import { useAiTeamSetupOffer } from "./useAiTeamSetupOffer.js";
import { routingSelectionText } from "../studio/ModelRoutingRow.vue";
import { useVibe64Learning } from "/src/composables/useVibe64Learning.js";

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
// The connect step open is DeepSeek's, started from the team card.
const teamFlow = ref(false);
const autoRouting = ref(false);
const outcome = ref({ routed: true, colleague: null, error: "" });
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
const loaded = computed(() => setup.loaded.value);
const loadError = computed(() => setup.loadError.value);
// The overview's provider cards, provided for each card's own part.
const setupCards = provideAiSetupCards(useAiSetupCards({
  setup, manager, wasSetUp, xs, active: computed(() => props.open && props.canConfigure)
}));
const {
  cards, cardTool, checkingTools, checkTools, currentMarks, currentNames, expandedId, mainAi, mainCard, noToolHere,
  orderedCards, otherRows, ownerRoles, ownerSenior, readyHere
} = setupCards;
const learning = useVibe64Learning();
const {
  colleagueNote, doneLabel, hello, inLesson, learn, proven, sayHello, switchColleague
} = useAiSetupSuccess({ setup, learning, screen, chosen, outcome, verifying, announcement });
// One offer, once: the end of first-time setup (not a redo, not inline, not
// in Learn) offers the course's orientation lesson; the done button is its
// "not now". Starting it is the Learning controller's (openOrientation).
const tourOffered = computed(() => !props.inline && firstRun.value && !learn.value);
function takeTour() {
  if (busy.value || !tourOffered.value) return;
  learning.openOrientation();
  close("tour");
}
// Advanced appears once anything is configured.
const showAdvanced = computed(() => props.canConfigure && (wasSetUp.value || manager.configuredAiRows.value.length > 0));
// The chosen engine's CLI, when this computer lacks it or it did not start.
const missingTool = computed(() => {
  const id = chosen.value?.connect.engineId;
  const status = setup.accounts?.status.value || {};
  return status.accounts?.find((account) => account.id === id && cliProblem(account)) ||
    status.missingTools?.find((tool) => tool.id === id) || null;
});
// Set up later snoozes first-run onboarding; a redo just closes. Inline has nothing to put off.
const skippable = computed(() => !props.inline && !wasSetUp.value && !["success", "owner"].includes(screen.value));
// The shell supplies Back and Done on a phone; inline shows its own.
const ownButtons = computed(() => props.inline || !xs.value);

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

// With no Senior model in use there is nothing to keep: the suggestions apply unasked.
watch(routingForm, (form) => {
  if (form && autoRouting.value) useAsMain();
});

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

function openManage(card) {
  managedCard.value = card;
  manageOpen.value = true;
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

// The team card on the overview, and the DeepSeek step it starts.
const {
  deepseekInClaude, finishTeam, snoozeTeam, startTeamSetup, team, teamBusy, teamCardState, teamError, teamSummary
} = useAiTeamSetupOffer({
  setup, manager, cards, ownerRoles, ownerSenior, wasSetUp, canConfigure: toRef(props, "canConfigure"), focus: toRef(props, "focus"),
  chosen, teamFlow, verifying, warning, announcement, connect, go
});
const teamCard = ref(null);
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

// Models: the setup screen with both setups; Team members opens on theirs.
function openModels(initialSetup = "owner") {
  manager.routingSetup.value = initialSetup;
  manager.routingOpen.value = true;
}
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

watch(busy, (value) => emit("busy", value));

const { openProvider } = useAiSetupProviderLinks({
  inline: toRef(props, "inline"), canConfigure: toRef(props, "canConfigure"), manager, setupCards, openManage, connect
});

// The shell's top bar and phone dock follow the stage.
defineExpose({ busy, doneLabel, screen, skippable, tourOffered, wasSetUp, back: () => go("choose", true), openProvider, takeTour });
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
          <p v-if="noToolHere" class="ai-onboarding__lede">No AI tool is on this computer yet. Install the one your AI needs first.</p>
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
        <div v-if="readyHere" class="aio-current aio-ready-here" role="group" aria-label="Ready on this computer">
          <v-icon :icon="mdiCheckCircle" class="aio-ready-here__icon" aria-hidden="true" />
          <span class="aio-current__text">
            <span class="aio-current__label">Ready on this computer</span>
            <span class="aio-current__value">{{ cardTool(readyHere).name }}</span>
          </span>
          <v-btn color="primary" variant="tonal" size="large" :append-icon="mdiArrowRight" class="aio-current__keep" @click="connect(readyHere)">
            Use {{ readyHere.name }}
          </v-btn>
        </div>
        <div class="ai-onboarding__cards">
          <AiSetupProviderCard
            v-for="(card, index) in orderedCards" :key="card.id" :card="card" :index="index" :verifying="verifying"
            :loading="!loaded && !loadError" @connect="connect" @make-main="makeMainAi" @manage="openManage"
          >
            <template #connection-access="scope"><slot name="connection-access" v-bind="scope" /></template>
          </AiSetupProviderCard>
        </div>
        <AiSetupModelsSummary v-if="canConfigure && wasSetUp && modelsSummary.length" :rows="modelsSummary" @open="openModels()" />
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
        <AiSetupConnectSteps
          v-model:sign-up="signUp" :card="chosen" :missing-tool="missingTool" :checking-tools="checkingTools" :verifying="verifying"
          :verify-label="verifyLabel" :warning="warning" :not-ready="notReady" :busy="busy" @finish="finish()" @back="go('choose', true)"
          @check="checkTools" @busy="setupBusy = $event" @review-routing="reviewRouting"
        />
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
        <AiSetupRoutingChoice
          v-else-if="!fullRouting" :name="chosen.name" :current-name="currentSenior?.name" :busy="busy" :saving="routingBusy"
          @use="useAsMain" @keep="routingDone"
        />
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
        <AiSetupSuccessMark :provider="chosen" :proven="proven" />
        <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
          {{ hello.state === "failed" ? "Almost there" : hello.state === "waiting" ? `${chosen.name} is connected` : `${chosen.name} is ready` }}
        </h1>
        <p v-if="colleagueNote !== 'menu' && hello.state !== 'failed'" class="ai-onboarding__lede">
          {{ learn ? `Next: ${inLesson ? "back to your lesson" : "choose a lesson"}.` : "Next: Colleague opens so you can ask it to build your first page." }}
        </p>
        <AiSetupHelloProof
          v-if="colleagueNote === 'uses'" :hello="hello" :name="chosen.name" :learn="learn"
          @retry="sayHello" @check-connection="go('connect', true)" @dismiss="hello.state = 'dismissed'"
        />
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
        <div v-if="ownButtons" class="aio-success-actions">
          <v-btn color="primary" variant="flat" size="large" :block="xs" :append-icon="mdiArrowRight" @click="close('done')">{{ inline ? "Done" : doneLabel }}</v-btn>
          <v-btn
            v-if="tourOffered" color="primary" variant="tonal" size="large" :block="xs" :prepend-icon="mdiMapMarkerPath"
            data-test="ai-setup-take-tour" @click="takeTour"
          >
            Take a 5-minute tour
          </v-btn>
        </div>
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

/* Provider cards: one column, Claude first. */
.ai-onboarding__cards { display: grid; gap: var(--v64-space-4); }
.aio-ready-here { margin-top: 0; }
.aio-ready-here__icon { color: var(--v64-success); }

/* Connect and routing: one centred column. */
.ai-setup > .ai-onboarding__connect,
.ai-setup > .ai-onboarding__routing { max-width: 560px; }
.aio-chosen { align-items: center; margin-top: var(--v64-space-6); padding-inline-start: var(--v64-space-5); animation: aio-lift var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) both; display: flex; gap: var(--v64-space-4); margin-bottom: var(--v64-space-6); }
.aio-chosen__text { flex: 1; min-width: 0; }
.aio-chosen__title { font: var(--v64-type-headline-md); letter-spacing: -0.015em; margin: 0; outline: none; }
.aio-chosen__plan { color: var(--v64-on-surface-variant); font: var(--v64-type-body-lg); margin: 2px 0 0; }
.ai-onboarding__panel {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  margin-top: var(--v64-space-4);
  min-width: 0;
  padding: var(--v64-space-5);
}
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
.aio-success-actions { display: flex; flex-wrap: wrap; gap: var(--v64-space-3); justify-content: center; margin-top: var(--v64-space-5); width: 100%; }
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
@keyframes aio-lift { from { opacity: 0.4; transform: scale(0.96) translateY(12px); } }

/* Tablet */
@media (max-width: 959.98px) {
  .ai-setup > section { max-width: 640px; }
  .ai-onboarding__headline { font: var(--v64-type-headline-md); }
}

/* Phone */
@media (max-width: 599.98px) {
  .ai-onboarding__headline { font: var(--v64-type-headline-sm); }
  .aio-current { padding: var(--v64-space-3) var(--v64-space-4); }
  .aio-current__keep { width: 100%; }
  .aio-chosen__title { font: var(--v64-type-headline-sm); }
  .ai-onboarding__panel { padding: var(--v64-space-4); }
  .ai-setup > .ai-onboarding__success { padding-top: var(--v64-space-6); }
}

.ai-setup :deep(.v-btn:focus-visible) {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .aio-chosen { animation: none; }
  .aio-forward-enter-from, .aio-forward-leave-to, .aio-back-enter-from, .aio-back-leave-to { transform: none; }
}
</style>
