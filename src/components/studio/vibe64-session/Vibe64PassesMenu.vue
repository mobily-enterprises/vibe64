<template>
  <component
    :is="mobile ? VBottomSheet : VMenu"
    v-model="opened"
    :close-on-content-click="false"
    :content-props="{ role: 'dialog', 'aria-label': 'Passes' }"
    location="top start"
    max-width="420"
    @update:model-value="onOpenChange"
  >
    <template #activator="{ props: activatorProps }">
      <v-btn
        v-bind="activatorProps"
        aria-haspopup="dialog"
        aria-label="Passes"
        class="vibe64-passes__trigger"
        icon="$checklist"
        size="small"
        title="Passes: improve your app"
        variant="text"
      />
    </template>
    <v-card class="vibe64-passes" rounded="lg" @keydown.esc.stop.prevent="opened = false">
      <v-card-item class="vibe64-passes__header">
        <v-card-title class="text-title-medium">Passes</v-card-title>
        <v-card-subtitle class="vibe64-passes__subtitle">Improve your app, one pass at a time.</v-card-subtitle>
        <template #append>
          <v-btn aria-label="Close passes" icon="$close" size="small" variant="text" @click="opened = false" />
        </template>
      </v-card-item>
      <v-card-text class="vibe64-passes__body">
        <p v-if="blockedReason" class="text-body-small vibe64-passes__note" role="status">{{ blockedReason }}</p>
        <p v-if="afterPlanShown" class="text-body-small vibe64-passes__note">{{ AFTER_PLAN_NOTE }}</p>
        <p v-if="afterPlanShown && afterPlanStatus" class="text-body-small vibe64-passes__note" role="status">{{ afterPlanStatus }}</p>
        <v-alert v-if="afterPlanError" class="mb-2" density="compact" type="error" variant="tonal">{{ afterPlanError }}</v-alert>
        <v-alert v-if="passes.unavailable.value" class="mb-2" density="compact" type="warning" variant="tonal">{{ passes.unavailable.value }}</v-alert>
        <v-alert v-if="passes.error.value" class="mb-2" density="compact" type="error" variant="tonal">{{ passes.error.value }}</v-alert>
        <v-alert v-if="passes.loadError.value && !list.length" density="compact" type="error" variant="tonal">
          {{ passes.loadError.value }}
          <v-btn size="small" variant="text" @click="passes.reload()">Retry</v-btn>
        </v-alert>
        <v-skeleton-loader v-else-if="!list.length" type="list-item-three-line@3" />
        <ul v-else class="vibe64-passes__list">
          <li v-for="pass in list" :key="pass.id" class="vibe64-passes__row">
            <div class="vibe64-passes__text">
              <div class="text-title-small">{{ pass.title }}</div>
              <div class="text-body-small vibe64-passes__muted">{{ pass.description }}</div>
              <div class="text-label-small vibe64-passes__muted">{{ lastRunLabel(pass) }}</div>
              <div v-if="pass.unavailable && !passes.unavailable.value" class="text-body-small vibe64-passes__muted">{{ pass.unavailable }}</div>
            </div>
            <div v-if="pass.runs.length" class="vibe64-passes__runs">
              <v-btn
                v-for="passRun in pass.runs"
                :key="passRun.id"
                :aria-label="`Run ${pass.title}: ${passRun.label}`"
                class="vibe64-passes__run"
                color="primary"
                :disabled="Boolean(blockedReason) || Boolean(passes.starting.value)"
                :loading="passes.starting.value === runKey(pass, passRun)"
                size="small"
                variant="tonal"
                @click="start(pass, passRun)"
              >
                {{ passRun.label }}
              </v-btn>
            </div>
            <p v-if="pass.runs.some(({ id }) => id === 'deep')" class="text-body-small vibe64-passes__muted">{{ DEEP_NOTE }}</p>
            <div v-if="afterPlanShown && AFTER_PLAN_PASS_ORDER.includes(pass.id)" class="vibe64-passes__after-plan">
              <v-checkbox
                :aria-label="`${pass.title}: After a plan`"
                class="vibe64-passes__tick"
                density="compact"
                :disabled="mandatory(pass.id) || !afterPlanChangeable"
                hide-details
                label="After a plan"
                :model-value="afterPlan.includes(pass.id)"
                @update:model-value="tickAfterPlan(pass.id, $event)"
              />
              <v-checkbox
                v-if="pass.sinceBase?.deep"
                :aria-label="`${pass.title}: Deeply after a plan`"
                class="vibe64-passes__tick"
                density="compact"
                :disabled="!afterPlan.includes(pass.id) || !afterPlanChangeable"
                hide-details
                label="Deeply"
                :model-value="afterPlanDeep.includes(pass.id)"
                @update:model-value="tickDeep(pass.id, $event)"
              />
              <span v-if="mandatory(pass.id)" class="text-body-small vibe64-passes__muted">Always runs after a plan.</span>
            </div>
          </li>
          <li v-if="master" class="vibe64-passes__row">
            <div class="vibe64-passes__text">
              <div class="text-title-small">{{ master.title }}</div>
              <div class="text-body-small vibe64-passes__muted">{{ master.description }}</div>
              <div class="text-label-small vibe64-passes__muted">{{ lastRunLabel(master) }}</div>
              <div v-if="master.unavailable && !passes.unavailable.value" class="text-body-small vibe64-passes__muted">{{ master.unavailable }}</div>
            </div>
            <template v-if="master.runs.length">
              <fieldset class="vibe64-passes__ticks">
                <legend class="text-label-small vibe64-passes__muted">Passes to run, in this order</legend>
                <v-checkbox
                  v-for="id in master.passes"
                  :key="id"
                  v-model="ticked"
                  class="vibe64-passes__tick"
                  density="compact"
                  hide-details
                  :label="titleOf(id)"
                  :value="id"
                />
              </fieldset>
              <div class="vibe64-passes__runs">
                <v-btn
                  v-for="masterRun in master.runs"
                  :key="masterRun.id"
                  :aria-label="`Run ${master.title}: ${masterRun.label}`"
                  class="vibe64-passes__run"
                  color="primary"
                  :disabled="Boolean(blockedReason) || Boolean(passes.starting.value) || !ticked.length"
                  :loading="passes.starting.value === runKey(master, masterRun)"
                  size="small"
                  variant="tonal"
                  @click="startMaster(masterRun)"
                >
                  {{ masterRun.label }}
                </v-btn>
              </div>
              <p class="text-body-small vibe64-passes__muted">{{ MASTER_NOTE }}</p>
            </template>
          </li>
        </ul>
      </v-card-text>
    </v-card>
  </component>
</template>

<script setup>
// The chat's Passes list: each pass Genesis offers, when it last completed in this project, and a
// button for each run Genesis offers for it, or why the project's Genesis cannot run it; then the
// Master pass, with a tick box for each pass it runs, all ticked until the person unticks one.
// Main chat's own list also holds its After a plan and Deeply ticks: the passes that run, each in
// its own turn, once a plan is completed, saved with the chat's settings.
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { VBottomSheet, VMenu } from "vuetify/components";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { AFTER_PLAN_MANDATORY_PASSES, AFTER_PLAN_PASS_ORDER, ASSISTANT_FINISHING_DEFAULTS, inAfterPlanOrder } from "@local/vibe64-runtime/shared/assistantFinishing";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { runKey } from "@/composables/useVibe64Passes.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const runDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
// A deep run reads every file, and a Master pass runs pass after pass that way: say what that costs.
const DEEP_NOTE = "Deep reads every file: it takes much longer and uses far more of your AI's allowance.";
const MASTER_NOTE = "Runs each ticked pass deeply, one after another: it takes much longer and uses far more of your AI's allowance.";
const AFTER_PLAN_NOTE = "After a plan: when a plan is completed, each ticked pass checks the plan's changes in its own turn, " +
  "in Master pass order, then Automatically save changes runs if it is on. Nothing runs after a request without a plan.";

const props = defineProps({
  passes: { type: /** @type {import("vue").PropType<import("@/types.js").Vibe64Passes>} */ (Object), required: true },
  // Why Run is unavailable now, such as a running turn; empty while it can start.
  blockedReason: { type: String, default: "" },
  // Main chat's session, whose After a plan ticks this list shows; none for any other chat.
  session: { type: Object, default: null },
  sessionsApiPath: { type: [String, Object, Function], default: "" },
  // Why the After a plan ticks can't change now, such as an unfinished goal; empty while they can.
  afterPlanReason: { type: String, default: "" }
});
const { xs: mobile } = useDisplay();
const opened = ref(false);
const list = computed(() => props.passes.passes.value);
const master = computed(() => props.passes.master.value);

// The chat's saved choice; a chat with no mode yet runs the defaults, and a lesson or Fix it with
// AI runs no pass after a plan, so shows no tick.
const preferences = computed(() => {
  try {
    return assistantRoutingFromMetadata(props.session?.metadata || {});
  } catch {
    return null;
  }
});
const afterPlanShown = computed(() => Boolean(props.session) && props.session.purpose !== "learning" && preferences.value?.mode !== "fix");
const afterPlan = ref(/** @type {string[]} */ ([]));
const afterPlanDeep = ref(/** @type {string[]} */ ([]));
const afterPlanSaving = ref(false);
const afterPlanError = ref("");
watch(preferences, (value) => {
  afterPlan.value = [...(value?.afterPlan || ASSISTANT_FINISHING_DEFAULTS.afterPlan)];
  afterPlanDeep.value = [...(value?.afterPlanDeep || ASSISTANT_FINISHING_DEFAULTS.afterPlanDeep)];
}, { immediate: true });
const afterPlanChangeable = computed(() => Boolean(preferences.value) && !props.afterPlanReason && !afterPlanSaving.value);
const afterPlanStatus = computed(() => props.afterPlanReason ||
  (preferences.value ? "" : "Choose a Chat mode to change these; until then the ticked passes run after a plan."));
/** @param {string} id */
const mandatory = (id) => AFTER_PLAN_MANDATORY_PASSES.includes(id);
const afterPlanCommand = useCommand({
  access: "never", apiSuffix: VIBE64_SESSIONS_API_SUFFIX, placementSource: "vibe64.sessions.assistant-selection.update",
  buildCommandOptions: () => ({
    method: "PATCH",
    path: vibe64SessionPath(readRefOrGetterValue(props.sessionsApiPath), props.session.sessionId, "/assistant-selection")
  }),
  // The chat's mode and model stay as saved; Automatically save changes is kept by the server.
  buildRawPayload: () => vibe64RealtimeOriginPayload({ assistantRouting: {
    mode: preferences.value.mode,
    afterPlan: afterPlan.value,
    afterPlanDeep: afterPlanDeep.value,
    ...(preferences.value.override ? { override: preferences.value.override } : {})
  } }),
  onRunSuccess: (result) => { if (result?.ok === false) throw new Error(result.error || "After a plan could not be saved."); },
  fallbackRunError: "After a plan could not be saved.", suppressSuccessMessage: true,
  ownershipFilter: ROUTE_VISIBILITY_PUBLIC, surfaceId: VIBE64_SURFACE_ID, writeMethod: "PATCH"
});

/**
 * Saves the ticks, in Master pass order; a failed save puts them back.
 * @param {string[]} nextAfterPlan
 * @param {string[]} nextDeep
 */
async function saveAfterPlan(nextAfterPlan, nextDeep) {
  if (!afterPlanChangeable.value) return;
  const previous = { afterPlan: afterPlan.value, afterPlanDeep: afterPlanDeep.value };
  afterPlan.value = inAfterPlanOrder(nextAfterPlan);
  afterPlanDeep.value = inAfterPlanOrder(nextDeep.filter((id) => afterPlan.value.includes(id)));
  afterPlanSaving.value = true;
  afterPlanError.value = "";
  try {
    await afterPlanCommand.run();
  } catch (error) {
    afterPlan.value = previous.afterPlan;
    afterPlanDeep.value = previous.afterPlanDeep;
    afterPlanError.value = error?.message || "After a plan could not be saved.";
  } finally {
    afterPlanSaving.value = false;
  }
}
/** @param {string} id @param {boolean | null} ticked */
function tickAfterPlan(id, ticked) {
  if (mandatory(id)) return;
  void saveAfterPlan(ticked ? [...afterPlan.value, id] : afterPlan.value.filter((other) => other !== id), afterPlanDeep.value);
}
/** @param {string} id @param {boolean | null} ticked */
function tickDeep(id, ticked) {
  void saveAfterPlan(afterPlan.value, ticked ? [...afterPlanDeep.value, id] : afterPlanDeep.value.filter((other) => other !== id));
}
// The passes the Master pass runs: all of them until the person unticks one, again whenever the list changes.
const ticked = ref(/** @type {string[]} */ ([]));
watch(() => master.value?.passes.join(",") || "", () => {
  ticked.value = [...(master.value?.passes || [])];
}, { immediate: true });

/** @param {string} id */
const titleOf = (id) => list.value.find((pass) => pass.id === id)?.title || id;

/** @param {import("@/composables/useVibe64Passes.js").Vibe64Pass} pass */
function lastRunLabel(pass) {
  if (!pass.lastRun) return "Never completed";
  const since = pass.commitsSince === null ? "" : ` · ${pass.commitsSince} ${pass.commitsSince === 1 ? "commit" : "commits"} since`;
  return `Last completed: ${runDate.format(new Date(pass.lastRun))}${since}`;
}

function onOpenChange(value) {
  if (value) void props.passes.reload();
}

async function start(pass, passRun) {
  if (await props.passes.run(pass, passRun)) opened.value = false;
}

async function startMaster(masterRun) {
  if (await props.passes.runMaster(masterRun, ticked.value)) opened.value = false;
}
</script>

<style scoped>
.vibe64-passes__trigger {
  flex-shrink: 0;
}

.vibe64-passes__header {
  padding-bottom: 0;
}

.vibe64-passes__subtitle {
  white-space: normal;
}

.vibe64-passes__body {
  max-height: min(60vh, 32rem);
  overflow-y: auto;
  padding-top: 0.5rem;
}

.vibe64-passes__note {
  margin-bottom: 0.5rem;
}

.vibe64-passes__list {
  display: flex;
  flex-direction: column;
  list-style: none;
  margin: 0;
  padding: 0;
}

.vibe64-passes__row {
  border-top: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  flex-direction: column;
  gap: 0.5rem;
  padding: 0.625rem 0;
}

.vibe64-passes__row:first-child {
  border-top: 0;
}

.vibe64-passes__text {
  display: flex;
  flex-direction: column;
  gap: 0.125rem;
  min-width: 0;
}

.vibe64-passes__ticks {
  border: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.75rem;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.vibe64-passes__ticks legend {
  margin-bottom: 0.125rem;
  padding: 0;
  width: 100%;
}

.vibe64-passes__after-plan {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.75rem;
}

.vibe64-passes__tick {
  flex: 0 1 auto;
}

.vibe64-passes__runs {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

/* A run's label is Genesis's, so a long one wraps instead of widening the list. */
.vibe64-passes__run {
  height: auto;
  max-width: 100%;
  min-height: var(--v-btn-height);
}

.vibe64-passes__run :deep(.v-btn__content) {
  white-space: normal;
}

.vibe64-passes__muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
