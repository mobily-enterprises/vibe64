<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import {
  mdiAlertCircleOutline, mdiArrowLeft, mdiArrowRight, mdiBugCheckOutline, mdiCheck, mdiCheckCircle, mdiChevronDown,
  mdiClose, mdiCrown, mdiFileTreeOutline, mdiInformationOutline, mdiOpenInNew, mdiShieldLockOutline, mdiSitemapOutline
} from "@mdi/js";
import AIAccountsSetup from "../studio/AIAccountsSetup.vue";
import ModelRoutingForm from "../studio/ModelRoutingForm.vue";
import NativeProviderConnections from "../studio/NativeProviderConnections.vue";
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

const screen = ref("why");
const direction = ref("forward");
const stage = ref(null);
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
const outcome = ref({ routed: true, colleague: null, error: "" });
const announcement = ref("");

const busy = computed(() => setupBusy.value || routingBusy.value || verifying.value);
const cards = computed(() => props.onboarding.cards.value);
const loaded = computed(() => props.onboarding.loaded.value);
const loadError = computed(() => props.onboarding.loadError.value);
const featured = computed(() => cards.value.find((card) => card.crown));
const others = computed(() => cards.value.filter((card) => !card.crown));
const nativeLogin = computed(() => ["anthropic", "openai"].includes(chosen.value?.connect.modelProviderId));
const footnote = computed(() => props.workspace
  ? "You can change this any time from your account menu."
  : "You can change this any time in Account settings > AI Accounts.");
// Set up later snoozes first-run onboarding; a redo just closes.
const skippable = computed(() => !wasSetUp.value && !["success", "owner"].includes(screen.value));
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

function resetAttempt() {
  warning.value = "";
  notReady.value = false;
  makeMain.value = false;
  routingReviewed.value = false;
  fullRouting.value = false;
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
    announcement.value = `${card.name} is connected.`;
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

// Phone: lower-ranked cards collapse to a row; one opens at a time.
function collapsible(card) {
  return xs.value && !card.crown;
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
    <div ref="stage" class="ai-onboarding" :class="{ 'ai-onboarding--phone': xs }">
      <header class="ai-onboarding__bar">
        <v-btn
          v-if="xs && ['connect', 'routing'].includes(screen)" :icon="mdiArrowLeft" variant="text" aria-label="Back"
          :disabled="busy" @click="go('choose', true)"
        />
        <span v-else class="ai-onboarding__wordmark">Vibe<span>64</span></span>
        <div v-if="!xs && !wasSetUp && STEP[screen]" class="ai-onboarding__dots" aria-hidden="true">
          <span v-for="step in 3" :key="step" :class="{ 'is-active': STEP[screen] === step, 'is-done': STEP[screen] > step }" />
        </div>
        <div class="ai-onboarding__bar-actions">
          <v-tooltip :disabled="!busy" text="Finish or cancel the current step first" location="bottom">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="d-inline-flex align-center">
                <v-btn v-if="!xs && skippable" variant="text" :disabled="busy" @click="close('later')">Set up later</v-btn>
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
            <p class="ai-onboarding__eyebrow">WELCOME TO VIBE64</p>
            <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
              First, give Vibe64 a <span class="ai-onboarding__accent">brilliant mind.</span>
            </h1>
            <p class="ai-onboarding__lede">
              Vibe64 builds real apps with you, and the AI you connect does the thinking. The smartest models plan better,
              write cleaner code and fix their own mistakes.
            </p>
            <p class="ai-onboarding__lede">
              Frontier models make a huge difference to how Vibe64 feels. Free and budget models can work, but you'll notice
              the gap quickly. Setting up takes a few minutes.
            </p>
            <ul class="ai-onboarding__differences">
              <li v-for="difference in DIFFERENCES" :key="difference.label">
                <v-icon :icon="difference.icon" size="20" aria-hidden="true" />{{ difference.label }}
              </li>
            </ul>
            <div v-if="!xs" class="ai-onboarding__actions">
              <v-btn color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="go('choose')">Choose my AI</v-btn>
              <v-btn variant="text" size="large" @click="close('later')">Set up later</v-btn>
            </div>
            <p class="ai-onboarding__footnote">{{ footnote }}</p>
          </section>

          <section v-else-if="screen === 'choose'" key="choose" class="ai-onboarding__choose">
            <header class="ai-onboarding__intro">
              <p class="ai-onboarding__eyebrow">{{ wasSetUp ? "YOUR AI" : "STEP 2 OF 3" }}</p>
              <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">{{ wasSetUp ? "Your AI setup" : "Pick the AI behind Vibe64" }}</h1>
              <p class="ai-onboarding__lede">
                {{ wasSetUp
                  ? "Keep what you have, switch your main AI, or add another. Nothing is removed."
                  : "Ranked by how good Vibe64 feels with each. Our honest advice: start with Claude." }}
              </p>
            </header>
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
                <component
                  :is="collapsible(card) ? 'button' : 'div'" class="aio-card__head"
                  :type="collapsible(card) ? 'button' : undefined"
                  :aria-expanded="collapsible(card) ? String(expanded(card)) : undefined"
                  @click="collapsible(card) && (expandedId = expandedId === card.id ? '' : card.id)"
                >
                  <span class="aio-card__rank" aria-hidden="true">{{ card.rank }}</span>
                  <span class="aio-card__mark" aria-hidden="true">
                    {{ card.mark }}
                    <svg v-if="card.crown" class="aio-card__crown" viewBox="0 0 24 24"><path :d="mdiCrown" /></svg>
                  </span>
                  <span class="aio-card__identity">
                    <span :id="`aio-card-${card.id}`" class="aio-card__name">{{ card.name }}</span>
                    <span class="aio-card__tagline">{{ card.tagline }}</span>
                  </span>
                  <v-icon v-if="collapsible(card)" :icon="mdiChevronDown" class="aio-card__chevron" aria-hidden="true" />
                </component>
                <div v-if="!loaded && !loadError" class="aio-card__status">
                  <v-skeleton-loader type="chip" width="120" height="32" />
                </div>
                <div v-else-if="card.connected" class="aio-card__status">
                  <v-chip color="success" variant="tonal" size="small" :prepend-icon="mdiCheckCircle">Connected</v-chip>
                  <span>through {{ card.through.join(" and ") }}</span>
                </div>
                <div v-if="expanded(card)" class="aio-card__body">
                  <div class="aio-card__facts">
                    <ul class="aio-card__bullets">
                      <li v-for="bullet in card.bullets" :key="bullet[0]">
                        <span>{{ bullet[2] }}</span>
                        <span class="aio-meter" :class="{ 'aio-meter--low': bullet[1] === 1 }" role="img" :aria-label="meterLabel(bullet)">
                          <i v-for="segment in 3" :key="segment" :class="{ 'is-filled': segment <= bullet[1] }" />
                        </span>
                      </li>
                    </ul>
                    <p v-if="card.note" class="aio-card__note">
                      <v-icon :icon="mdiInformationOutline" size="18" aria-hidden="true" />{{ card.note }}
                    </p>
                  </div>
                  <div class="aio-card__offer">
                    <div class="aio-card__plan">
                      <span class="aio-card__plan-name">{{ card.plan.name }}</span>
                      <span class="aio-card__plan-headline">{{ card.plan.headline }}</span>
                      <span class="aio-card__plan-detail">{{ card.plan.detail }}</span>
                      <span v-if="card.plan.more" class="aio-card__plan-more">{{ card.plan.more }}</span>
                    </div>
                    <div class="aio-card__ctas">
                      <template v-if="cardAction(card) === 'keep'">
                        <v-btn color="primary" :variant="card.crown ? 'flat' : 'tonal'" size="large" :disabled="verifying" @click="keep(card)">
                          Keep using {{ card.name }}
                        </v-btn>
                      </template>
                      <template v-else-if="cardAction(card) === 'main'">
                        <v-btn color="primary" :variant="card.crown ? 'flat' : 'tonal'" size="large" :disabled="verifying" @click="makeMainAi(card)">
                          Use {{ card.name }} as my main AI
                        </v-btn>
                      </template>
                      <template v-else>
                        <v-btn
                          color="primary" :variant="card.crown ? 'flat' : 'tonal'" size="large"
                          :href="card.signUp.url" target="_blank" rel="noopener noreferrer" :append-icon="mdiOpenInNew"
                          @click="connect(card, 'opened')"
                        >
                          Get {{ card.name }}<span class="d-sr-only"> (opens in a new tab)</span>
                        </v-btn>
                        <v-btn variant="text" class="aio-card__have" @click="connect(card, 'have')">{{ card.have }}</v-btn>
                      </template>
                    </div>
                  </div>
                </div>
              </article>
            </div>
            <p class="ai-onboarding__footnote">Prices are set by each provider and can change. You pay them directly; Vibe64 never resells AI.</p>
          </section>

          <section v-else-if="screen === 'connect'" key="connect" class="ai-onboarding__connect">
            <header class="ai-onboarding__intro">
              <p class="ai-onboarding__eyebrow">STEP 3 OF 3</p>
              <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">Connect {{ chosen.name }}</h1>
            </header>
            <div class="ai-onboarding__connect-grid">
              <ol class="aio-checklist">
                <li :class="{ 'is-done': signUp === 'opened' }">
                  <span class="aio-checklist__marker" aria-hidden="true">
                    <v-icon v-if="signUp === 'opened'" :icon="mdiCheck" size="18" /><template v-else>1</template>
                  </span>
                  <div>
                    <p class="aio-checklist__title">
                      {{ signUp === "have" ? "Already subscribed" : "Get a plan" }}<span v-if="signUp === 'opened'" class="d-sr-only"> (done)</span>
                    </p>
                    <p class="aio-checklist__body">
                      {{ signUp === "have" ? "Go straight to the next step. Need a plan after all? Open the sign-up page." : chosen.signUp.step }}
                    </p>
                    <v-btn
                      variant="outlined" :href="chosen.signUp.url" target="_blank" rel="noopener noreferrer"
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
              <div class="ai-onboarding__setup" :class="{ 'ai-onboarding__setup--plain': nativeLogin }">
                <AIAccountsSetup
                  v-if="nativeLogin" embedded :provider-id="chosen.connect.engineId"
                  :model-provider-id="chosen.connect.modelProviderId" @connected="finish()"
                />
                <NativeProviderConnections
                  v-else embedded adding :select-provider="false" :engine-id="chosen.connect.engineId"
                  :model-value="chosen.connect.modelProviderId" @busy="setupBusy = $event" @close="finish()"
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
              <p class="ai-onboarding__eyebrow">{{ chosen.engineLabel.toUpperCase() }}</p>
              <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">
                {{ fullRouting ? "Review model routing" : `Use ${chosen.name} for ${chosen.engineLabel}?` }}
              </h1>
            </header>
            <div class="ai-onboarding__panel">
              <ModelRoutingForm
                :engine-id="chosen.connect.engineId"
                :connection-id="fullRouting ? '' : chosen.connect.modelProviderId"
                :connection-label="fullRouting ? '' : chosen.name"
                @busy="routingBusy = $event" @saved="routingDone" @close="routingDone"
              />
            </div>
          </section>

          <section v-else-if="screen === 'success'" key="success" class="ai-onboarding__success">
            <svg class="aio-check" viewBox="0 0 96 96" aria-hidden="true">
              <circle cx="48" cy="48" r="44" />
              <path d="M30 49 l12 12 l24 -26" />
            </svg>
            <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">{{ chosen.name }} is connected</h1>
            <p v-if="colleagueNote === 'uses'" class="ai-onboarding__lede">Colleague now uses {{ outcome.colleague.label }}.</p>
            <div v-else-if="colleagueNote === 'switch'" class="ai-onboarding__colleague">
              <v-chip v-if="outcome.colleague" variant="tonal">Colleague: still using {{ outcome.colleague.label }}</v-chip>
              <v-btn variant="tonal" color="primary" :loading="verifying" @click="switchColleague">Use {{ chosen.name }} for Colleague</v-btn>
            </div>
            <p v-else class="ai-onboarding__lede">Choose {{ chosen.name }} in Colleague's model menu to use it there.</p>
            <v-alert v-if="outcome.error" type="warning" variant="tonal" class="ai-onboarding__colleague-error">
              Colleague couldn't switch to {{ chosen.name }}: {{ outcome.error }}
            </v-alert>
            <p v-if="!outcome.routed" class="ai-onboarding__note">
              {{ chosen.engineLabel }} keeps its current models. {{ chosen.name }} is ready in AI Accounts whenever you want it.
            </p>
            <p v-if="workspace && chosen.connect.access === 'personal'" class="ai-onboarding__note">
              This subscription serves only you. Workspace members need a Workspace-use connection, such as DeepSeek or an OpenAI API key.
            </p>
            <v-btn color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="close('done')">Start building</v-btn>
          </section>

          <section v-else key="owner" class="ai-onboarding__success">
            <v-icon :icon="mdiAlertCircleOutline" size="48" color="primary" aria-hidden="true" />
            <h1 id="ai-onboarding-title" tabindex="-1" class="ai-onboarding__headline">Only the workspace owner can connect AI accounts.</h1>
            <v-btn color="primary" variant="flat" size="large" @click="close('dismiss')">Close</v-btn>
          </section>
        </Transition>
        <p class="d-sr-only" aria-live="polite">{{ announcement }}</p>
      </main>

      <footer v-if="xs && skippable" class="ai-onboarding__dock">
        <v-btn v-if="screen === 'why'" block color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="go('choose')">Choose my AI</v-btn>
        <v-btn block variant="text" :disabled="busy" @click="close('later')">Set up later</v-btn>
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
  --aio-tertiary: #7d5260;
  --aio-stage: radial-gradient(1200px 600px at 50% -10%, var(--v64-primary-container), transparent 70%), var(--v64-surface-container-lowest);
  background: var(--aio-stage);
  color: var(--v64-on-surface);
  display: flex;
  flex-direction: column;
  font-family: var(--v64-font-family);
  height: 100%;
  overflow: hidden;
}
.v-theme--dark .ai-onboarding { --aio-crown-strong: #f5c518; --aio-tertiary: #efb8c8; }

/* Top bar */
.ai-onboarding__bar {
  align-items: center;
  display: grid;
  flex: none;
  grid-template-columns: 1fr auto 1fr;
  height: 64px;
  padding: 0 var(--v64-space-5);
}
.ai-onboarding--phone .ai-onboarding__bar { padding: env(safe-area-inset-top) var(--v64-space-2) 0 var(--v64-space-4); }
.ai-onboarding__wordmark { font: var(--v64-type-title-lg); letter-spacing: -0.01em; }
.ai-onboarding__wordmark span { color: var(--v64-primary); }
.ai-onboarding__dots { display: flex; gap: 6px; }
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
}
.ai-onboarding__accent { color: var(--v64-primary); }
.ai-onboarding__lede { color: var(--v64-on-surface-variant); font: var(--v64-type-body-lg); margin: 0 0 var(--v64-space-4); max-width: 60ch; }
.ai-onboarding__footnote { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: var(--v64-space-6) 0 0; }
.ai-onboarding__intro { margin-bottom: var(--v64-space-6); }

/* Why */
.ai-onboarding__main > .ai-onboarding__why { margin-block: auto; max-width: 680px; padding-bottom: var(--v64-space-7); }
.ai-onboarding__why .ai-onboarding__headline { font: 600 2.75rem/3.25rem var(--v64-font-family); letter-spacing: -0.02em; }
.ai-onboarding__differences {
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2);
  list-style: none;
  margin: var(--v64-space-5) 0 var(--v64-space-6);
  padding: 0;
}
.ai-onboarding__differences li {
  align-items: center;
  background: var(--v64-surface-container);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-full);
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-2);
  min-height: 40px;
  padding: 0 var(--v64-space-4) 0 var(--v64-space-3);
}
.ai-onboarding__differences .v-icon { color: var(--v64-primary); }
.ai-onboarding__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-3); }

/* Provider cards */
.ai-onboarding__cards {
  display: grid;
  gap: var(--v64-space-4);
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
  gap: var(--v64-space-4);
  min-width: 0;
  padding: var(--v64-space-5);
  position: relative;
  transition: border-color var(--v64-duration-short) var(--v64-ease-standard),
    box-shadow var(--v64-duration-short) var(--v64-ease-standard), transform var(--v64-duration-short) var(--v64-ease-standard);
}
.aio-card:hover { border-color: var(--v64-outline); box-shadow: var(--v64-elevation-1); transform: translateY(-2px); }
.aio-card--featured {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 10%, var(--v64-surface)), var(--v64-surface) 55%);
  border: 2px solid var(--aio-crown-strong);
  border-radius: var(--v64-shape-xl);
  box-shadow: 0 18px 40px -24px color-mix(in srgb, var(--aio-crown-strong) 70%, transparent);
  grid-column: 1 / -1;
  margin-top: var(--v64-space-2);
}
.aio-card--featured:hover {
  border-color: var(--aio-crown-strong);
  box-shadow: 0 22px 48px -24px color-mix(in srgb, var(--aio-crown-strong) 80%, transparent);
}
/* Straddles the top border, so it never competes with the name for width. */
.aio-card__ribbon {
  background: var(--aio-crown);
  border-radius: var(--v64-shape-full);
  box-shadow: 0 0 0 3px var(--v64-surface);
  color: var(--aio-crown-ink);
  font: var(--v64-type-label-lg);
  letter-spacing: 0.02em;
  padding: 3px 12px;
  position: absolute;
  right: var(--v64-space-5);
  top: -14px;
}
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
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-surface-variant);
  display: inline-flex;
  flex: none;
  font: var(--v64-type-label-md);
  height: 24px;
  justify-content: center;
  width: 24px;
}
.aio-card--featured .aio-card__rank { border-color: var(--aio-crown-strong); color: var(--aio-crown-strong); }
.aio-card__mark {
  align-items: center;
  background: var(--aio-tone-bg);
  border-radius: var(--v64-shape-md);
  color: var(--aio-tone-fg);
  display: inline-flex;
  flex: none;
  font: var(--v64-type-title-md);
  height: 48px;
  justify-content: center;
  position: relative;
  width: 48px;
}
.aio-card--primary { --aio-tone-bg: color-mix(in srgb, var(--aio-crown) 28%, var(--v64-surface)); --aio-tone-fg: var(--aio-crown-ink); }
.v-theme--dark .aio-card--primary { --aio-tone-fg: var(--aio-crown); }
.aio-card--secondary { --aio-tone-bg: var(--v64-secondary-container); --aio-tone-fg: var(--v64-on-secondary-container); }
.aio-card--tertiary {
  --aio-tone-bg: color-mix(in srgb, var(--aio-tertiary) 16%, rgb(var(--v-theme-surface)));
  --aio-tone-fg: color-mix(in srgb, var(--aio-tertiary) 75%, rgb(var(--v-theme-on-surface)));
}
.aio-card--neutral { --aio-tone-bg: var(--v64-surface-container-highest); --aio-tone-fg: var(--v64-on-surface); }
.aio-card__crown {
  animation: aio-crown-settle calc(var(--v64-duration-medium) * 2) var(--v64-ease-emphasized-decelerate) calc(var(--v64-duration-medium) + 120ms) both;
  fill: var(--aio-crown);
  filter: drop-shadow(0 1px 1px color-mix(in srgb, var(--aio-crown-ink) 35%, transparent));
  height: 28px;
  left: calc(50% - 14px);
  position: absolute;
  stroke: var(--aio-crown-strong);
  stroke-width: 1px;
  top: -20px;
  transform: rotate(-8deg);
  width: 28px;
}
.aio-card__identity { display: grid; flex: 1; min-width: 0; }
.aio-card__name { font: var(--v64-type-title-lg); }
.aio-card__tagline { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }
.aio-card__chevron { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.aio-card__head[aria-expanded="true"] .aio-card__chevron { transform: rotate(180deg); }
.aio-card--connected:not(.aio-card--featured) { border-color: color-mix(in srgb, var(--v64-success) 55%, transparent); }
.aio-card--collapsed .aio-card__status { margin-top: var(--v64-space-3); }
.aio-card__status { align-items: center; color: var(--v64-on-surface-variant); display: flex; flex-wrap: wrap; font: var(--v64-type-body-md); gap: var(--v64-space-2); }
.aio-card__body { display: flex; flex: 1; flex-direction: column; gap: var(--v64-space-4); }
/* Desktop featured card: identity and facts left, the offer right. */
.aio-card--featured {
  align-content: start;
  column-gap: var(--v64-space-6);
  display: grid;
  grid-template-columns: 3fr 2fr;
}
.aio-card--featured > * { grid-column: 1; }
.aio-card--featured .aio-card__body { display: contents; }
.aio-card--featured .aio-card__facts { max-width: 22rem; padding-left: calc(24px + var(--v64-space-3)); }
.aio-card--featured .aio-card__bullets { gap: var(--v64-space-4); }
.aio-card--featured .aio-card__bullets li { font: var(--v64-type-body-lg); }
.aio-card--featured .aio-card__offer { grid-column: 2; grid-row: 1 / span 3; }
.aio-card__facts { display: grid; align-content: start; gap: var(--v64-space-4); }
.aio-card__bullets { display: grid; gap: var(--v64-space-3); list-style: none; margin: 0; padding: 0; }
.aio-card__bullets li { align-items: center; display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-3); justify-content: space-between; }
.aio-meter { display: inline-flex; flex: none; gap: 3px; }
.aio-meter i { background: var(--v64-outline-variant); border-radius: 3px; height: 6px; width: 14px; }
.aio-meter i.is-filled { background: var(--v64-primary); }
.aio-meter--low i.is-filled { background: var(--v64-on-surface-variant); }
.aio-card__note { color: var(--v64-on-surface-variant); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: 0; }
.aio-card__note .v-icon { flex: none; margin-top: 1px; }
.aio-card__offer { display: flex; flex: 1; flex-direction: column; gap: var(--v64-space-4); justify-content: space-between; }
.aio-card__plan {
  background: var(--v64-surface-container);
  border-radius: var(--v64-shape-md);
  display: grid;
  gap: 2px;
  padding: var(--v64-space-3) var(--v64-space-4);
}
.aio-card--featured .aio-card__plan { background: transparent; border: 1px solid var(--aio-crown-strong); }
.aio-card__plan-name { color: var(--v64-on-surface-variant); font: var(--v64-type-label-lg); }
.aio-card__plan-headline { font: var(--v64-type-title-md); }
.aio-card--featured .aio-card__plan-headline { font: var(--v64-type-title-lg); }
.aio-card__plan-detail { font: var(--v64-type-body-md); }
.aio-card__plan-more { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin-top: var(--v64-space-1); }
.aio-card__ctas { display: grid; gap: var(--v64-space-1); }
.aio-card__ctas .v-btn { min-height: 48px; }
.aio-card__have { height: auto !important; padding-block: var(--v64-space-2); }
.aio-card__have :deep(.v-btn__content) { white-space: normal; }

/* Connect */
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
  background: var(--v64-surface-container);
  border-radius: var(--v64-shape-lg);
  min-width: 0;
  padding: var(--v64-space-5);
}
.ai-onboarding__panel { max-width: 720px; }
.ai-onboarding__setup--plain { background: none; padding: 0; }
.ai-onboarding__security { align-items: center; color: var(--v64-on-surface-variant); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: var(--v64-space-4) 0 0; }
.ai-onboarding__footer { border-top: 1px solid var(--v64-outline-variant); flex: none; padding: var(--v64-space-3) var(--v64-space-5); }

/* Success */
.ai-onboarding__main > .ai-onboarding__success {
  align-items: center;
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-2);
  max-width: 560px;
  padding-top: var(--v64-space-7);
  text-align: center;
}
.ai-onboarding__success .ai-onboarding__lede { margin-inline: auto; }
.ai-onboarding__success > .v-btn { margin-top: var(--v64-space-5); }
.ai-onboarding__colleague { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-3); justify-content: center; margin-bottom: var(--v64-space-3); }
.ai-onboarding__colleague-error { margin: 0 auto var(--v64-space-3); max-width: 36rem; text-align: left; }
.ai-onboarding__note { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 0 0 var(--v64-space-2); }
.aio-check { animation: aio-pop var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) calc(var(--v64-duration-medium) + 100ms) both; height: 96px; margin-bottom: var(--v64-space-4); width: 96px; }
.aio-check circle { fill: var(--v64-success-container); stroke: none; }
.aio-check path {
  animation: aio-draw calc(var(--v64-duration-medium) + 100ms) var(--v64-ease-emphasized-decelerate) both;
  fill: none;
  stroke: var(--v64-success);
  stroke-dasharray: 64;
  stroke-linecap: round;
  stroke-linejoin: round;
  stroke-width: 6;
}

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
@keyframes aio-crown-settle { from { opacity: 0; transform: translateY(-6px) rotate(-20deg) scale(0.7); } }
@keyframes aio-draw { from { stroke-dashoffset: 64; } to { stroke-dashoffset: 0; } }
@keyframes aio-pop { 50% { transform: scale(1.06); } }

/* Tablet */
@media (max-width: 959.98px) {
  .ai-onboarding__main > section { max-width: 640px; }
  .ai-onboarding__main { padding: var(--v64-space-5); }
  .ai-onboarding__headline { font: var(--v64-type-headline-md); }
  .ai-onboarding__cards { grid-template-columns: repeat(2, minmax(0, 1fr)); }
  .ai-onboarding__cards .aio-card:last-child { grid-column: 1 / -1; }
  .aio-card--featured { display: flex; }
  .aio-card--featured .aio-card__body { display: flex; }
  .aio-card--featured .aio-card__facts { max-width: none; padding-left: 0; }
  .ai-onboarding__connect-grid { grid-template-columns: minmax(0, 1fr); }
}

/* Phone */
@media (max-width: 599.98px) {
  .ai-onboarding__headline { font: var(--v64-type-headline-sm); }
  .ai-onboarding__differences { flex-direction: column; align-items: flex-start; }
  .ai-onboarding__cards { gap: var(--v64-space-3); grid-template-columns: minmax(0, 1fr); }
  .aio-card { padding: var(--v64-space-4); }
  .aio-card:hover { transform: none; }
  .aio-card--collapsed { gap: 0; min-height: 72px; justify-content: center; }
  .aio-card__head[type="button"] { cursor: pointer; min-height: 48px; }
  .aio-card__ribbon { right: var(--v64-space-4); }
  .aio-card--featured .aio-card__plan-headline { font: var(--v64-type-title-md); }
  .ai-onboarding__why .ai-onboarding__headline { font: var(--v64-type-headline-md); }
  .ai-onboarding__setup:not(.ai-onboarding__setup--plain), .ai-onboarding__panel { padding: var(--v64-space-4); }
}

.aio-card__head:focus-visible { border-radius: var(--v64-shape-sm); }
.ai-onboarding :deep(.v-btn:focus-visible),
.aio-card__head:focus-visible {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .aio-card, .aio-card__crown, .aio-check, .aio-check path { animation: none; }
  .aio-card, .aio-card__chevron, .ai-onboarding__dots span { transition: none; }
  .aio-card:hover { transform: none; }
  .aio-forward-enter-from, .aio-forward-leave-to, .aio-back-enter-from, .aio-back-leave-to { transform: none; }
}
</style>
