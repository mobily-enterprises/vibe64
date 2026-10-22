<script setup>
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { mdiClose, mdiLockOutline, mdiOpenInNew } from "@mdi/js";
import AiConnectionRow from "./AiConnectionRow.vue";
import AiOnboardingMark from "../onboarding/AiOnboardingMark.vue";
import { aiOnboardingRows } from "../onboarding/useAiOnboarding.js";
import { injectAiConnectionManager } from "../composables/useAiConnectionManager.js";

// One provider's connections, from its card's Manage: each orchestrator it is
// connected through, with sign-in or key changes, routing, model access and
// removal. A full-screen sheet on phones.
const props = defineProps({
  modelValue: Boolean,
  card: { type: Object, default: null }
});
const emit = defineEmits(["update:modelValue", "connect"]);
const { xs } = useDisplay();
const { busy, configuredAiRows } = injectAiConnectionManager();
const ENGINES = { claude: "Claude Code", codex: "Codex", opencode: "OpenCode" };
const ORDER = ["claude", "codex", "opencode"];
const activator = ref(null);

const byEngine = (rows) => [...rows].sort((a, b) => ORDER.indexOf(a.engineId) - ORDER.indexOf(b.engineId));
const rows = computed(() => props.card ? byEngine(aiOnboardingRows(props.card, configuredAiRows.value)) : []);
const freeRows = computed(() => props.card?.free ? byEngine(aiOnboardingRows(props.card.free, configuredAiRows.value)) : []);
const allRows = computed(() => [...rows.value, ...freeRows.value]);
const working = (row) => row.kind === "opencode" ? row.connected !== false : row.connected === true;
const billingUrl = computed(() => allRows.value.find((row) => row.managementUrl)?.managementUrl || "");
const summary = computed(() => {
  const engines = [...new Set(allRows.value.filter(working).map((row) => ENGINES[row.engineId]))];
  const broken = allRows.value.filter((row) => !working(row)).length;
  const through = engines.length ? `Connected through ${engines.join(" and ")}` : "";
  const attention = broken ? `${broken} ${broken === 1 ? "connection needs" : "connections need"} reconnecting` : "";
  return [through, attention].filter(Boolean).join(" · ") || "Nothing connected";
});

// Focus returns to the Manage button that opened the sheet.
watch(() => props.modelValue, (open) => {
  if (open) activator.value = document.activeElement;
});

function close() {
  if (!busy.value) emit("update:modelValue", false);
}

function connectAgain() {
  emit("update:modelValue", false);
  emit("connect", props.card);
}
</script>

<template>
  <v-dialog
    :model-value="modelValue" :activator="activator" :open-on-click="false" :fullscreen="xs" max-width="44rem" scrollable
    :persistent="busy" :transition="xs ? 'dialog-bottom-transition' : 'dialog-transition'"
    @update:model-value="!$event && close()"
  >
    <v-card v-if="card" class="ai-manage" :class="[`ai-manage--${card.tone}`, { 'ai-manage--phone': xs }]" :rounded="xs ? 0 : 'xl'">
      <header class="ai-manage__header">
        <AiOnboardingMark :provider="card" :size="xs ? 44 : 52" />
        <div class="ai-manage__heading">
          <p class="ai-manage__eyebrow">Manage</p>
          <h2 class="ai-manage__title">{{ card.name }}</h2>
          <p class="ai-manage__summary">{{ summary }}</p>
        </div>
        <v-btn :icon="mdiClose" variant="text" :aria-label="`Close ${card.name} settings`" :disabled="busy" @click="close" />
        <v-btn
          v-if="billingUrl" class="ai-manage__billing" :href="billingUrl" target="_blank" rel="noopener noreferrer"
          :append-icon="mdiOpenInNew" variant="text" color="primary" size="small"
        >
          Billing &amp; usage<span class="d-sr-only"> (opens in a new tab)</span>
        </v-btn>
      </header>

      <v-card-text class="ai-manage__body">
        <section v-if="rows.length" class="ai-manage__group" :aria-label="`${card.name} connections`">
          <AiConnectionRow v-for="row in rows" :key="`${row.kind}:${row.engineId}:${row.id}`" :account="row" />
        </section>
        <section v-if="freeRows.length" class="ai-manage__group" aria-labelledby="ai-manage-free">
          <h3 id="ai-manage-free" class="ai-manage__group-title">
            Free option<span>{{ card.free.name }}</span>
          </h3>
          <AiConnectionRow v-for="row in freeRows" :key="`${row.kind}:${row.engineId}:${row.id}`" :account="row" />
        </section>
        <div v-if="!allRows.length" class="ai-manage__empty">
          <p>{{ card.name }} isn't connected any more.</p>
          <v-btn color="primary" variant="flat" @click="connectAgain">Connect {{ card.name }}</v-btn>
        </div>
        <p class="ai-manage__note">
          <v-icon :icon="mdiLockOutline" size="18" aria-hidden="true" />
          <span>Provider keys are redacted after saving. Sign-ins and keys can be managed only by the Vibe64 owner.</span>
        </p>
      </v-card-text>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.ai-manage {
  --aio-crown: #f5c518;
  --aio-crown-strong: #8a6a00;
  background: var(--v64-surface-container-lowest, var(--v64-surface));
  color: var(--v64-on-surface);
  font-family: var(--v64-font-family);
  letter-spacing: normal;
}
.v-theme--dark .ai-manage { --aio-crown-strong: #f5c518; }
.ai-manage :deep(.v-btn:not(.v-btn--icon)) { border-radius: var(--v64-shape-md); letter-spacing: 0; text-transform: none; }
.ai-manage :deep(.v-btn:focus-visible) { outline: var(--v64-focus-ring-width) solid var(--v64-focus-ring-color); outline-offset: var(--v64-focus-ring-offset); }

/* The header carries the provider's tone, like its card. */
.ai-manage__header {
  align-items: center;
  background: radial-gradient(520px 200px at 90% -40%, var(--v64-primary-container), transparent 75%), var(--v64-surface);
  border-bottom: 1px solid var(--v64-outline-variant);
  display: grid;
  flex: none;
  gap: var(--v64-space-2) var(--v64-space-4);
  grid-template-columns: auto minmax(0, 1fr) auto;
  padding: var(--v64-space-6) var(--v64-space-4) var(--v64-space-4) var(--v64-space-6);
}
.ai-manage--primary .ai-manage__header {
  background: linear-gradient(160deg, color-mix(in srgb, var(--aio-crown) 14%, var(--v64-surface)), var(--v64-surface) 60%);
}
.ai-manage__heading { min-width: 0; }
.ai-manage__eyebrow { color: var(--v64-primary); font: var(--v64-type-label-md); letter-spacing: 0.12em; margin: 0; text-transform: uppercase; }
.ai-manage--primary .ai-manage__eyebrow { color: var(--aio-crown-strong); }
.ai-manage__title { font: var(--v64-type-headline-sm); letter-spacing: -0.01em; margin: 0; }
.ai-manage__summary { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); margin: 2px 0 0; }
.ai-manage__header > .v-btn--icon { align-self: start; margin-top: calc(var(--v64-space-3) * -1); }
.ai-manage__billing { grid-column: 2 / 4; justify-self: start; margin-inline-start: calc(var(--v64-space-2) * -1); }

.ai-manage__body { align-content: start; display: grid; gap: var(--v64-space-5); letter-spacing: normal; padding: var(--v64-space-5) var(--v64-space-6) var(--v64-space-6) !important; }
.ai-manage__group { display: grid; gap: var(--v64-space-3); }
.ai-manage__group-title {
  align-items: baseline;
  color: var(--v64-on-surface-variant);
  display: flex;
  flex-wrap: wrap;
  font: var(--v64-type-label-md);
  gap: var(--v64-space-2);
  letter-spacing: 0.06em;
  margin: 0;
  text-transform: uppercase;
}
.ai-manage__group-title span { color: var(--v64-on-surface); font: var(--v64-type-title-md); letter-spacing: 0; text-transform: none; }
.ai-manage__empty {
  align-items: center;
  background: var(--v64-surface-container-low);
  border: 1px dashed var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg);
  display: grid;
  gap: var(--v64-space-3);
  justify-items: center;
  padding: var(--v64-space-6) var(--v64-space-4);
  text-align: center;
}
.ai-manage__empty p { font: var(--v64-type-body-lg); margin: 0; }
.ai-manage__note {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  font: var(--v64-type-body-md);
  gap: var(--v64-space-2);
  margin: 0;
}
.ai-manage__note .v-icon { flex: none; }

.ai-manage--phone .ai-manage__header {
  padding: calc(var(--v64-space-4) + env(safe-area-inset-top)) var(--v64-space-2) var(--v64-space-3) var(--v64-space-4);
}
.ai-manage--phone .ai-manage__header > .v-btn--icon { margin-top: calc(var(--v64-space-2) * -1); }
.ai-manage--phone .ai-manage__body { padding: var(--v64-space-4) var(--v64-space-4) calc(var(--v64-space-6) + env(safe-area-inset-bottom)) !important; }
</style>
