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
        <section v-if="plansPasses && plan" class="vibe64-passes__plan" aria-labelledby="vibe64-passes-plan-title">
          <div id="vibe64-passes-plan-title" class="text-title-small">This plan's passes</div>
          <p class="text-body-small" role="status">{{ planLine }}</p>
          <p v-if="!plan.atPasses" class="text-body-small vibe64-passes__muted">{{ PLAN_PENDING_NOTE }}</p>
          <div v-else class="vibe64-passes__runs">
            <v-btn
              v-if="!planDone"
              class="vibe64-passes__run"
              color="primary"
              :disabled="Boolean(blockedReason) || Boolean(passes.starting.value)"
              :loading="passes.starting.value === 'plan:continue:'"
              size="small"
              variant="flat"
              @click="act('continue')"
            >
              {{ continueLabel }}
            </v-btn>
            <v-btn
              class="vibe64-passes__run"
              :disabled="Boolean(blockedReason) || Boolean(passes.starting.value)"
              :loading="passes.starting.value === 'plan:restart:'"
              size="small"
              variant="tonal"
              @click="act('restart')"
            >
              Restart from the first pass
            </v-btn>
          </div>
          <ul v-if="plan.atPasses && donePasses.length" class="vibe64-passes__again">
            <li v-for="pass in donePasses" :key="pass.item">
              <v-btn
                :aria-label="`Run ${pass.title} again`"
                :disabled="Boolean(blockedReason) || Boolean(passes.starting.value) || !pass.id"
                :loading="passes.starting.value === `plan:again:${pass.id}`"
                size="small"
                variant="text"
                @click="act('again', pass)"
              >
                Run {{ pass.title }} again
              </v-btn>
            </li>
          </ul>
        </section>
        <p v-if="plansPasses && list.length" class="text-body-small vibe64-passes__note">{{ plan ? RUN_IN_PLAN_NOTE : RUN_NOTE }}</p>
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
              <span v-if="mandatory(pass.id)" class="text-body-small vibe64-passes__muted">Always in a new plan's Passes.</span>
            </div>
          </li>
          <li v-if="plansPasses && runnable.length > 1" class="vibe64-passes__row">
            <div class="vibe64-passes__text">
              <div class="text-title-small">Several passes</div>
              <div class="text-body-small vibe64-passes__muted">{{ SERIES_NOTE }}</div>
            </div>
            <fieldset class="vibe64-passes__ticks">
              <legend class="text-label-small vibe64-passes__muted">Passes to run, in this order</legend>
              <v-checkbox
                v-for="id in runnable"
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
                v-for="seriesRun in seriesRuns"
                :key="seriesRun.id"
                :aria-label="`Run the ticked passes: ${seriesRun.label}`"
                class="vibe64-passes__run"
                color="primary"
                :disabled="Boolean(blockedReason) || Boolean(passes.starting.value) || !ticked.length"
                :loading="passes.starting.value === `series:${seriesRun.id}`"
                size="small"
                variant="tonal"
                @click="startSeries(seriesRun.id)"
              >
                {{ seriesRun.label }}
              </v-btn>
            </div>
            <p v-if="seriesRuns.some(({ id }) => id === 'deep')" class="text-body-small vibe64-passes__muted">{{ DEEP_NOTE }}</p>
          </li>
        </ul>
      </v-card-text>
    </v-card>
  </component>
</template>

<script setup>
// The chat's Passes list: the open plan's passes with their states and Continue, Run this pass again
// and Restart from the first pass; each pass Genesis offers, when it last completed in this project,
// and a button for each run Genesis offers for it, or why the Genesis serving the project cannot run
// it; then Several passes, with a tick box for each pass and one run for all of them (Whole app,
// Since last completed, Deep), offered when every ticked pass offers it. In a chat whose plans run
// passes, each run joins the open plan's Passes, or a plan of its own; a lesson or Fix it with AI
// runs a pass as its own turn, and has no plan's passes or Several passes. Main chat's own list also holds its After a plan and Deeply
// ticks: the passes each new plan's Passes section starts with, saved with the chat's settings.
import { computed, ref, watch } from "vue";
import { useDisplay } from "vuetify";
import { VBottomSheet, VMenu } from "vuetify/components";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { AFTER_PLAN_MANDATORY_PASSES, AFTER_PLAN_PASS_ORDER, ASSISTANT_FINISHING_DEFAULTS, inAfterPlanOrder } from "@local/vibe64-runtime/shared/assistantFinishing";
import { assistantRoutingFromMetadata } from "@local/vibe64-runtime/shared/assistantRouting";
import { chatRunsPlanPasses, planContinueLabel, runKey } from "@/composables/useVibe64Passes.js";
import { vibe64RealtimeOriginPayload } from "@/lib/vibe64BrowserTabOrigin.js";
import { vibe64SessionPath, VIBE64_SESSIONS_API_SUFFIX, VIBE64_SURFACE_ID } from "@/lib/vibe64SessionRequestConfig.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const runDate = new Intl.DateTimeFormat(undefined, { dateStyle: "medium" });
// A deep run reads every file: say what that costs.
const DEEP_NOTE = "Deep reads every file: it takes much longer and uses far more of your AI's allowance.";
const SERIES_NOTE = "Tick passes and choose one run for all of them. They join the plan's Passes and run one after another, each in its own turn.";
const AFTER_PLAN_NOTE = "After a plan: each new plan's Passes section starts with the ticked passes, which check the plan's changes: " +
  "Review in Senior's review of the plan, the others each in its own turn after it. To change one plan's passes, change that plan.";
const RUN_NOTE = "A run starts a small plan of its own with that pass, which runs at once.";
const RUN_IN_PLAN_NOTE = "A run joins this plan's Passes.";
// Senior's review of the plan runs the plan's Review in the same turn while it is the plan's next pass.
const PLAN_PENDING_NOTE = "These run once Senior has reviewed the plan; a Review at the top runs within that review.";
const STATE_WORDS = Object.freeze({ done: " ✓", running: ": running", "needs-you": ": needs you", paused: ": paused", blocked: ": can't run", waiting: ": waiting" });
// The runs several passes can share, in the order the list offers them.
const SERIES_RUNS = Object.freeze([
  { id: "whole", label: "Whole app" },
  { id: "since-last", label: "Since last completed" },
  { id: "deep", label: "Deep" }
]);

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
const plan = computed(() => props.passes.plan.value);
// "Review ✓ · Security pass ✓ · Data pass: needs you · Quality pass"
const planLine = computed(() => plan.value?.passes.map((pass) => pass.title + (STATE_WORDS[pass.state] || "")).join(" · ") || "");
const planDone = computed(() => Boolean(plan.value?.passes.every((pass) => pass.done)));
const donePasses = computed(() => plan.value?.passes.filter((pass) => pass.done) || []);
const continueLabel = computed(() => planContinueLabel(props.passes.planProgress.value.left));

// The chat's saved choice; a chat with no mode yet runs the defaults, and a lesson or Fix it with
// AI runs no pass after a plan, so shows no tick.
const preferences = computed(() => {
  try {
    return assistantRoutingFromMetadata(props.session?.metadata || {});
  } catch {
    return null;
  }
});
// Only a chat whose plans run passes shows After a plan, the plan's passes and Several passes: a lesson or
// Fix it with AI runs each pass as its own turn.
const afterPlanShown = computed(() => Boolean(props.session) && props.session.purpose !== "learning" && preferences.value?.mode !== "fix");
// A chat with no mode yet sends each message as it is, so its passes run as their own turns too.
const plansPasses = computed(() => chatRunsPlanPasses(props.session));
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
// The passes Several passes can run, in Genesis's order: none until the person ticks them.
const runnable = computed(() => props.passes.order.value.filter((id) => list.value.some((pass) => pass.id === id && pass.runs.length)));
const ticked = ref(/** @type {string[]} */ ([]));
watch(() => runnable.value.join(","), () => {
  ticked.value = ticked.value.filter((id) => runnable.value.includes(id));
});
// Whole app always; Since last completed and Deep when every ticked pass offers them.
const seriesRuns = computed(() => SERIES_RUNS.filter(({ id }) => id === "whole" ||
  ticked.value.every((ticks) => list.value.find((pass) => pass.id === ticks)?.runs.some((passRun) => passRun.id === id))));

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

async function startSeries(runId) {
  if (await props.passes.runSeries(ticked.value, runId)) opened.value = false;
}

/** @param {"continue" | "again" | "restart"} action @param {{ id: string, title: string }} [pass] */
async function act(action, pass) {
  if (await props.passes.planAction(action, pass)) opened.value = false;
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

.vibe64-passes__plan {
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  display: flex;
  flex-direction: column;
  gap: 0.375rem;
  margin-bottom: 0.5rem;
  padding-bottom: 0.625rem;
}

.vibe64-passes__again {
  display: flex;
  flex-wrap: wrap;
  gap: 0 0.25rem;
  list-style: none;
  margin: 0;
  padding: 0;
}

.vibe64-passes__muted {
  color: rgb(var(--v-theme-on-surface-variant));
}
</style>
