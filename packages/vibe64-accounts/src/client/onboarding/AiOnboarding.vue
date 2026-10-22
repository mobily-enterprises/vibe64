<script setup>
import { computed, nextTick, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { mdiArrowLeft, mdiArrowRight, mdiBugCheckOutline, mdiClose, mdiFileTreeOutline, mdiSitemapOutline } from "@mdi/js";
import AiOnboardingMark from "./AiOnboardingMark.vue";
import AiSetup from "./AiSetup.vue";

// The fullscreen onboarding shell: top bar, step dots, the Why screen and the
// phone dock, around the AI setup stage.
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
const STEP = { why: 1, choose: 2, connect: 3, routing: 3, success: 3 };

// "why" shows the Why screen, "setup" the AI setup stage.
const view = ref("why");
const direction = ref("forward");
const stage = ref(null);
const setup = ref(null);
// Hover styling waits for real pointer movement, so a resting cursor stays still.
const pointerMoved = ref(false);

const screen = computed(() => view.value === "why" ? "why" : setup.value?.screen || "choose");
const wasSetUp = computed(() => view.value === "setup" && Boolean(setup.value?.wasSetUp));
const busy = computed(() => Boolean(setup.value?.busy));
const cards = computed(() => props.onboarding.cards.value);
const changeWhere = computed(() => props.workspace ? "your account menu" : "Account settings → AI Accounts");
// Set up later snoozes first-run onboarding; a redo just closes.
const skippable = computed(() => view.value === "why" || Boolean(setup.value?.skippable));
const dock = computed(() => xs.value && (screen.value === "success" || screen.value === "why" && skippable.value));
const doneLabel = computed(() => setup.value?.doneLabel || "");

// First run opens on Why; a redo, an existing setup or a member opens the stage.
function startsAtWhy() {
  return props.canConfigure && props.start === "why" && !props.redo && !props.onboarding.isSetUp.value;
}

watch(() => props.open, (open) => {
  if (!open) return;
  direction.value = "forward";
  view.value = startsAtWhy() ? "why" : "setup";
}, { immediate: true });

// Opened before the connections were read: settle once they are, before any choice.
watch(() => props.onboarding.loaded.value, (known) => {
  if (props.open && known && view.value === "why" && !startsAtWhy()) view.value = "setup";
});

function chooseMyAi() {
  direction.value = "forward";
  view.value = "setup";
}

function close(reason, card = null) {
  if (!busy.value) emit("close", reason, card);
}

function focusTitle() {
  nextTick(() => stage.value?.querySelector("h1")?.focus({ preventScroll: true }));
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
          :disabled="busy" @click="setup?.back()"
        />
        <span v-else class="ai-onboarding__wordmark">Vibe<span>64</span></span>
        <div v-if="!wasSetUp && STEP[screen]" class="ai-onboarding__dots" aria-hidden="true">
          <span v-for="step in 3" :key="step" :class="{ 'is-active': STEP[screen] === step, 'is-done': STEP[screen] > step }" />
        </div>
        <div class="ai-onboarding__bar-actions">
          <v-tooltip :disabled="!busy" text="Finish or cancel the current step first" location="bottom">
            <template #activator="{ props: tip }">
              <span v-bind="tip" class="d-inline-flex align-center">
                <v-btn v-if="skippable && screen !== 'why' && !xs" variant="text" :disabled="busy" @click="close('later')">Set up later</v-btn>
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
                v-for="(card, index) in cards" :key="card.id"
                class="aio-hero__card" :class="{ 'aio-hero__card--crown': card.crown }" :style="{ '--aio-index': index, '--aio-fade': [1, 1, 0.7, 0.5][index] }"
              >
                <AiOnboardingMark :provider="card" :size="card.crown ? (xs ? 96 : 64) : (xs ? 64 : 40)" :settle-delay="card.crown ? 600 : -1" />
                <span class="aio-hero__identity">
                  <span class="aio-hero__name">{{ card.name }}</span>
                  <span class="aio-hero__tagline">{{ card.crown ? "Best for Vibe64" : card.tagline }}</span>
                </span>
                <span class="aio-meter aio-hero__meter" :class="{ 'aio-meter--low': card.bullets[0][1] <= 2 }">
                  <i v-for="segment in 5" :key="segment" :class="{ 'is-filled': segment <= card.bullets[0][1] }" />
                </span>
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
                  <span class="ai-onboarding__difference-icon"><v-icon :icon="difference.icon" size="24" aria-hidden="true" /></span>{{ difference.label }}
                </li>
              </ul>
              <div v-if="!xs" class="ai-onboarding__actions">
                <v-btn color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="chooseMyAi">Choose my AI</v-btn>
                <v-btn variant="text" size="large" @click="close('later')">Set up later</v-btn>
              </div>
              <p v-if="!xs" class="ai-onboarding__footnote">You can change this any time in {{ changeWhere }}.</p>
            </div>
          </section>
          <AiSetup
            v-else key="setup" ref="setup" :open="open" :redo="redo" :onboarding="onboarding"
            :can-configure="canConfigure" :workspace="workspace" @close="close"
          />
        </Transition>
      </main>

      <footer v-if="dock" class="ai-onboarding__dock">
        <template v-if="screen === 'why'">
          <v-btn block color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="chooseMyAi">Choose my AI</v-btn>
          <v-btn block variant="text" @click="close('later')">Set up later</v-btn>
          <p class="ai-onboarding__dock-note">You can change this any time in {{ changeWhere }}.</p>
        </template>
        <v-btn v-else block color="primary" variant="flat" size="large" :append-icon="mdiArrowRight" @click="close('done')">{{ doneLabel }}</v-btn>
      </footer>
    </div>
  </v-dialog>
</template>

<style scoped>
.ai-onboarding {
  --aio-crown: #f5c518;
  --aio-crown-ink: #2b2100;
  --aio-crown-strong: #8a6a00;
  --aio-type-body-sm: 400 0.8125rem/1.125rem var(--v64-font-family);
  --aio-stage-top: clamp(24px, 6vh, 72px);
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
/* One button shape across the flow. */
.ai-onboarding :deep(.v-btn:not(.v-btn--icon)) { border-radius: var(--v64-shape-md); letter-spacing: 0; text-transform: none; }
/* Dark: filled primary buttons take dark ink on a lighter primary (AA contrast). */
.v-theme--dark .ai-onboarding :deep(.v-btn--variant-flat.bg-primary:not(.v-btn--disabled)) {
  background: color-mix(in srgb, rgb(var(--v-theme-primary)) 45%, #fff) !important;
  color: #0b1d33 !important;
}
/* Disabled primaries use the neutral disabled tokens, not a faded primary. */
.ai-onboarding :deep(.v-btn--disabled.v-btn--variant-flat) {
  background: color-mix(in srgb, var(--v64-on-surface) 12%, transparent) !important;
  color: color-mix(in srgb, var(--v64-on-surface) 38%, transparent) !important;
  opacity: 1;
}
.ai-onboarding :deep(.v-btn--disabled .v-btn__overlay) { opacity: 0; }
/* Touch: a tap leaves no hover layer behind on the control now under the finger. */
@media (hover: none) {
  .ai-onboarding :deep(.v-btn:hover:not(:focus-visible) > .v-btn__overlay) { opacity: 0; }
}
/* Field helper text and alerts in the flow's type scale. */
.ai-onboarding :deep(.v-messages),
.ai-onboarding :deep(.text-body-small) { font: var(--aio-type-body-sm); letter-spacing: 0; }
.ai-onboarding :deep(.v-alert-title) { font: var(--v64-type-title-md); letter-spacing: 0; margin-bottom: 2px; }
.ai-onboarding :deep(.v-alert__content) { font: var(--v64-type-body-md); }

/* Top bar: wordmark or back, centred dots, close. */
.ai-onboarding__bar {
  align-items: center;
  display: grid;
  flex: none;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  height: 64px;
  padding: 0 var(--v64-space-5);
}
.ai-onboarding--phone .ai-onboarding__bar { height: 56px; padding: env(safe-area-inset-top) var(--v64-space-1) 0 var(--v64-space-4); }
.ai-onboarding--phone .ai-onboarding__bar > .v-btn { margin-inline-start: calc(var(--v64-space-3) * -1); }
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
.ai-onboarding__bar-actions .v-btn:not(.v-btn--icon) { font: var(--v64-type-label-lg); }

/* Stage: content sits at a fixed offset from the top, never floating mid-screen. */
.ai-onboarding__main {
  display: flex;
  flex: 1;
  flex-direction: column;
  overflow-y: auto;
  padding: 0 var(--v64-space-5) var(--v64-space-7);
}
.ai-onboarding__main > section { margin-inline: auto; max-width: 1040px; padding-top: var(--aio-stage-top); width: 100%; }
.ai-onboarding--phone .ai-onboarding__main { padding: 0 var(--v64-space-4) var(--v64-space-6); }
.ai-onboarding--phone .ai-onboarding__main > section { padding-top: var(--v64-space-4); }
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
.ai-onboarding__accent { color: var(--v64-primary); }
.ai-onboarding__lede {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-lg);
  margin: 0 0 var(--v64-space-4);
  max-width: 60ch;
  text-wrap: pretty;
}
.ai-onboarding__footnote { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: var(--v64-space-6) 0 0; }
.ai-onboarding__actions { align-items: center; display: flex; flex-wrap: wrap; gap: var(--v64-space-3); }

/* Why: copy left, the ranked provider stack right */
.ai-onboarding__main > .ai-onboarding__why {
  align-items: center;
  column-gap: var(--v64-space-7);
  display: grid;
  grid-template-columns: 7fr 5fr;
}
.ai-onboarding__why-copy { grid-column: 1; grid-row: 1; }
.ai-onboarding__why .ai-onboarding__headline { font: 600 3rem/3.5rem var(--v64-font-family); letter-spacing: -0.025em; }
.ai-onboarding__why .ai-onboarding__lede { font: 400 1.25rem/1.875rem var(--v64-font-family); }
.ai-onboarding__differences { display: grid; gap: var(--v64-space-3); list-style: none; margin: var(--v64-space-5) 0 var(--v64-space-6); padding: 0; }
.ai-onboarding__differences li { align-items: center; display: flex; font: var(--v64-type-body-lg); gap: var(--v64-space-3); }
.ai-onboarding__difference-icon {
  align-items: center;
  background: var(--v64-primary-container);
  border-radius: var(--v64-shape-full);
  color: var(--v64-on-primary-container);
  display: inline-flex;
  flex: none;
  height: 40px;
  justify-content: center;
  width: 40px;
}
/* Claude is the front, top card; the others peek out behind and below it. */
.aio-hero { --aio-hero-start: 68px; --aio-hero-step: 64px; grid-column: 2; grid-row: 1; height: 420px; position: relative; }
.aio-hero__card {
  align-items: center;
  animation: aio-fan var(--v64-duration-long) var(--v64-ease-emphasized-decelerate) calc((3 - var(--aio-index)) * 70ms) both;
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  box-shadow: var(--v64-elevation-2);
  display: flex;
  gap: var(--v64-space-3);
  height: 72px;
  left: calc(var(--aio-index) * 5%);
  opacity: var(--aio-fade);
  padding: 0 var(--v64-space-4);
  position: absolute;
  top: calc(var(--aio-hero-start) + var(--aio-index) * var(--aio-hero-step));
  transform: rotate(calc(var(--aio-index) * 1.5deg));
  width: calc(100% - var(--aio-index) * 5%);
  z-index: calc(4 - var(--aio-index));
}
.aio-hero__card--crown {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 16%, var(--v64-surface)), var(--v64-surface) 70%);
  border-color: color-mix(in srgb, var(--aio-crown-strong) 45%, var(--v64-outline-variant));
  box-shadow: 0 28px 56px -26px color-mix(in srgb, var(--aio-crown-strong) 75%, transparent), var(--v64-elevation-2);
  height: 104px;
  left: -2%;
  padding: 0 var(--v64-space-5) 0 var(--v64-space-6);
  top: calc(var(--aio-hero-start) - 24px);
  transform: rotate(-2deg) translateY(-4px);
  width: 104%;
}
.aio-hero__identity { display: grid; flex: 1; min-width: 0; }
.aio-hero__name { font: var(--v64-type-title-md); }
.aio-hero__card--crown .aio-hero__name { font: var(--v64-type-title-lg); }
.aio-hero__tagline { color: var(--v64-on-surface-variant); font: var(--aio-type-body-sm); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }

/* Rating meters: five segments, low ratings in the warning tone. */
.aio-meter { display: inline-flex; flex: none; gap: 3px; }
.aio-meter i { border-radius: 3px; box-shadow: inset 0 0 0 1px var(--v64-outline); height: 6px; width: 10px; }
.aio-meter i.is-filled { background: var(--v64-primary); box-shadow: none; }
.aio-meter--low i.is-filled { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, transparent); }

/* Phone dock */
.ai-onboarding__dock {
  background: var(--v64-surface);
  border-top: 1px solid var(--v64-outline-variant);
  display: grid;
  flex: none;
  gap: var(--v64-space-1);
  padding: var(--v64-space-3) var(--v64-space-4) calc(var(--v64-space-3) + env(safe-area-inset-bottom));
}
.ai-onboarding__dock-note { color: var(--v64-on-surface-variant); font: var(--aio-type-body-sm); margin: 0; text-align: center; }

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
@keyframes aio-fan { from { opacity: 0; transform: translateY(32px) rotate(0deg); } }

/* Tablet */
@media (max-width: 959.98px) {
  .ai-onboarding__main > section { max-width: 640px; }
  .ai-onboarding__main { padding: 0 var(--v64-space-5) var(--v64-space-6); }
  .ai-onboarding__headline { font: var(--v64-type-headline-md); }
  .ai-onboarding__main > .ai-onboarding__why { grid-template-columns: minmax(0, 1fr); }
  .ai-onboarding__why-copy { grid-row: 2; }
  .aio-hero { --aio-hero-start: 40px; --aio-hero-step: 56px; grid-column: 1; height: 290px; margin-bottom: var(--v64-space-5); }
}

/* Phone */
@media (max-width: 599.98px) {
  .ai-onboarding__headline { font: var(--v64-type-headline-sm); }
  .ai-onboarding__why .ai-onboarding__headline { font: var(--v64-type-headline-md); }
  .ai-onboarding__why .ai-onboarding__lede { font: var(--v64-type-body-lg); }
  /* Phone hero: the marks alone, Claude's crowned tile in front of Codex and DeepSeek. */
  .aio-hero { display: flex; height: 132px; justify-content: center; margin-bottom: var(--v64-space-4); }
  .aio-hero__card,
  .aio-hero__card--crown { --aio-fade: 1; background: none; border: 0; box-shadow: none; height: auto; left: calc(50% - 32px); padding: 0; top: 46px; width: auto; }
  .aio-hero__card:nth-child(2) { transform: translateX(-62px) rotate(-12deg); }
  .aio-hero__card:nth-child(3) { transform: translateX(62px) rotate(12deg); }
  .aio-hero__card:nth-child(4) { display: none; }
  .aio-hero__card--crown { left: calc(50% - 48px); top: 30px; transform: none; z-index: 5; }
  .aio-hero__identity, .aio-hero__meter { display: none; }
  .ai-onboarding__differences { gap: var(--v64-space-2); margin-block: var(--v64-space-4) 0; }
  .ai-onboarding__differences li { font: var(--v64-type-body-md); }
  .ai-onboarding__difference-icon { height: 32px; width: 32px; }
  .ai-onboarding__difference-icon .v-icon { --v-icon-size-multiplier: 0.8; }
}

.ai-onboarding :deep(.v-btn:focus-visible) {
  outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color);
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .aio-hero__card { animation: none; }
  .ai-onboarding__dots span { transition: none; }
  .aio-forward-enter-from, .aio-forward-leave-to, .aio-back-enter-from, .aio-back-leave-to { transform: none; }
}
</style>
