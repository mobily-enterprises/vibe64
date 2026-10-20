<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiAlertCircleOutline, mdiArrowLeft, mdiArrowRight, mdiBugCheckOutline, mdiCheck, mdiCheckCircle, mdiChevronDown,
  mdiClose, mdiFileTreeOutline, mdiInformationOutline, mdiOpenInNew, mdiRobotHappyOutline, mdiShieldLockOutline, mdiSitemapOutline
} from "@mdi/js";
import AIAccountsSetup from "../studio/AIAccountsSetup.vue";
import ModelRoutingForm from "../studio/ModelRoutingForm.vue";
import NativeProviderConnections from "../studio/NativeProviderConnections.vue";
import AiOnboardingMark from "./AiOnboardingMark.vue";
import { usesProvider } from "./useAiOnboarding.js";

const props = defineProps({
  open: Boolean,
  start: { type: String, default: "why" },
  // Opened from the user menu or AI Accounts to review an existing setup.
  redo: Boolean,
  onboarding: { type: Object, required: true },
  canConfigure: Boolean,
  // Hosted workspace: Personal-use connections serve only the owner.
  workspace: Boolean
});
const emit = defineEmits(["close"]);
const { xs } = useDisplay();

const DIFFERENCES = [
  { icon: mdiSitemapOutline, label: "Plans before it codes" },
  { icon: mdiBugCheckOutline, label: "Fixes its own bugs" },
  { icon: mdiFileTreeOutline, label: "Understands your whole app" }
];
const RATINGS = ["", "limited", "good", "excellent"];
const STEP = { why: 1, choose: 2, connect: 3, routing: 3, success: 3 };
// The crown settles once the cards have risen in.
const CROWN_SETTLE_MS = 420;

const screen = ref("why");
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
const outcome = ref({ routed: true, colleague: null, error: "" });
// Success proof: Colleague's reply to a hello ("", "waiting", "replied" or "silent").
const hello = ref({ state: "", reply: "" });
const announcement = ref("");
// Hover styling waits for real pointer movement, so a resting cursor stays still.
const pointerMoved = ref(false);

const busy = computed(() => setupBusy.value || routingBusy.value || verifying.value);
const cards = computed(() => props.onboarding.cards.value);
const loaded = computed(() => props.onboarding.loaded.value);
const loadError = computed(() => props.onboarding.loadError.value);
const featured = computed(() => cards.value.find((card) => card.crown));
const others = computed(() => cards.value.filter((card) => !card.crown));
const connectedCards = computed(() => cards.value.filter((card) => card.connected));
const mainCard = computed(() => connectedCards.value.find((card) => usesProvider(props.onboarding.colleague.value, card)) || null);
const nativeLogin = computed(() => ["anthropic", "openai"].includes(chosen.value?.connect.modelProviderId));
const changeWhere = computed(() => props.workspace ? "your account menu" : "Account settings > AI Accounts");
// Set up later snoozes first-run onboarding; a redo just closes.
const skippable = computed(() => !wasSetUp.value && !["success", "owner"].includes(screen.value));
const dock = computed(() => xs.value && (screen.value === "success" || screen.value === "why" && skippable.value));
// Success says one thing about Colleague: it uses the choice, can switch to it, or isn't open here.
const colleagueNote = computed(() => usesProvider(outcome.value.colleague, chosen.value) ? "uses"
  : props.onboarding.colleagueAvailable.value ? "switch" : "menu");

function readSetup() {
  const { isSetUp, loaded: known } = props.onboarding;
  wasSetUp.value = props.redo || isSetUp.value;
  firstRun.value = !props.redo && known.value && !isSetUp.value;
}

watch(() => props.open, (open) => {
  if (!open) return;
  readSetup();
  props.onboarding.refreshColleague();
  direction.value = "forward";
  screen.value = !props.canConfigure ? "owner" : props.start === "why" && !wasSetUp.value ? "why" : "choose";
  chosen.value = null;
  expandedId.value = "";
  announcement.value = "";
  resetAttempt();
}, { immediate: true });

// Opened before the connections were read: settle once they are, before any choice.
watch(() => props.onboarding.loaded.value, (known) => {
  if (!props.open || !known || chosen.value) return;
  readSetup();
  if (wasSetUp.value && screen.value === "why") screen.value = "choose";
});

// Success proves Colleague answers when it runs on the chosen provider.
watch(() => screen.value === "success" && colleagueNote.value === "uses", async (proving) => {
  if (!proving || hello.value.state) return;
  hello.value = { state: "waiting", reply: "" };
  const result = await props.onboarding.sayHello();
  hello.value = result?.ok ? { state: "replied", reply: result.reply } : { state: "silent", reply: "" };
});

function resetAttempt() {
  warning.value = "";
  notReady.value = false;
  makeMain.value = false;
  routingReviewed.value = false;
  fullRouting.value = false;
  routingDetails.value = false;
  hello.value = { state: "", reply: "" };
}

function go(next, back = false) {
  direction.value = back ? "back" : "forward";
  screen.value = next;
}

function close(reason) {
  if (!busy.value) emit("close", reason);
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

function cardAction(card) {
  if (!card.connected || !wasSetUp.value) return "get";
  return usesProvider(props.onboarding.colleague.value, card) ? "keep" : "main";
}

// Success needs the provider connected, a Senior model of it ready and, on a
// known first setup or an explicit switch, Colleague moved onto that provider.
async function finish({ keep: keeping = false } = {}) {
  const card = chosen.value;
  verifying.value = true;
  warning.value = "";
  notReady.value = false;
  try {
    const result = await props.onboarding.verify(card);
    if (!result.connected) {
      warning.value = `${card.name} isn't connected yet. Finish the connection step, then try again.`;
      if (screen.value !== "connect") go("connect");
      return;
    }
    if (wasSetUp.value && !keeping && !routingReviewed.value && result.routingWouldChange) {
      go("routing");
      return;
    }
    if (!result.available) {
      notReady.value = true;
      if (screen.value !== "connect") go("connect");
      announcement.value = `${card.name} is connected, but no model is ready for Colleague yet.`;
      return;
    }
    let colleague = await props.onboarding.refreshColleague();
    let error = "";
    if ((firstRun.value || makeMain.value) && !usesProvider(colleague, card)) {
      ({ selection: colleague = colleague, error = "" } = await props.onboarding.selectForColleague(card));
    }
    outcome.value = { routed: result.routed, colleague, error };
    announcement.value = `${card.name} is ready.`;
    go("success");
  } catch (error) {
    warning.value = error?.message || "We couldn't check the connection. Try again.";
  } finally {
    verifying.value = false;
  }
}

function reviewRouting() {
  fullRouting.value = true;
  go("routing");
}

function routingDone() {
  routingReviewed.value = true;
  return finish();
}

// "Yes" saves the routing suggestions through the routing form; a failed save
// leaves the form open with its errors.
async function useAsMain() {
  makeMain.value = true;
  await routingForm.value?.applySuggested();
  if (screen.value === "routing") routingDetails.value = true;
}

async function switchColleague() {
  verifying.value = true;
  try {
    const { selection = outcome.value.colleague, error = "" } = await props.onboarding.selectForColleague(chosen.value);
    outcome.value = { ...outcome.value, colleague: selection, error };
  } finally {
    verifying.value = false;
  }
}

function meterLabel([aspect, rating]) {
  return `${aspect[0].toUpperCase()}${aspect.slice(1)}: ${RATINGS[rating]}`;
}

function connectedLabel(card) {
  return props.workspace ? `Connected · ${card.connect.access === "workspace" ? "Workspace" : "Personal"} use` : "Connected";
}

// Phone: lower-ranked cards collapse to a row, one open at a time; connected ones stay open.
function collapsible(card) {
  return xs.value && !card.crown && !card.connected;
}

function expanded(card) {
  return !collapsible(card) || expandedId.value === card.id;
}
</script>

<template>
  <v-dialog
    :model-value="open" fullscreen :scrim="false" :persistent="busy" :z-index="2500" transition="fade-transition"
    aria-labelledby="ai-onboarding-title"
    @update:model-value="!$event && close('dismiss')" @after-enter="focusTitle"
  >
    <div
      ref="stage" class="ai-onboarding" :class="{ 'ai-onboarding--phone': xs, 'ai-onboarding--pointer': pointerMoved }"
      @pointermove.once="pointerMoved = true"
    >
      <header class="ai-onboarding__bar">
        <v-btn
          v-if="xs && ['connect', 'routing'].includes(screen)" :icon="mdiArrowLeft" variant="text" aria-label="Back"
          :disabled="busy" @click="go('choose', true)"
        />
        <span v-else class="ai-onboarding__wordmark">Vibe<span>64</span></span>
        <div v-if="!wasSetUp && STEP[screen]" class="ai-onboarding__dots" aria-hidden="true">
          <span v-for="step in 3" :key="step" :class="{ 'is-active': STEP[screen] === step, 'is-done': STEP[screen] > step }" />
        </div>
        <div class="ai-onboarding__bar-actions">
          <v-tooltip :disabled="!busy" text="Finish or cancel the current step first" location="bottom">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="d-inline-flex align-center">
                <v-btn v-if="skippable && screen !== 'why'" variant="text" :disabled="busy" @click="close('later')">Set up later</v-btn>
                <v-btn :icon="mdiClose" variant="text" aria-label="Close" :disabled="busy" @click="close('dismiss')" />
              </span>
            </template>
          </v-tooltip>
        </div>
      </header>

      <main class="ai-onboarding__main">
        <p v-if="!wasSetUp && STEP[screen]" class="d-sr-only">Step {{ STEP[screen] }} of 3</p>
        <Transition :name="`aio-${direction}`" mode="out-in" @after-enter="focusTitle">
          <section v-if="screen === 'why'" key="why" class="ai-onboarding__why">
            <div class="aio-hero" aria-hidden="true">
              <div
                v-for="(card, index) in [...others].reverse().concat(featured)" :key="card.id"
                class="aio-hero__card" :class="{ 'aio-hero__card--crown': card.crown }" :style="{ '--aio-index': index }"
              >
                <AiOnboardingMark :provider="card" :size="card.crown ? (xs ? 96 : 64) : (xs ? 64 : 44)" :settle-delay="card.crown ? 600 : -1" />
                <span class="aio-hero__name">{{ card.name }}</span>
              </div>
            </div>
            <div class="ai-onboarding__why-copy">
              <p class="ai-onboarding__eyebrow">WELCOME TO VIBE64</p>
              <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
                First, give Vibe64 a <span class="ai-onboarding__accent">brilliant mind.</span>
              </h1>
              <p class="ai-onboarding__lede">Frontier AI makes Vibe64 dramatically better. Pick yours in two minutes.</p>
              <ul class="ai-onboarding__differences">
                <li v-for="difference in DIFFERENCES" :key="difference.label">
                  <v-icon :icon="difference.icon" size="20" aria-hidden="true" />{{ difference.label }}
                </li>
              </ul>
              <div v-if="!xs" class="ai-onboarding__actions">
                <v-btn color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="go('choose')">Choose my AI</v-btn>
                <v-btn variant="text" size="large" @click="close('later')">Set up later</v-btn>
              </div>
              <p class="ai-onboarding__footnote">You can change this any time in {{ changeWhere }}.</p>
            </div>
          </section>

          <section v-else-if="screen === 'choose'" key="choose" class="ai-onboarding__choose">
            <header class="ai-onboarding__intro">
              <p class="ai-onboarding__eyebrow">{{ wasSetUp ? "YOUR AI" : "CHOOSE YOUR AI" }}</p>
              <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">{{ wasSetUp ? "Your AI setup" : "Pick the AI behind Vibe64" }}</h1>
              <p class="ai-onboarding__lede">
                {{ wasSetUp
                  ? "Keep what you have, switch your main AI, or add another. Nothing is removed."
                  : "Ranked by how good Vibe64 feels with each. Frontier models make a huge difference; budget ones work, but you'll notice the gap quickly. Our honest advice: start with Claude." }}
              </p>
            </header>
            <div v-if="wasSetUp && connectedCards.length" class="aio-current" role="group" aria-label="Currently using">
              <span class="aio-current__marks">
                <AiOnboardingMark v-for="card in connectedCards" :key="card.id" :provider="card" :size="36" />
              </span>
              <span class="aio-current__text">
                <span class="aio-current__label">Currently using</span>
                <span class="aio-current__value">
                  {{ mainCard ? `Main AI: ${mainCard.name}` : connectedCards.map(({ name }) => name).join(", ") }}
                </span>
              </span>
              <v-btn
                v-if="mainCard" color="primary" variant="flat" :disabled="verifying" class="aio-current__keep" @click="keep(mainCard)"
              >
                Keep using {{ mainCard.name }}
              </v-btn>
            </div>
            <v-alert v-if="loadError" type="error" variant="tonal" class="mb-6">
              We couldn't check your current AI connections.
              <template #append><v-btn variant="text" @click="onboarding.reload()">Try again</v-btn></template>
            </v-alert>
            <p v-if="verifying" class="d-sr-only" role="status">Checking…</p>
            <div class="ai-onboarding__cards">
              <article
                v-for="(card, index) in [featured, ...others]" :key="card.id"
                class="aio-card" :class="[`aio-card--${card.tone}`, { 'aio-card--featured': card.crown, 'aio-card--connected': card.connected, 'aio-card--collapsed': !expanded(card) }]"
                :style="{ '--aio-index': index }" :aria-labelledby="`aio-card-${card.id}`"
              >
                <span v-if="card.crown" class="aio-card__ribbon">Recommended</span>
                <span v-if="card.connected" class="aio-card__connected">
                  <v-icon :icon="mdiCheckCircle" size="16" aria-hidden="true" />{{ connectedLabel(card) }}
                </span>
                <div class="aio-card__main">
                  <component
                    :is="collapsible(card) ? 'button' : 'div'" class="aio-card__head"
                    :type="collapsible(card) ? 'button' : undefined"
                    :aria-expanded="collapsible(card) ? String(expanded(card)) : undefined"
                    @click="collapsible(card) && (expandedId = expandedId === card.id ? '' : card.id)"
                  >
                    <span class="aio-card__rank" aria-hidden="true">{{ card.rank }}</span>
                    <AiOnboardingMark
                      :provider="card" :size="card.crown ? (xs ? 48 : 56) : 44"
                      :settle-delay="card.crown ? CROWN_SETTLE_MS : -1"
                    />
                    <span class="aio-card__identity">
                      <span :id="`aio-card-${card.id}`" class="aio-card__name">{{ card.name }}</span>
                      <span class="aio-card__tagline">{{ card.tagline }}</span>
                    </span>
                    <v-icon v-if="collapsible(card)" :icon="mdiChevronDown" class="aio-card__chevron" aria-hidden="true" />
                  </component>
                  <div v-if="!loaded && !loadError" class="aio-card__loading">
                    <v-skeleton-loader type="chip" width="120" height="24" />
                  </div>
                  <div v-if="expanded(card)" class="aio-card__facts">
                    <ul class="aio-card__bullets">
                      <li v-for="bullet in card.bullets" :key="bullet[0]">
                        <span class="aio-meter" :class="{ 'aio-meter--low': bullet[1] === 1 }" role="img" :aria-label="meterLabel(bullet)">
                          <i v-for="segment in 3" :key="segment" :class="{ 'is-filled': segment <= bullet[1] }" />
                        </span>
                        <span>{{ bullet[2] }}</span>
                      </li>
                    </ul>
                    <p v-if="card.why" class="aio-card__why">{{ card.why }}</p>
                    <p v-if="card.note" class="aio-card__note">
                      <v-icon :icon="mdiInformationOutline" size="18" aria-hidden="true" />{{ card.note }}
                    </p>
                  </div>
                </div>
                <div v-if="expanded(card)" class="aio-card__offer">
                  <div class="aio-card__plan">
                    <span class="aio-card__plan-label">Suggested budget</span>
                    <span class="aio-card__plan-budget">{{ card.plan.budget }}</span>
                    <span class="aio-card__plan-detail">{{ card.plan.detail }}</span>
                    <span v-if="card.plan.more" class="aio-card__plan-more">{{ card.plan.more }}</span>
                  </div>
                  <div class="aio-card__ctas">
                    <v-btn
                      v-if="cardAction(card) === 'keep'" color="primary" :variant="card.crown ? 'flat' : 'tonal'" size="large"
                      :disabled="verifying" @click="keep(card)"
                    >
                      Keep using {{ card.name }}
                    </v-btn>
                    <v-btn
                      v-else-if="cardAction(card) === 'main'" color="primary" :variant="card.crown ? 'flat' : 'tonal'" size="large"
                      :disabled="verifying" @click="makeMainAi(card)"
                    >
                      Use {{ card.name }} as my main AI
                    </v-btn>
                    <template v-else>
                      <v-btn
                        color="primary" :variant="card.crown ? 'flat' : 'tonal'" size="large"
                        :href="card.signUp.url" target="_blank" rel="noopener noreferrer" :append-icon="mdiOpenInNew"
                        @click="connect(card, 'opened')"
                      >
                        Get {{ card.name }}<span class="d-sr-only"> (opens in a new tab)</span>
                      </v-btn>
                      <v-btn variant="text" color="primary" class="aio-card__have" @click="connect(card, 'have')">{{ card.have }}</v-btn>
                    </template>
                  </div>
                </div>
              </article>
            </div>
            <p class="ai-onboarding__footnote">Prices are set by each provider and can change. You pay them directly; Vibe64 never resells AI.</p>
          </section>

          <section v-else-if="screen === 'connect'" key="connect" class="ai-onboarding__connect">
            <header class="aio-chosen" :class="{ 'aio-chosen--crown': chosen.crown }">
              <AiOnboardingMark :provider="chosen" :size="56" />
              <div class="aio-chosen__text">
                <h1 id="ai-onboarding-title" tabindex="-1" class="aio-chosen__title">Connect {{ chosen.name }}</h1>
                <p class="aio-chosen__plan">{{ chosen.plan.detail }}</p>
              </div>
              <div class="aio-chosen__budget">
                <span class="aio-card__plan-label">Suggested budget</span>
                <span class="aio-card__plan-budget">{{ chosen.plan.budget }}</span>
              </div>
            </header>
            <div class="ai-onboarding__connect-grid">
              <ol class="aio-checklist">
                <li :class="{ 'is-done': signUp === 'opened' }">
                  <span class="aio-checklist__marker" aria-hidden="true">
                    <v-icon v-if="signUp === 'opened'" :icon="mdiCheck" size="18" /><template v-else>1</template>
                  </span>
                  <div>
                    <p class="aio-checklist__title">
                      {{ signUp === "have" ? chosen.haveTitle : "Get a plan" }}<span v-if="signUp === 'opened'" class="d-sr-only"> (done)</span>
                    </p>
                    <p class="aio-checklist__body">
                      {{ signUp === "have" ? "Go straight to the next step. Need one after all? Open the sign-up page." : chosen.signUp.step }}
                    </p>
                    <v-btn
                      variant="tonal" color="primary" :href="chosen.signUp.url" target="_blank" rel="noopener noreferrer"
                      :append-icon="mdiOpenInNew" @click="signUp = 'opened'"
                    >
                      {{ chosen.signUp.label }}<span class="d-sr-only"> (opens in a new tab)</span>
                    </v-btn>
                  </div>
                </li>
                <li v-for="(step, index) in chosen.steps" :key="step">
                  <span class="aio-checklist__marker" aria-hidden="true">{{ index + 2 }}</span>
                  <p class="aio-checklist__body">{{ step }}</p>
                </li>
              </ol>
              <div class="ai-onboarding__setup">
                <AIAccountsSetup
                  v-if="nativeLogin" embedded :provider-id="chosen.connect.engineId"
                  :model-provider-id="chosen.connect.modelProviderId" @connected="finish()"
                />
                <NativeProviderConnections
                  v-else embedded adding :select-provider="false" :engine-id="chosen.connect.engineId"
                  :model-value="chosen.connect.modelProviderId" :title="`Paste your ${chosen.name} API key`"
                  @busy="setupBusy = $event" @close="finish()"
                />
                <v-alert v-if="warning" type="warning" variant="tonal" class="mt-4">{{ warning }}</v-alert>
                <v-alert v-if="notReady" type="warning" variant="tonal" class="mt-4">
                  {{ chosen.name }} is connected, but no model is ready for Colleague yet.
                  <template #append><v-btn variant="text" @click="reviewRouting">Review model routing</v-btn></template>
                </v-alert>
                <p v-if="nativeLogin" class="ai-onboarding__security">
                  <v-icon :icon="mdiShieldLockOutline" size="18" aria-hidden="true" />
                  Your sign-in is stored privately, outside your projects.
                </p>
              </div>
            </div>
          </section>

          <section v-else-if="screen === 'routing'" key="routing" class="ai-onboarding__routing">
            <header class="ai-onboarding__intro">
              <AiOnboardingMark v-if="!fullRouting" :provider="chosen" :size="56" class="mb-5" />
              <p class="ai-onboarding__eyebrow">YOUR MAIN AI</p>
              <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
                {{ fullRouting ? "Review model routing" : `Make ${chosen.name} your main AI?` }}
              </h1>
              <p v-if="!fullRouting" class="ai-onboarding__lede">
                {{ chosen.name }} is connected. Vibe64 can use it for its main work, or keep your current setup.
              </p>
            </header>
            <div v-if="!fullRouting" class="ai-onboarding__actions">
              <v-btn color="primary" variant="flat" size="large" :loading="routingBusy" :disabled="busy" @click="useAsMain">
                Yes, use {{ chosen.name }}
              </v-btn>
              <v-btn variant="tonal" size="large" :disabled="busy" @click="routingDone">Keep my current setup</v-btn>
            </div>
            <v-btn
              v-if="!fullRouting" variant="text" class="aio-details-toggle" :append-icon="mdiChevronDown"
              :class="{ 'is-open': routingDetails }" :aria-expanded="String(routingDetails)" @click="routingDetails = !routingDetails"
            >
              {{ routingDetails ? "Hide details" : "Show details" }}
            </v-btn>
            <div v-show="fullRouting || routingDetails" class="ai-onboarding__panel">
              <ModelRoutingForm
                ref="routingForm"
                :engine-id="chosen.connect.engineId"
                :connection-id="fullRouting ? '' : chosen.connect.modelProviderId"
                :connection-label="fullRouting ? '' : chosen.name"
                @busy="routingBusy = $event" @saved="routingDone" @close="routingDone"
              />
            </div>
          </section>

          <section v-else-if="screen === 'success'" key="success" class="ai-onboarding__success">
            <div class="aio-success-mark">
              <AiOnboardingMark :provider="chosen" :size="88" :settle-delay="chosen.crown ? 200 : -1" />
              <svg class="aio-check" viewBox="0 0 40 40" aria-hidden="true">
                <circle cx="20" cy="20" r="18" />
                <path d="M12 20.5 l5.5 5.5 l10.5 -11" />
              </svg>
            </div>
            <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">{{ chosen.name }} is ready</h1>
            <div v-if="colleagueNote === 'uses'" class="aio-proof" :aria-busy="hello.state === 'waiting' ? 'true' : undefined">
              <span class="aio-proof__avatar" aria-hidden="true">
                <svg viewBox="0 0 24 24"><path :d="mdiRobotHappyOutline" /></svg>
              </span>
              <div class="aio-proof__body">
                <span class="aio-proof__name">Colleague</span>
                <span v-if="hello.state === 'waiting'" class="aio-proof__typing" role="status">
                  <span class="d-sr-only">Colleague is replying…</span><i /><i /><i />
                </span>
                <p v-else-if="hello.state === 'replied'" class="aio-proof__reply">{{ hello.reply }}</p>
                <p v-else class="aio-proof__reply aio-proof__reply--quiet">Ready when you are. Say hi in the Colleague panel.</p>
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
            <p class="aio-recap">
              <template v-if="colleagueNote === 'uses'">Main AI: {{ outcome.colleague.label || chosen.name }} · </template>Change any time in {{ changeWhere }}
            </p>
            <p v-if="!outcome.routed" class="ai-onboarding__note">
              Your current models stay as they are. {{ chosen.name }} is ready in AI Accounts whenever you want it.
            </p>
            <p v-if="workspace && chosen.connect.access === 'personal'" class="ai-onboarding__note">
              This subscription serves only you. Workspace members need a Workspace-use connection, such as DeepSeek or an OpenAI API key.
            </p>
            <v-btn v-if="!xs" color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="close('done')">Start building</v-btn>
          </section>

          <section v-else key="owner" class="ai-onboarding__success">
            <v-icon :icon="mdiAlertCircleOutline" size="48" color="primary" aria-hidden="true" />
            <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">Only the workspace owner can connect AI accounts.</h1>
            <v-btn color="primary" variant="flat" size="large" @click="close('dismiss')">Close</v-btn>
          </section>
        </Transition>
        <p class="d-sr-only" aria-live="polite">{{ announcement }}</p>
      </main>

      <footer v-if="dock" class="ai-onboarding__dock">
        <template v-if="screen === 'why'">
          <v-btn block color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="go('choose')">Choose my AI</v-btn>
          <v-btn block variant="text" @click="close('later')">Set up later</v-btn>
        </template>
        <v-btn v-else block color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="close('done')">Start building</v-btn>
      </footer>
      <footer v-else-if="!xs && ['connect', 'routing'].includes(screen)" class="ai-onboarding__footer">
        <v-btn variant="text" :prepend-icon="mdiArrowLeft" :disabled="busy" @click="go('choose', true)">Back</v-btn>
      </footer>
    </div>
  </v-dialog>
</template>

<style scoped>
.ai-onboarding {
  --aio-crown: #f5c518;
  --aio-crown-ink: #2b2100;
  --aio-crown-strong: #8a6a00;
  --v64-on-success-container: color-mix(in srgb, var(--v64-success) 55%, #000);
  background:
    radial-gradient(1100px 640px at 85% -10%, var(--v64-primary-container), transparent 75%),
    linear-gradient(180deg, color-mix(in srgb, var(--v64-primary-container) 35%, var(--v64-surface)), var(--v64-surface-container-lowest));
  color: var(--v64-on-surface);
  display: flex;
  flex-direction: column;
  font-family: var(--v64-font-family);
  height: 100%;
  overflow: hidden;
}
.v-theme--dark .ai-onboarding {
  --aio-crown-strong: #f5c518;
  --v64-on-success-container: color-mix(in srgb, var(--v64-success) 45%, #fff);
}
/* One button shape across the flow, embedded AI Accounts parts included. */
.ai-onboarding :deep(.v-btn:not(.v-btn--icon)) { border-radius: var(--v64-shape-md); }
/* Dark: filled primary buttons take dark ink on a lighter primary (AA contrast). */
.v-theme--dark .ai-onboarding :deep(.v-btn--variant-flat.bg-primary) {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 45%, #fff) !important;
  color: #0b1d33 !important;
}

/* Top bar */
.ai-onboarding__bar {
  align-items: center;
  display: grid;
  flex: none;
  grid-template-columns: 1fr auto 1fr;
  height: 64px;
  padding: 0 var(--v64-space-5);
}
.ai-onboarding--phone .ai-onboarding__bar { height: 56px; padding: env(safe-area-inset-top) var(--v64-space-1) 0 var(--v64-space-4); }
.ai-onboarding__wordmark { font: var(--v64-type-title-lg); letter-spacing: -0.01em; }
.ai-onboarding__wordmark span { color: var(--v64-primary); }
.ai-onboarding__dots { display: flex; gap: 6px; grid-column: 2; }
.ai-onboarding__dots span {
  background: var(--v64-outline);
  border-radius: var(--v64-shape-full);
  height: 8px;
  transition: width var(--v64-duration-medium) var(--v64-ease-emphasized), background-color var(--v64-duration-medium);
  width: 8px;
}
.ai-onboarding__dots .is-done { background: color-mix(in srgb, var(--v64-primary) 45%, transparent); }
.ai-onboarding__dots .is-active { background: var(--v64-primary); width: 24px; }
.ai-onboarding__bar-actions { display: flex; grid-column: 3; justify-content: flex-end; }
.ai-onboarding__bar-actions .v-btn:not(.v-btn--icon) { font: var(--v64-type-label-lg); letter-spacing: 0; text-transform: none; }

/* Stage */
.ai-onboarding__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  padding: var(--v64-space-7) var(--v64-space-5);
}
.ai-onboarding__main > section { margin-inline: auto; max-width: 1040px; width: 100%; }
.ai-onboarding--phone .ai-onboarding__main { padding: var(--v64-space-4) var(--v64-space-4) var(--v64-space-6); }
.ai-onboarding__eyebrow {
  color: var(--v64-primary);
  font: var(--v64-type-label-lg);
  letter-spacing: 0.12em;
  margin: 0 0 var(--v64-space-3);
}
.ai-onboarding__headline {
  font: var(--v64-type-display-sm);
  letter-spacing: -0.015em;
  margin: 0 0 var(--v64-space-4);
  outline: none;
  text-wrap: balance;
}
.ai-onboarding__accent { color: var(--v64-primary); }
.ai-onboarding__lede {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-lg);
  margin: 0 0 var(--v64-space-4);
  max-width: 60ch;
  text-wrap: pretty;
}
.ai-onboarding__footnote { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: var(--v64-space-6) 0 0; }
.ai-onboarding__intro { margin-bottom: var(--v64-space-6); }
.ai-onboarding__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-3); }

/* Why: copy left, the provider stack right */
.ai-onboarding__main > .ai-onboarding__why {
  align-items: center;
  column-gap: var(--v64-space-7);
  display: grid;
  grid-template-columns: 7fr 5fr;
  margin-block: auto;
  padding-bottom: var(--v64-space-6);
}
.ai-onboarding__why-copy { grid-column: 1; grid-row: 1; }
.ai-onboarding__why .ai-onboarding__headline { font: 600 3rem/3.5rem var(--v64-font-family); letter-spacing: -0.025em; }
.ai-onboarding__why .ai-onboarding__lede { font: 400 1.25rem/1.875rem var(--v64-font-family); }
.ai-onboarding__differences {
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2) var(--v64-space-5);
  list-style: none;
  margin: var(--v64-space-5) 0 var(--v64-space-6);
  padding: 0;
}
.ai-onboarding__differences li { align-items: center; display: inline-flex; font: var(--v64-type-label-lg); gap: var(--v64-space-2); }
.ai-onboarding__differences .v-icon { color: var(--v64-primary); }
.aio-hero { grid-column: 2; grid-row: 1; height: 340px; position: relative; }
.aio-hero__card {
  align-items: center;
  animation: aio-fan var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) calc(var(--aio-index) * 70ms) both;
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  box-shadow: var(--v64-elevation-2);
  display: flex;
  gap: var(--v64-space-3);
  left: calc(8% + var(--aio-index) * 4%);
  padding: var(--v64-space-3) var(--v64-space-5) var(--v64-space-3) var(--v64-space-3);
  position: absolute;
  top: calc(var(--aio-index) * 52px);
  transform: rotate(calc(6deg - var(--aio-index) * 3deg));
  width: 66%;
}
.aio-hero__card--crown {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 16%, var(--v64-surface)), var(--v64-surface) 70%);
  border: 1.5px solid var(--aio-crown-strong);
  box-shadow: 0 24px 50px -24px color-mix(in srgb, var(--aio-crown-strong) 70%, transparent);
  padding-block: var(--v64-space-4);
  transform: rotate(-3deg) scale(1.06);
  width: 74%;
}
.aio-hero__name { font: var(--v64-type-title-md); }
.aio-hero__card--crown .aio-hero__name { font: var(--v64-type-title-lg); }

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
.aio-current__marks { display: flex; gap: var(--v64-space-2); padding-top: 6px; }
.aio-current__text { display: grid; flex: 1 1 12rem; }
.aio-current__label { color: var(--v64-on-surface-variant); font: var(--v64-type-label-md); letter-spacing: 0.06em; text-transform: uppercase; }
.aio-current__value { font: var(--v64-type-title-md); }

/* Provider cards */
.ai-onboarding__cards {
  display: grid;
  gap: var(--v64-space-5) var(--v64-space-4);
  grid-template-columns: repeat(3, minmax(0, 1fr));
}
.aio-card {
  animation: aio-rise var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) both;
  animation-delay: calc(var(--aio-index) * 40ms);
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-5);
  min-width: 0;
  padding: var(--v64-space-5);
  position: relative;
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard), box-shadow var(--v64-duration-short) var(--v64-ease-standard);
}
@media (hover: hover) {
  .ai-onboarding--pointer .aio-card:hover { border-color: var(--v64-outline); box-shadow: var(--v64-elevation-1); }
}
.aio-card--featured {
  align-items: end;
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 10%, var(--v64-surface)), var(--v64-surface) 55%);
  border: 2px solid var(--aio-crown-strong);
  border-radius: var(--v64-shape-xl);
  box-shadow: 0 18px 40px -24px color-mix(in srgb, var(--aio-crown-strong) 70%, transparent);
  column-gap: var(--v64-space-7);
  display: grid;
  grid-column: 1 / -1;
  grid-template-columns: 1fr 1fr;
  margin-top: var(--v64-space-2);
  padding: var(--v64-space-6);
}
@media (hover: hover) {
  .ai-onboarding--pointer .aio-card--featured:hover {
    border-color: var(--aio-crown-strong);
    box-shadow: 0 22px 48px -24px color-mix(in srgb, var(--aio-crown-strong) 80%, transparent);
  }
}
.v-theme--dark .aio-card--featured,
.v-theme--dark .ai-onboarding--pointer .aio-card--featured:hover {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 14%, var(--v64-surface)), var(--v64-surface) 60%);
  border: 1.5px solid color-mix(in srgb, var(--aio-crown) 70%, transparent);
  box-shadow: 0 0 0 1px color-mix(in srgb, var(--aio-crown) 25%, transparent),
    0 24px 60px -30px color-mix(in srgb, var(--aio-crown) 50%, transparent);
}
.aio-card--connected:not(.aio-card--featured) { border: 2px solid var(--v64-success); }
.aio-card--featured.aio-card--connected { outline: 2px solid var(--v64-success); outline-offset: 3px; }
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
.aio-card__ribbon { background: var(--aio-crown); color: var(--aio-crown-ink); right: var(--v64-space-5); }
.aio-card__connected { background: var(--v64-success-container); color: var(--v64-on-success-container); left: var(--v64-space-5); }
.aio-card__main { display: grid; gap: var(--v64-space-4); min-width: 0; }
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
.aio-card--featured .aio-card__rank { background: var(--aio-crown); color: var(--aio-crown-ink); }
.aio-card__identity { display: grid; flex: 1; min-width: 0; }
.aio-card__name { font: var(--v64-type-title-lg); }
.aio-card--featured .aio-card__name { font: var(--v64-type-headline-sm); }
.aio-card__tagline { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.aio-card__chevron { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.aio-card__head[aria-expanded="true"] .aio-card__chevron { transform: rotate(180deg); }
.aio-card__loading { padding-left: calc(28px + var(--v64-space-3)); }
.aio-card__facts { align-content: start; display: grid; gap: var(--v64-space-4); }
.aio-card__bullets { display: grid; gap: var(--v64-space-3); list-style: none; margin: 0; padding: 0; }
.aio-card__bullets li { align-items: center; display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-3); }
.aio-meter { display: inline-flex; flex: none; gap: 3px; }
.aio-meter i { background: var(--v64-outline-variant); border-radius: 3px; height: 6px; width: 12px; }
.aio-meter i.is-filled { background: var(--v64-primary); }
.aio-meter--low i.is-filled { background: var(--v64-on-surface-variant); }
.aio-card__why { font: var(--v64-type-body-lg); margin: 0; max-width: 28rem; }
.aio-card__note { color: var(--v64-on-surface-variant); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: 0; }
.aio-card__note .v-icon { flex: none; margin-top: 1px; }
/* Short cards keep plan and buttons together at the bottom. */
.aio-card__offer { display: flex; flex-direction: column; gap: var(--v64-space-3); margin-top: auto; }
.aio-card__plan {
  background: var(--v64-surface-container);
  border-radius: var(--v64-shape-md);
  display: grid;
  gap: 2px;
  padding: var(--v64-space-3) var(--v64-space-4);
}
.aio-card--featured .aio-card__plan {
  background: color-mix(in srgb, var(--aio-crown) 8%, var(--v64-surface));
  border: 1px solid var(--aio-crown-strong);
  padding: var(--v64-space-4) var(--v64-space-5);
}
.aio-card__plan-label { color: var(--v64-on-surface-variant); font: var(--v64-type-label-md); letter-spacing: 0.06em; text-transform: uppercase; }
.aio-card__plan-budget { font: var(--v64-type-title-lg); }
.aio-card--featured .aio-card__plan-budget { font: 600 2rem/2.5rem var(--v64-font-family); letter-spacing: -0.02em; }
.aio-card__plan-detail { font: var(--v64-type-body-md); }
.aio-card__plan-more { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin-top: var(--v64-space-1); }
.aio-card__ctas { display: grid; gap: var(--v64-space-1); }
.aio-card__ctas .v-btn { min-height: 48px; }
.aio-card__ctas .aio-card__have { font: var(--v64-type-label-lg); height: 40px; letter-spacing: 0; min-height: 40px; text-transform: none; }

/* Desktop featured card: name, facts and why left; the offer right, bottom-aligned. */
.aio-card--featured .aio-card__facts { max-width: 26rem; padding-left: calc(28px + var(--v64-space-3)); }
.aio-card--featured .aio-card__bullets li { font: var(--v64-type-body-lg); }
.aio-card--featured .aio-card__offer { margin-top: 0; }

/* Connect and routing */
.ai-onboarding__main > .ai-onboarding__connect,
.ai-onboarding__main > .ai-onboarding__routing { margin-block: auto; }
.aio-chosen {
  align-items: center;
  animation: aio-lift var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) both;
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: flex;
  gap: var(--v64-space-4);
  margin-bottom: var(--v64-space-6);
  padding: var(--v64-space-4) var(--v64-space-5);
}
.aio-chosen--crown {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 12%, var(--v64-surface)), var(--v64-surface) 60%);
  border: 2px solid var(--aio-crown-strong);
}
.aio-chosen__text { flex: 1; min-width: 0; }
.aio-chosen__budget { display: grid; text-align: right; }
.aio-chosen__title { font: var(--v64-type-headline-md); letter-spacing: -0.01em; margin: 0; outline: none; }
.aio-chosen__plan { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 2px 0 0; }
.ai-onboarding__connect-grid { align-items: start; display: grid; gap: var(--v64-space-6); grid-template-columns: 360px minmax(420px, 1fr); }
.aio-checklist { display: grid; gap: var(--v64-space-5); list-style: none; margin: 0; padding: 0; }
.aio-checklist li { display: grid; gap: var(--v64-space-3); grid-template-columns: 32px minmax(0, 1fr); }
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
.aio-checklist__title { font: var(--v64-type-title-md); margin: 4px 0; }
.aio-checklist__body { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 6px 0 var(--v64-space-3); }
.ai-onboarding__setup,
.ai-onboarding__panel {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  min-width: 0;
  padding: var(--v64-space-5);
}
/* The embedded sign-in sits flat inside this panel. */
.ai-onboarding__setup :deep(.accounts-setup__item) { background: transparent; border: 0 !important; padding: 0 !important; }
.ai-onboarding__panel { margin-top: var(--v64-space-4); max-width: 720px; }
.ai-onboarding__security { align-items: center; color: var(--v64-on-surface-variant); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: var(--v64-space-4) 0 0; }
.ai-onboarding__footer { border-top: 1px solid var(--v64-outline-variant); flex: none; padding: var(--v64-space-3) var(--v64-space-5); }
.aio-details-toggle { margin-top: var(--v64-space-4); }
.aio-details-toggle :deep(.v-btn__append) { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.aio-details-toggle.is-open :deep(.v-btn__append) { transform: rotate(180deg); }

/* Success */
.ai-onboarding__main > .ai-onboarding__success {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-2);
  margin-block: auto;
  max-width: 560px;
  text-align: center;
}
.ai-onboarding__success .ai-onboarding__lede { margin-inline: auto; }
.ai-onboarding__success > .v-btn { margin-top: var(--v64-space-5); }
.aio-success-mark { margin-bottom: var(--v64-space-5); position: relative; }
.aio-check {
  animation: aio-pop var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) calc(var(--v64-duration-medium) + 100ms) both;
  bottom: -10px;
  height: 40px;
  position: absolute;
  right: -12px;
  width: 40px;
}
.aio-check circle { fill: var(--v64-success); stroke: var(--v64-surface); stroke-width: 3; }
.aio-check path {
  animation: aio-draw calc(var(--v64-duration-medium) + 100ms) var(--v64-ease-emphasized-decelerate) var(--v64-duration-medium) both;
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
  max-width: 30rem;
  padding: var(--v64-space-4);
  text-align: left;
  width: 100%;
}
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
.aio-proof__body { display: grid; gap: 2px; min-width: 0; }
.aio-proof__name { font: var(--v64-type-label-lg); }
.aio-proof__reply { font: var(--v64-type-body-lg); margin: 0; }
.aio-proof__reply--quiet { color: var(--v64-on-surface-variant); }
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
.aio-recap { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: var(--v64-space-2) 0 0; }
.ai-onboarding__colleague { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-3); justify-content: center; margin-bottom: var(--v64-space-3); }
.ai-onboarding__colleague-error { margin: 0 auto var(--v64-space-3); max-width: 36rem; text-align: left; }
.ai-onboarding__note { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 0 0 var(--v64-space-2); }

/* Phone dock */
.ai-onboarding__dock {
  background: var(--v64-surface);
  border-top: 1px solid var(--v64-outline-variant);
  display: grid;
  flex: none;
  gap: var(--v64-space-1);
  padding: var(--v64-space-3) var(--v64-space-4) calc(var(--v64-space-3) + env(safe-area-inset-bottom));
}

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
@keyframes aio-fan { from { opacity: 0; transform: translateY(24px) rotate(0deg); } }
@keyframes aio-lift { from { opacity: 0.4; transform: scale(0.96) translateY(12px); } }
@keyframes aio-draw { from { stroke-dashoffset: 28; } to { stroke-dashoffset: 0; } }
@keyframes aio-pop { from { opacity: 0; transform: scale(0.4); } 60% { opacity: 1; transform: scale(1.12); } }
@keyframes aio-typing { 0%, 60%, 100% { opacity: 0.3; transform: translateY(0); } 30% { opacity: 1; transform: translateY(-3px); } }

/* Tablet */
@media (max-width: 959.98px) {
  .ai-onboarding__main > section { max-width: 640px; }
  .ai-onboarding__main { padding: var(--v64-space-5); }
  .ai-onboarding__headline { font: var(--v64-type-headline-md); }
  .ai-onboarding__main > .ai-onboarding__why { grid-template-columns: minmax(0, 1fr); }
  .ai-onboarding__why-copy { grid-row: 2; }
  .aio-hero { grid-column: 1; height: 220px; margin-bottom: var(--v64-space-5); }
  .ai-onboarding__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-onboarding__cards .aio-card:last-child { grid-column: 1 / -1; }
  .aio-card--featured { display: flex; padding: var(--v64-space-5); }
  .aio-card--featured .aio-card__facts { max-width: none; padding-left: 0; }
  .ai-onboarding__connect-grid { grid-template-columns: minmax(0, 1fr); }
}

/* Phone */
@media (max-width: 599.98px) {
  .ai-onboarding__headline { font: var(--v64-type-headline-sm); }
  .ai-onboarding__why .ai-onboarding__headline { font: var(--v64-type-headline-md); }
  .ai-onboarding__why .ai-onboarding__lede { font: var(--v64-type-body-lg); }
  /* Phone hero: the marks alone, Claude's 96px tile in front of Codex and DeepSeek. */
  .aio-hero { display: flex; height: 120px; justify-content: center; margin-bottom: var(--v64-space-4); }
  .aio-hero__card,
  .aio-hero__card--crown { background: none; border: 0; box-shadow: none; left: calc(50% - 32px); padding: 0; top: 30px; width: auto; }
  .aio-hero__card:nth-child(1) { display: none; }
  .aio-hero__card:nth-child(2) { transform: translateX(62px) rotate(12deg); }
  .aio-hero__card:nth-child(3) { transform: translateX(-62px) rotate(-12deg); }
  .aio-hero__card--crown { left: calc(50% - 48px); top: 14px; transform: none; z-index: 1; }
  .aio-hero__name { display: none; }
  .ai-onboarding__differences { font: var(--v64-type-label-md); gap: var(--v64-space-2) var(--v64-space-4); margin-block: var(--v64-space-4); }
  .ai-onboarding__differences li { font: var(--v64-type-label-md); }
  .ai-onboarding__differences .v-icon { --v-icon-size-multiplier: 0.85; }
  .ai-onboarding__cards { gap: var(--v64-space-4); grid-template-columns: minmax(0, 1fr); }
  .aio-card { gap: var(--v64-space-4); padding: var(--v64-space-4); }
  .aio-card--collapsed { gap: 0; justify-content: center; min-height: 72px; }
  .aio-card__head[type="button"] { cursor: pointer; min-height: 48px; }
  .aio-card__ribbon { right: var(--v64-space-4); }
  .aio-card__connected { left: var(--v64-space-4); }
  .aio-card--featured .aio-card__plan-budget { font: var(--v64-type-headline-sm); }
  .aio-current { padding: var(--v64-space-3) var(--v64-space-4); }
  .aio-current__keep { width: 100%; }
  .aio-chosen { flex-wrap: wrap; padding: var(--v64-space-3) var(--v64-space-4); }
  .aio-chosen__budget { border-top: 1px solid var(--v64-outline-variant); flex-basis: 100%; padding-top: var(--v64-space-3); text-align: left; }
  .aio-chosen__title { font: var(--v64-type-headline-sm); }
  .ai-onboarding__setup, .ai-onboarding__panel { padding: var(--v64-space-4); }
}

.aio-card__head:focus-visible { border-radius: var(--v64-shape-sm); }
.ai-onboarding :deep(.v-btn:focus-visible),
.aio-card__head:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .aio-card, .aio-hero__card, .aio-chosen, .aio-check, .aio-check path, .aio-proof__typing i { animation: none; }
  .aio-card, .aio-card__chevron, .ai-onboarding__dots span { transition: none; }
  .aio-forward-enter-from, .aio-forward-leave-to, .aio-back-enter-from, .aio-back-leave-to { transform: none; }
}
</style>
