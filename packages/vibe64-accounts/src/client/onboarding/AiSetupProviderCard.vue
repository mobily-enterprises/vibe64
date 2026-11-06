<script setup>
import { useDisplay } from "vuetify";
import ToolInstallRow from "/src/components/studio/ToolInstallRow.vue";
import AiOnboardingMark from "./AiOnboardingMark.vue";
import { injectAiSetupCards } from "./useAiSetupCards.js";

// One provider card of the AI setup's overview: its rank, facts and plan, what
// it offers next, the AI tool it needs here, and its free option. Its actions
// go to the setup as connect (card, sign-up step), make-main and manage.
defineProps({
  card: { type: Object, required: true },
  // Its place in the list: the cards rise in one after another.
  index: { type: Number, required: true },
  // The setup is checking a provider.
  verifying: Boolean,
  // The current connections are still being read.
  loading: Boolean
});
// Slot connection-access ({ card, place }): the host's note on who may use the
// card's connection, on its Connected badge ("badge") and below its name ("card").
const emit = defineEmits(["connect", "make-main", "manage"]);
const { xs } = useDisplay();

const RATINGS = ["", "poor", "limited", "good", "very good", "excellent"];
// Rank order follows how much each provider is worth: the button weight drops with it.
const CTA_VARIANT = ["flat", "tonal", "outlined", "outlined"];
// The crown settles once the cards have risen in.
const CROWN_SETTLE_MS = 420;

const {
  cardAction, cardClass, cardNote, cardRows, cardTool, checkingTools, checkTools, collapsible, connectedLabel, expanded, installFirst,
  installOpen, neededTool, toggleExpanded, toggleInstall, toolReady
} = injectAiSetupCards();

/** A rating meter's spoken label, such as "Speed: very good". */
function meterLabel([aspect, rating]) {
  return `${aspect[0].toUpperCase()}${aspect.slice(1)}: ${RATINGS[rating]}`;
}
</script>

<template>
  <article
    class="aio-card" :class="cardClass(card)"
    :style="{ '--aio-index': index }" :aria-labelledby="`aio-card-${card.id}`"
  >
    <span v-if="card.crown" class="aio-card__ribbon">Recommended</span>
    <span v-if="card.connected" class="aio-card__connected">
      <v-icon icon="$checkCircleFilled" size="16" aria-hidden="true" />{{ connectedLabel(card) }}<slot name="connection-access" :card="card" place="badge" />
    </span>
    <span v-else-if="cardAction(card) === 'reconnect'" class="aio-card__connected aio-card__connected--warn">
      <v-icon icon="$error" size="16" aria-hidden="true" />Reconnect required
    </span>
    <component
      :is="collapsible(card) ? 'button' : 'div'" class="aio-card__head"
      :type="collapsible(card) ? 'button' : undefined"
      :aria-expanded="collapsible(card) ? String(expanded(card)) : undefined"
      @click="toggleExpanded(card)"
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
      <v-icon v-if="collapsible(card)" icon="$expand" class="aio-card__chevron" aria-hidden="true" />
    </component>
    <slot v-if="card.connected" name="connection-access" :card="card" place="card" />
    <template v-if="expanded(card)">
      <div class="aio-card__facts">
        <v-skeleton-loader v-if="loading" type="chip" width="120" height="24" />
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
          <v-icon icon="$info" size="18" aria-hidden="true" />{{ cardNote(card) }}
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
            :disabled="verifying" :aria-label="`Use ${card.name} as my main AI`" @click="emit('make-main', card)"
          >
            {{ card.crown ? `Use ${card.name} as my main AI` : "Use as main AI" }}
          </v-btn>
          <v-btn
            v-else-if="cardAction(card) === 'checking'" variant="tonal" size="large" loading disabled
            aria-label="Checking which AI is your main AI"
          />
          <v-btn
            v-else-if="cardAction(card) === 'reconnect'" color="warning" variant="flat" size="large"
            :disabled="verifying" @click="emit('connect', card, 'have')"
          >
            Reconnect {{ card.name }}
          </v-btn>
          <template v-else-if="cardAction(card) === 'get' && installFirst(card)">
            <v-btn
              color="primary" :variant="CTA_VARIANT[card.rank - 1]" size="large" :aria-expanded="String(installOpen === card.id)"
              :aria-controls="`aio-install-${card.id}`" @click="toggleInstall(card)"
            >
              Install {{ installFirst(card).name }} first
            </v-btn>
            <v-btn
              variant="text" color="primary" class="aio-card__link" :href="card.signUp.url" target="_blank" rel="noopener noreferrer"
              append-icon="$openInNew" @click="emit('connect', card, 'opened')"
            >
              Get {{ card.name }}<span class="d-sr-only"> (opens in a new tab)</span>
            </v-btn>
            <v-btn variant="text" color="primary" class="aio-card__link" @click="emit('connect', card, 'have')">{{ card.have }}</v-btn>
          </template>
          <template v-else-if="cardAction(card) === 'get'">
            <v-btn
              color="primary" :variant="CTA_VARIANT[card.rank - 1]" size="large"
              :href="card.signUp.url" target="_blank" rel="noopener noreferrer" append-icon="$openInNew"
              @click="emit('connect', card, 'opened')"
            >
              Get {{ card.name }}<span class="d-sr-only"> (opens in a new tab)</span>
            </v-btn>
            <v-btn variant="text" color="primary" class="aio-card__link" @click="emit('connect', card, 'have')">{{ card.have }}</v-btn>
          </template>
          <v-btn
            v-if="cardRows(card).length" variant="text" color="primary" class="aio-card__link" prepend-icon="$tune"
            :aria-label="`Manage ${card.name}`" @click="emit('manage', card)"
          >
            Manage
          </v-btn>
        </div>
        <p v-if="toolReady(card)" class="aio-card__needs aio-card__needs--ready" :title="cardTool(card).path">
          <v-icon icon="$checkCircleFilled" size="18" aria-hidden="true" />Ready on this computer
        </p>
        <p v-else-if="neededTool(card) && !installFirst(card)" class="aio-card__needs">
          <v-icon icon="$laptop" size="18" aria-hidden="true" />Needs {{ neededTool(card).label }} on this computer
        </p>
        <ToolInstallRow
          v-if="installOpen === card.id && cardTool(card)" :id="`aio-install-${card.id}`" class="aio-card__install"
          :tool="cardTool(card)" :checking="checkingTools" @check="checkTools"
        />
        <div v-if="card.free" class="aio-card__free">
          <p class="aio-card__free-label">
            <strong>{{ card.free.label }}</strong>
            <span>{{ card.free.connected ? "Connected." : card.free.detail }}</span>
            <span v-if="toolReady(card.free)" class="aio-card__needs aio-card__needs--ready" :title="cardTool(card.free).path">
              <v-icon icon="$checkCircleFilled" size="18" aria-hidden="true" />Ready on this computer
            </span>
            <span v-else-if="neededTool(card.free) && !installFirst(card.free)" class="aio-card__needs">
              <v-icon icon="$laptop" size="18" aria-hidden="true" />Needs {{ neededTool(card.free).label }} on this computer
            </span>
          </p>
          <v-btn
            v-if="installFirst(card.free)" variant="outlined" color="primary" :aria-expanded="String(installOpen === card.free.id)"
            :aria-controls="`aio-install-${card.free.id}`" @click="toggleInstall(card.free)"
          >
            Install {{ installFirst(card.free).name }} first
          </v-btn>
          <v-btn
            v-if="!card.free.connected" :variant="installFirst(card.free) ? 'text' : 'outlined'" color="primary" :href="card.free.signUp.url" target="_blank"
            rel="noopener noreferrer" append-icon="$openInNew" @click="emit('connect', card.free, 'opened')"
          >
            Start free<span class="d-sr-only"> (opens Z.AI in a new tab)</span>
          </v-btn>
          <v-btn v-if="!card.free.connected" variant="text" color="primary" class="aio-card__link" @click="emit('connect', card.free, 'have')">
            {{ card.free.have }}
          </v-btn>
          <v-btn
            v-else-if="cardAction(card.free) === 'main'" variant="text" color="primary" :disabled="verifying"
            @click="emit('make-main', card.free)"
          >
            Use the free option as my main AI
          </v-btn>
          <v-btn
            v-if="cardRows(card.free).length && !cardRows(card).length" variant="text" color="primary" class="aio-card__link"
            prepend-icon="$tune" :aria-label="`Manage ${card.free.name}`" @click="emit('manage', card)"
          >
            Manage
          </v-btn>
          <ToolInstallRow
            v-if="installOpen === card.free.id && cardTool(card.free)" :id="`aio-install-${card.free.id}`" class="aio-card__install"
            :tool="cardTool(card.free)" :checking="checkingTools" @check="checkTools"
          />
        </div>
      </div>
    </template>
  </article>
</template>

<style scoped>
/* Rating meters: five segments, low ratings in the warning tone. */
.aio-meter { display: inline-flex; flex: none; gap: 3px; }
.aio-meter i { border-radius: 3px; box-shadow: inset 0 0 0 1px rgb(var(--v-theme-outline)); height: 6px; width: 10px; }
.aio-meter i.is-filled { background: rgb(var(--v-theme-primary)); box-shadow: none; }
.aio-meter--low i.is-filled { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, transparent); }

/* One card per provider. On desktop each card is one row: Claude's offer sits
   beside its facts; the others run head, facts, plan, actions. */
.aio-card {
  animation: aio-rise var(--v64-duration-medium) var(--v64-ease-emphasized-decelerate) both;
  animation-delay: calc(var(--aio-index) * 40ms);
  background: rgb(var(--v-theme-surface-container-low));
  border: 1px solid rgb(var(--v-theme-outline-variant));
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
  .ai-setup--pointer .aio-card:hover { border-color: rgb(var(--v-theme-outline)); box-shadow: var(--v64-elevation-1); }
}
.aio-card--featured {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 10%, rgb(var(--v-theme-surface))), rgb(var(--v-theme-surface)) 55%);
  border-radius: var(--v64-shape-xl);
  box-shadow: 0 24px 48px -30px color-mix(in srgb, var(--aio-crown-strong) 60%, transparent), var(--v64-elevation-1);
  padding: var(--v64-space-5) var(--v64-space-6) var(--v64-space-4);
}
@media (hover: hover) {
  .ai-setup--pointer .aio-card--featured:hover { box-shadow: 0 28px 56px -30px color-mix(in srgb, var(--aio-crown-strong) 70%, transparent), var(--v64-elevation-2); }
}
.v-theme--dark .aio-card--featured {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 14%, rgb(var(--v-theme-surface))), rgb(var(--v-theme-surface)) 60%);
  border-color: color-mix(in srgb, var(--aio-crown) 35%, rgb(var(--v-theme-outline-variant)));
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
  .aio-card--installing:not(.aio-card--featured) {
    grid-template-areas: "head facts plan ctas" "head note plan ctas" "install install install install" "free free free free";
    grid-template-rows: auto 1fr auto auto;
  }
  .aio-card:not(.aio-card--featured) .aio-card__install { grid-area: install; margin-top: var(--v64-space-2); }
}
.aio-card--connected { border: 2px solid rgb(var(--v-theme-success)); }
.aio-card--reconnect { border: 2px solid color-mix(in srgb, rgb(var(--v-theme-warning)) 70%, transparent); }
/* Badges straddle the top border, so they never compete with the name for width. */
.aio-card__ribbon,
.aio-card__connected {
  align-items: center;
  border-radius: var(--v64-shape-full);
  box-shadow: 0 0 0 3px rgb(var(--v-theme-surface));
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: var(--v64-space-1);
  letter-spacing: 0.02em;
  padding: 3px 12px;
  position: absolute;
  top: -14px;
}
.aio-card__ribbon { background: var(--aio-crown); color: var(--aio-crown-ink); right: var(--v64-space-6); }
.aio-card__connected { background: rgb(var(--v-theme-success-container)); color: var(--v64-on-success-container); left: var(--v64-space-5); }
.aio-card__connected--warn { background: color-mix(in srgb, rgb(var(--v-theme-warning)) 22%, rgb(var(--v-theme-surface))); color: var(--aio-warn-ink); }
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
  background: rgb(var(--v-theme-surface-container-highest));
  border-radius: var(--v64-shape-full);
  color: rgb(var(--v-theme-on-surface));
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
.aio-card__tagline { color: rgb(var(--v-theme-on-surface-variant)); font: var(--v64-type-body-md); }
.aio-card__chevron { transition: transform var(--v64-duration-short) var(--v64-ease-standard); }
.aio-card__head[aria-expanded="true"] .aio-card__chevron { transform: rotate(180deg); }
.aio-card__facts { align-content: start; display: grid; gap: var(--v64-space-3); }
.aio-card__bullets { display: grid; gap: var(--v64-space-2); list-style: none; margin: 0; padding: 0; }
.aio-card__bullets li { align-items: center; display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-3); }
.aio-card--featured .aio-card__bullets li { font: var(--v64-type-body-lg); }
.aio-card__why { font: var(--v64-type-body-lg); margin: 0; }
.aio-card__free { align-items: center; border-top: 1px solid rgb(var(--v-theme-outline-variant)); display: flex; flex-wrap: wrap;
  gap: var(--v64-space-2); margin-top: var(--v64-space-3); padding-top: var(--v64-space-3); }
.aio-card__free-label { display: grid; flex: 1 1 16rem; font: var(--v64-type-body-md); gap: 2px; margin: 0; }
.aio-card__free-label span { color: rgb(var(--v-theme-on-surface-variant)); }
.aio-card__note { color: rgb(var(--v-theme-on-surface-variant)); display: flex; font: var(--v64-type-body-md); gap: var(--v64-space-2); margin: 0; }
.aio-card__note .v-icon { flex: none; margin-top: 1px; }
.aio-card__offer { display: grid; gap: var(--v64-space-3); }
.aio-card__needs {
  align-items: center;
  color: rgb(var(--v-theme-on-surface-variant));
  display: flex;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-2);
  justify-content: center;
  margin: 0;
}
.aio-card__free .aio-card__needs { justify-content: flex-start; margin-top: var(--v64-space-1); }
.aio-card__needs--ready .v-icon { color: rgb(var(--v-theme-success)); }
.aio-card__free .aio-card__install { flex: 1 1 100%; }
/* A card whose tool is missing is greyed until it is installed; its actions and install row keep their colour. */
.aio-card--needs-tool,
.aio-card--needs-tool.aio-card--featured { background: rgb(var(--v-theme-surface-container-low)); border-color: rgb(var(--v-theme-outline-variant)); box-shadow: none; }
.ai-setup .aio-card--needs-tool:hover { box-shadow: none; }
.aio-card--needs-tool :is(.aio-card__head, .aio-card__facts, .aio-card__note-row, .aio-plan, .aio-card__ribbon) { filter: grayscale(1); opacity: 0.7; }
.aio-card--needs-tool .aio-plan { border-left-color: rgb(var(--v-theme-outline-variant)); }
.aio-card__note-row:empty { display: none; }
.aio-card__facts :deep(.v-skeleton-loader) { background: transparent; }

/* The plan: official name and price first, the budget advice beneath. */
.aio-plan {
  align-content: start;
  background: rgb(var(--v-theme-surface-container));
  border-radius: var(--v64-shape-md);
  display: grid;
  gap: 2px;
  padding: var(--v64-space-3) var(--v64-space-4);
}
.aio-card--featured .aio-plan { border-left: 3px solid var(--aio-crown); padding: var(--v64-space-3) var(--v64-space-5); }
.aio-plan__name { font: var(--v64-type-label-lg); }
.aio-plan__price { font: var(--v64-type-title-lg); font-variant-numeric: tabular-nums; letter-spacing: -0.01em; }
.aio-card--featured .aio-plan__price { font: 600 2rem/2.5rem var(--v64-font-family); letter-spacing: -0.02em; }
.aio-plan__budget { color: rgb(var(--v-theme-on-surface-variant)); font: var(--v64-type-body-md); }
.aio-plan__more { border-top: 1px solid rgb(var(--v-theme-outline-variant)); font: var(--v64-type-label-lg); margin-top: var(--v64-space-2); padding-top: var(--v64-space-2); }
.aio-card__ctas { display: grid; gap: var(--v64-space-1); }
.aio-card__ctas .aio-card__link { font: var(--v64-type-label-lg); }

@keyframes aio-rise { from { opacity: 0; transform: translateY(8px); } }

/* Phone */
@media (max-width: 599.98px) {
  .aio-card, .aio-card--featured { padding: var(--v64-space-4); }
  .aio-card--collapsed { gap: 0; justify-content: center; min-height: 72px; }
  .aio-card__head[type="button"] { cursor: pointer; min-height: 48px; }
  .aio-card__ribbon { right: var(--v64-space-4); }
  .aio-card__connected { left: var(--v64-space-4); }
  .aio-card--featured .aio-card__name { font: var(--v64-type-headline-sm); }
  .aio-card--featured .aio-plan__price { font: var(--v64-type-headline-sm); }
}

.aio-card__head:focus-visible { border-radius: var(--v64-shape-sm); }
.aio-card__head:focus-visible {
  outline: var(--v64-focus-ring-width) solid rgb(var(--v-theme-primary));
  outline-offset: var(--v64-focus-ring-offset);
}

@media (prefers-reduced-motion: reduce) {
  .aio-card { animation: none; }
  .aio-card, .aio-card__chevron { transition: none; }
}
</style>
