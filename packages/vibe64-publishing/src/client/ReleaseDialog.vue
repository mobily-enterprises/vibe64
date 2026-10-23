<script setup>
// Release: 1) choose versions and notes, write them into this session and Save;
// 2) review the exact plan for the saved commit with its preflight, then dry
// run or Publish (which opens the person's confirmation).
import { computed, ref, watch } from "vue";
import {
  mdiAccountKeyOutline,
  mdiAlertCircle,
  mdiArrowRight,
  mdiCheckCircle,
  mdiCloseCircle,
  mdiContentSaveOutline,
  mdiInformationOutline,
  mdiLockOutline,
  mdiPencilOutline,
  mdiRefresh,
  mdiRocketLaunchOutline,
  mdiSourceCommit,
  mdiTagOutline,
  mdiTestTube,
  mdiWrenchOutline
} from "@mdi/js";
import { destinationIcon, hostOf, packageLabeller, shortCommit } from "./publishFormat.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  state: { type: Object, default: null },
  dashboardContext: { type: Object, default: () => ({}) },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue", "confirm", "dry-run-started", "accounts"]);

const step = ref(1);
const suggestion = ref(null);
const versions = ref({});
const notes = ref("");
const prepared = ref(null);
const selected = ref([]);
const acknowledged = ref([]);
const plan = ref(null);
const passphrase = ref("");
const busy = ref("");
const error = ref("");

const targets = computed(() => props.state?.targets || []);
const baseline = computed(() => props.state?.baseline || {});
const keys = computed(() => props.state?.keys || {});
const labels = computed(() => Object.fromEntries((props.state?.destinations || []).map((entry) => [entry.id, entry.label])));
const packageLabel = computed(() => packageLabeller(props.state?.packaging?.packages || []));
const sessionId = computed(() => String(props.dashboardContext?.sessionId || ""));
const canSave = computed(() => typeof props.dashboardContext?.requestSaveWork === "function");
const blocked = computed(() => Boolean(plan.value?.preflight?.blocked));
const needsAck = computed(() => (plan.value?.preflight?.checks || []).filter((check) => !check.ok && check.severity === "ack"));
const ready = computed(() => Boolean(plan.value && !blocked.value && needsAck.value.every((check) => acknowledged.value.includes(check.id))));
// What needs attention comes first; passed checks fold into one line.
const showPassed = ref(false);
const passedChecks = computed(() => (plan.value?.preflight?.checks || []).filter((check) => check.ok));
const shownChecks = computed(() => [
  ...(plan.value?.preflight?.checks || []).filter((check) => !check.ok),
  ...(showPassed.value ? passedChecks.value : [])
]);
const checksRunning = computed(() => props.state?.checks?.status === "running");
const checksOutput = computed(() => props.state?.checks?.status === "failed" ? props.state.checks.output || "" : "");
const showOutput = ref(false);

// Step 1: a version nobody has published yet can go out exactly as saved.
const managed = computed(() => (suggestion.value?.packages || []).filter((entry) => !entry.external));
function choicesFor(entry) {
  const saved = entry.current && !entry.released ? [{ kind: "as saved", version: entry.current }] : [];
  return [...saved, ...entry.suggestions.filter((choice) => choice.version !== entry.current)];
}
function liveLine(entry) {
  const live = targets.value.filter((target) => target.package === entry.id && target.latest?.version).map((target) => target.latest.version);
  const saved = `Saved ${entry.current || "without a version"}`;
  return live.length ? `${saved} · live ${[...new Set(live)].join(", ")}` : `${saved} · not published yet`;
}
const changes = computed(() => managed.value.filter((entry) => versions.value[entry.id] && versions.value[entry.id] !== entry.current));
const unreleasedSaved = computed(() => managed.value.some((entry) => entry.current && !entry.released));
const needsWriting = computed(() => changes.value.length > 0 && !prepared.value);
function releaseAsSaved() {
  versions.value = Object.fromEntries(managed.value.map((entry) => [entry.id, entry.current]));
  void review();
}

// Step 2: what pressing Publish will do, in order.
const accountsById = computed(() => Object.fromEntries((props.state?.accounts || []).map((entry) => [entry.id, entry])));
const planSteps = computed(() => {
  if (!plan.value) return [];
  const chosen = targets.value.filter((target) => selected.value.includes(target.id));
  const builds = [...new Set(chosen.map((target) => target.package))];
  const versionOf = (id) => plan.value.packages?.find((entry) => entry.id === id)?.version || shortCommit(plan.value.savedCommit);
  return [
    ...builds.map((id) => ({ id: `build:${id}`, icon: mdiWrenchOutline, text: `Build ${packageLabel.value(id)} ${versionOf(id)} once` })),
    ...(plan.value.tags || []).map((tag) => ({ id: `tag:${tag}`, icon: mdiTagOutline, text: `Tag the saved commit ${tag}` })),
    ...chosen.map((target) => {
      const account = accountsById.value[target.account];
      const where = hostOf(target.settings?.registry || target.settings?.repository || "");
      const signed = target.destination === "android-sideload" ? "signed with your install key" : "";
      return { id: `publish:${target.id}`, icon: destinationIcon(target.destination), text: `${labels.value[target.destination] || target.destination}: ${packageLabel.value(target.package)} ${versionOf(target.package)}`, detail: [account?.label, where, signed].filter(Boolean).join(" · ") };
    })
  ];
});
const blockedHint = computed(() => {
  if (!plan.value) return "";
  if (blocked.value) return "Fix what is marked in red to continue.";
  if (!ready.value) return "Confirm what is marked in amber to continue.";
  return "";
});

watch(() => props.modelValue, async (open) => {
  if (!open) return;
  step.value = 1;
  error.value = "";
  prepared.value = null;
  plan.value = null;
  acknowledged.value = [];
  selected.value = targets.value.map((target) => target.id);
  busy.value = "suggest";
  try {
    suggestion.value = await props.call("/release/suggestion", { method: "GET", refreshAfter: false });
    versions.value = Object.fromEntries(suggestion.value.packages.filter((entry) => !entry.external).map((entry) => [entry.id, choicesFor(entry)[0].version]));
    notes.value = suggestion.value.notes || "";
  } catch (failure) {
    error.value = failure.message;
  } finally {
    busy.value = "";
  }
});

// A new saved commit or finished checks change the plan: read it again.
watch(() => [props.state?.baseline?.commit, props.state?.checks?.status], () => {
  if (props.modelValue && step.value === 2 && busy.value !== "plan") void review();
});

async function run(name, work) {
  busy.value = name;
  error.value = "";
  try {
    return await work();
  } catch (failure) {
    error.value = failure.message;
    return null;
  } finally {
    busy.value = "";
  }
}

const prepare = () => run("prepare", async () => {
  const chosen = Object.fromEntries(changes.value.map((entry) => [entry.id, versions.value[entry.id]]));
  prepared.value = await props.call("/release/prepare", { body: { sessionId: sessionId.value, versions: chosen, notes: notes.value }, refreshAfter: false });
  await props.dashboardContext?.refreshSessionWork?.();
});

async function save() {
  await props.dashboardContext.requestSaveWork();
}

const review = () => run("plan", async () => {
  step.value = 2;
  const answer = await props.call("/plan", { body: { targetIds: selected.value, acknowledged: acknowledged.value }, refreshAfter: false });
  plan.value = answer.plan;
});

const unlock = () => run("unlock", async () => {
  await props.call("/keys/unlock", { body: { passphrase: passphrase.value } });
  passphrase.value = "";
  busy.value = "";
  await review();
});

const runChecks = () => run("checks", () => props.call("/checks"));

const dryRun = () => run("dry-run", async () => {
  const answer = await props.call("/dry-run", { body: { planHash: plan.value.planHash, targetIds: selected.value, acknowledged: acknowledged.value } });
  emit("dry-run-started", answer.releaseId);
  emit("update:modelValue", false);
});

function publish() {
  emit("confirm", { plan: plan.value, targetIds: [...selected.value], acknowledged: [...acknowledged.value] });
}

function checkIcon(check) {
  if (check.ok) return { icon: mdiCheckCircle, color: "success" };
  return check.severity === "block" ? { icon: mdiCloseCircle, color: "error" } : { icon: mdiAlertCircle, color: "warning" };
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="720" scrollable @update:model-value="emit('update:modelValue', $event)">
    <v-card class="publish-release" rounded="xl">
      <v-card-title class="publish-dialog__title">Release</v-card-title>
      <nav class="publish-release__steps" aria-label="Release steps">
        <button :class="{ 'is-current': step === 1 }" type="button" @click="step = 1"><span>1</span> Version</button>
        <span class="publish-release__rule" aria-hidden="true" />
        <button :class="{ 'is-current': step === 2 }" :disabled="!targets.length" type="button" @click="review"><span>2</span> Review &amp; publish</button>
      </nav>

      <v-card-text class="publish-release__body">
        <template v-if="step === 1">
          <v-skeleton-loader v-if="busy === 'suggest'" type="list-item-two-line, list-item-two-line" />
          <template v-else>
            <p class="publish-release__lead">
              Choose the version people get. A new version is written with its changelog into your session for you to Save; releases always use the saved commit.
            </p>
            <div v-for="entry in suggestion?.packages || []" :key="entry.id" class="publish-release__package">
              <div class="publish-release__package-name">
                <strong>{{ entry.label }}</strong>
                <span>{{ liveLine(entry) }}</span>
              </div>
              <span v-if="entry.external" class="publish-release__muted">Set by the project's own build.</span>
              <div v-else class="publish-release__bumps">
                <v-chip-group v-model="versions[entry.id]" color="primary" column mandatory>
                  <v-chip v-for="choice in choicesFor(entry)" :key="choice.kind" :value="choice.version" filter rounded="pill" variant="outlined">
                    {{ choice.version }}<span class="publish-release__kind">{{ choice.kind }}</span>
                  </v-chip>
                </v-chip-group>
              </div>
            </div>
            <p v-if="suggestion && !suggestion.packages.length" class="publish-release__muted">No package has a version Vibe64 manages. Release the saved commit as it is.</p>
            <v-textarea
              v-if="needsWriting || prepared"
              v-model="notes"
              auto-grow
              class="mt-2"
              label="What's new"
              max-rows="10"
              rows="4"
              variant="outlined"
            />
            <div v-if="needsWriting && !sessionId" class="publish-release__note" role="note">
              <v-icon :icon="mdiInformationOutline" size="18" />
              <span v-if="unreleasedSaved">Writing a new version needs a session. Start one with <strong>+</strong> and open Publish from it, or release what is saved as it is.</span>
              <span v-else>The saved version is already published. Writing a new one needs a session: start one with <strong>+</strong> and open Publish from it.</span>
            </div>
            <v-alert v-if="prepared" class="publish-release__prepared" color="success" variant="tonal">
              <strong>Written into this session:</strong>
              {{ prepared.packages.map((entry) => `${entry.id} ${entry.previousVersion || "–"} → ${entry.version}`).join(", ") }}
              <div class="publish-release__muted">{{ prepared.packages.flatMap((entry) => entry.files).join(" · ") }}</div>
            </v-alert>
          </template>
        </template>

        <template v-else>
          <div class="publish-release__baseline">
            <v-icon :icon="mdiSourceCommit" size="18" />
            <span>Saved commit <code>{{ shortCommit(baseline.commit) }}</code> on {{ baseline.branch }}</span>
            <v-chip :color="baseline.pushed ? 'success' : 'warning'" size="x-small" variant="tonal">{{ baseline.pushed ? "pushed" : "not pushed" }}</v-chip>
          </div>

          <h3 class="publish-release__heading">Targets</h3>
          <div class="publish-release__targets">
            <v-checkbox
              v-for="target in targets"
              :key="target.id"
              v-model="selected"
              :value="target.id"
              density="compact"
              hide-details
              @update:model-value="review"
            >
              <template #label>
                <v-icon :icon="destinationIcon(target.destination)" class="mr-2" size="18" />
                {{ labels[target.destination] || target.destination }} · {{ packageLabel(target.package) }}
              </template>
            </v-checkbox>
          </div>

          <div v-if="keys.exists && !keys.unlocked" class="publish-release__unlock">
            <v-text-field
              v-model="passphrase"
              :prepend-inner-icon="mdiLockOutline"
              autocomplete="current-password"
              density="comfortable"
              hide-details
              label="Unlock publishing keys to check sign-ins"
              type="password"
              variant="outlined"
              @keydown.enter="unlock"
            />
            <v-btn :disabled="passphrase.length < 12" :loading="busy === 'unlock'" color="primary" rounded="pill" variant="flat" @click="unlock">Unlock</v-btn>
          </div>

          <h3 class="publish-release__heading">
            Before publishing
            <v-btn :icon="mdiRefresh" :loading="busy === 'plan'" aria-label="Check again" class="ml-auto" size="small" variant="text" @click="review" />
          </h3>
          <v-skeleton-loader v-if="busy === 'plan' && !plan" type="list-item, list-item, list-item" />
          <ul v-else-if="plan" class="publish-release__checks">
            <li v-for="check in shownChecks" :key="check.id" :class="{ 'is-failed': !check.ok && check.severity === 'block', 'is-warning': !check.ok && check.severity !== 'block' }">
              <v-icon v-bind="checkIcon(check)" size="20" />
              <div>
                <strong>{{ check.label }}</strong>
                <span>{{ check.id === "verification-passed" && !check.ok && state?.checks?.failedCommand ? `${state.checks.failedCommand} failed on the saved commit.` : check.message }}</span>
                <button v-if="check.id === 'verification-passed' && checksOutput" class="publish-release__output-toggle" type="button" @click="showOutput = !showOutput">
                  {{ showOutput ? "Hide output" : "Show output" }}
                </button>
                <pre v-if="check.id === 'verification-passed' && showOutput && checksOutput" class="publish-release__output">{{ checksOutput }}</pre>
              </div>
              <v-btn
                v-if="check.id === 'verification-passed' && !check.ok"
                :loading="checksRunning || busy === 'checks'"
                rounded="pill"
                size="small"
                variant="tonal"
                @click="runChecks"
              >
                {{ state?.checks?.status === "failed" ? "Run again" : "Run checks" }}
              </v-btn>
              <v-btn
                v-else-if="check.id === 'credentials-valid' && !check.ok"
                :prepend-icon="mdiAccountKeyOutline"
                rounded="pill"
                size="small"
                variant="tonal"
                @click="emit('accounts')"
              >
                Fix sign-in
              </v-btn>
              <v-checkbox
                v-else-if="!check.ok && check.severity === 'ack'"
                v-model="acknowledged"
                :value="check.id"
                density="compact"
                hide-details
                label="I understand"
              />
            </li>
            <li v-if="passedChecks.length" class="publish-release__passed">
              <button type="button" @click="showPassed = !showPassed">
                <v-icon :icon="mdiCheckCircle" color="success" size="20" />
                <span v-if="passedChecks.length === (plan.preflight?.checks || []).length">All {{ passedChecks.length }} checks passed<em>{{ showPassed ? "Hide" : "Show" }}</em></span>
                <span v-else>{{ showPassed ? "Hide" : "Show" }} {{ passedChecks.length }} passed {{ passedChecks.length === 1 ? "check" : "checks" }}</span>
              </button>
            </li>
          </ul>
          <template v-if="plan && planSteps.length">
            <h3 class="publish-release__heading">
              What happens
              <span class="publish-release__plan-id" title="Every release follows exactly this reviewed plan">Plan {{ plan.planId }}</span>
            </h3>
            <ol class="publish-release__plan">
              <li v-for="entry in planSteps" :key="entry.id">
                <v-icon :icon="entry.icon" size="18" />
                <span>{{ entry.text }}<em v-if="entry.detail">{{ entry.detail }}</em></span>
              </li>
            </ol>
          </template>
        </template>
        <v-alert v-if="error" class="mt-4" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>

      <v-card-actions class="publish-dialog__actions">
        <template v-if="step === 1">
          <v-btn rounded="pill" variant="text" @click="emit('update:modelValue', false)">Cancel</v-btn>
          <v-spacer />
          <template v-if="needsWriting">
            <v-btn v-if="!sessionId && unreleasedSaved" rounded="pill" variant="tonal" @click="releaseAsSaved">Release as saved</v-btn>
            <v-btn
              :disabled="!sessionId"
              :loading="busy === 'prepare'"
              :prepend-icon="mdiPencilOutline"
              color="primary"
              rounded="pill"
              variant="flat"
              @click="prepare"
            >
              Write {{ changes.length === 1 ? versions[changes[0].id] : "versions" }}
            </v-btn>
          </template>
          <template v-else>
            <v-btn v-if="prepared && canSave" :prepend-icon="mdiContentSaveOutline" rounded="pill" variant="tonal" @click="save">Save</v-btn>
            <v-btn :append-icon="mdiArrowRight" color="primary" data-test="release-continue" rounded="pill" variant="flat" @click="review">Continue</v-btn>
          </template>
        </template>
        <template v-else>
          <v-btn rounded="pill" variant="text" @click="emit('update:modelValue', false)">Close</v-btn>
          <v-spacer />
          <span v-if="blockedHint" class="publish-release__blocked">{{ blockedHint }}</span>
          <v-btn :disabled="!ready" :loading="busy === 'dry-run'" :prepend-icon="mdiTestTube" rounded="pill" variant="tonal" @click="dryRun">Dry run</v-btn>
          <v-btn :disabled="!ready" :prepend-icon="mdiRocketLaunchOutline" color="primary" rounded="pill" variant="flat" @click="publish">Publish…</v-btn>
        </template>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-release__steps {
  align-items: center;
  display: flex;
  gap: 8px;
  padding: 0 24px 8px;
}

.publish-release__steps button {
  align-items: center;
  background: transparent;
  border: 0;
  border-radius: 999px;
  color: var(--v64-on-surface-variant);
  display: inline-flex;
  font: var(--v64-type-label-lg);
  gap: 8px;
  padding: 4px 10px 4px 4px;
  white-space: nowrap;
}

.publish-release__steps button span {
  align-items: center;
  background: var(--v64-surface-container-high);
  border-radius: 50%;
  display: inline-flex;
  height: 24px;
  justify-content: center;
  width: 24px;
}

.publish-release__steps button.is-current {
  background: var(--v64-secondary-container);
  color: var(--v64-on-secondary-container);
}

.publish-release__steps button.is-current span {
  background: rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-on-primary));
}

.publish-release__rule {
  background: var(--v64-outline-variant);
  flex: 0 1 48px;
  height: 1px;
  min-width: 12px;
}

.publish-release__body {
  display: grid;
  gap: 12px;
  padding: 12px 24px !important;
}

.publish-release__lead,
.publish-release__muted {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
}

.publish-release__bumps {
  min-width: 0;
}

.publish-release__package {
  align-items: center;
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  display: flex;
  flex-wrap: wrap;
  gap: 8px 16px;
  justify-content: space-between;
  padding: 10px 14px;
}

.publish-release__package-name {
  display: grid;
}

.publish-release__package-name strong {
  font: var(--v64-type-title-md);
}

.publish-release__package-name span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-release__kind {
  font-size: 0.6875rem;
  letter-spacing: 0.04em;
  margin-left: 6px;
  opacity: 0.7;
  text-transform: uppercase;
}

.publish-release__baseline {
  align-items: center;
  background: var(--v64-surface-container-low);
  border-radius: var(--v64-shape-md, 12px);
  display: flex;
  flex-wrap: wrap;
  font: var(--v64-type-body-md);
  gap: 8px;
  padding: 10px 14px;
}

.publish-release__heading {
  align-items: center;
  display: flex;
  font: var(--v64-type-title-md);
  gap: 8px;
  margin: 8px 0 0;
}

.publish-release__plan-id {
  color: var(--v64-on-surface-variant);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

.publish-release__targets {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(min(100%, 240px), 1fr));
}

.publish-release__unlock {
  align-items: center;
  display: flex;
  gap: 12px;
}

.publish-release__checks {
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  list-style: none;
  margin: 0;
  padding: 0;
}

.publish-release__checks li {
  align-items: center;
  display: grid;
  gap: 12px;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  padding: 10px 14px;
}

.publish-release__checks li + li {
  border-top: 1px solid var(--v64-outline-variant);
}

.publish-release__checks strong {
  display: block;
  font: var(--v64-type-label-lg);
}

.publish-release__checks span {
  color: var(--v64-on-surface-variant);
  display: block;
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-release__passed {
  display: block !important;
  padding: 0 !important;
}

.publish-release__passed button {
  align-items: center;
  background: transparent;
  border: 0;
  color: var(--v64-on-surface-variant);
  cursor: pointer;
  display: flex;
  font: var(--v64-type-label-lg);
  gap: 12px;
  padding: 10px 14px;
  text-align: left;
  width: 100%;
}

.publish-release__passed button span {
  color: inherit !important;
  font: inherit !important;
}

.publish-release__passed button em {
  color: rgb(var(--v-theme-primary));
  font-style: normal;
  margin-left: auto;
}

.publish-release__passed button > span {
  display: flex !important;
  flex: 1 1 auto;
}

.publish-release__checks li.is-warning {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 7%, transparent);
}

.publish-release__checks li.is-failed {
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 5%, transparent);
}

.publish-release__plan {
  counter-reset: plan;
  display: grid;
  gap: 2px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.publish-release__plan li {
  align-items: center;
  border-radius: var(--v64-shape-sm, 8px);
  display: grid;
  font: var(--v64-type-body-md);
  gap: 10px;
  grid-template-columns: 18px minmax(0, 1fr);
  padding: 6px 4px;
}

.publish-release__plan li .v-icon {
  color: var(--v64-on-surface-variant);
}

.publish-release__plan em {
  color: var(--v64-on-surface-variant);
  font-size: 0.8125rem;
  font-style: normal;
  margin-left: 8px;
}

.publish-release__note {
  align-items: flex-start;
  background: var(--v64-surface-container-low);
  border-radius: var(--v64-shape-md, 12px);
  color: var(--v64-on-surface-variant);
  display: flex;
  font: var(--v64-type-body-md);
  gap: 10px;
  padding: 10px 14px;
}

.publish-release__note .v-icon {
  color: rgb(var(--v-theme-info));
  flex: 0 0 auto;
  margin-top: 1px;
}

.publish-release__blocked {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
  margin-right: 4px;
}

.publish-release__output-toggle {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font: var(--v64-type-label-lg);
  margin-top: 4px;
  padding: 0;
}

.publish-release__output {
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-sm, 8px);
  font-size: 0.75rem;
  margin-top: 6px;
  max-height: 12rem;
  overflow: auto;
  padding: 8px 10px;
  white-space: pre-wrap;
}

@media (max-width: 600px) {
  .publish-release__unlock {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
