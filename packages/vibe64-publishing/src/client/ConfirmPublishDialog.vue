<script setup>
// The only place publishing is confirmed: the person sees exactly what goes
// where, unlocks their keys if needed, and presses Publish. Chat can ask for
// this dialog but cannot press it.
import { computed, ref, watch } from "vue";
import { mdiLockOutline, mdiRocketLaunchOutline, mdiSourceCommit, mdiTagOutline } from "@mdi/js";
import { destinationAccent, destinationIcon, packageLabeller, shortCommit } from "./publishFormat.js";

const props = defineProps({
  modelValue: { type: Boolean, default: false },
  plan: { type: Object, default: null },
  targetIds: { type: Array, default: () => [] },
  acknowledged: { type: Array, default: () => [] },
  state: { type: Object, default: null },
  requestedBy: { type: String, default: "" },
  call: { type: Function, required: true }
});
const emit = defineEmits(["update:modelValue", "started", "plan-changed"]);

const passphrase = ref("");
const working = ref(false);
const error = ref("");

const locked = computed(() => !props.state?.keys?.unlocked);
const needsKeys = computed(() => Boolean(props.state?.keys?.exists));
const labels = computed(() => Object.fromEntries((props.state?.destinations || []).map((entry) => [entry.id, entry.label])));
const packageLabel = computed(() => packageLabeller(props.state?.packaging?.packages || []));
const versionOf = (packageId) => props.plan?.packages?.find((entry) => entry.id === packageId)?.version || shortCommit(props.plan?.savedCommit);
const count = computed(() => props.plan?.targets?.length || 0);

watch(() => props.modelValue, (open) => {
  if (open) {
    passphrase.value = "";
    error.value = "";
  }
});

async function publish() {
  if (!props.plan || working.value) return;
  working.value = true;
  error.value = "";
  try {
    if (needsKeys.value && locked.value) {
      await props.call("/keys/unlock", { body: { passphrase: passphrase.value }, refreshAfter: false });
      passphrase.value = "";
    }
    const body = { planHash: props.plan.planHash, targetIds: props.targetIds, acknowledged: props.acknowledged };
    const { token } = await props.call("/confirmation", { body, refreshAfter: false });
    const started = await props.call("/releases", { body: { ...body, token } });
    emit("started", started.releaseId);
    emit("update:modelValue", false);
  } catch (failure) {
    error.value = failure.message;
    if (failure.code === "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED") emit("plan-changed");
  } finally {
    working.value = false;
  }
}
</script>

<template>
  <v-dialog :model-value="modelValue" max-width="560" persistent @update:model-value="emit('update:modelValue', $event)">
    <v-card v-if="plan" class="publish-confirm" rounded="xl">
      <div class="publish-confirm__hero">
        <span class="publish-confirm__badge"><v-icon :icon="mdiRocketLaunchOutline" size="28" /></span>
        <h2>Publish to {{ count }} {{ count === 1 ? "place" : "places" }}?</h2>
        <p v-if="requestedBy === 'assistant'">Your Colleague asked for this release. Nothing goes out until you press Publish.</p>
        <p v-else>People will be able to install these versions. Published versions cannot be taken back.</p>
      </div>
      <v-card-text class="publish-confirm__body">
        <div class="publish-confirm__meta">
          <span><v-icon :icon="mdiSourceCommit" size="16" /> {{ shortCommit(plan.savedCommit) }}</span>
          <span v-for="tag in plan.tags" :key="tag"><v-icon :icon="mdiTagOutline" size="16" /> {{ tag }}</span>
          <span class="publish-confirm__plan">Plan {{ plan.planId }}</span>
        </div>
        <ul class="publish-confirm__targets">
          <li v-for="target in plan.targets" :key="target.id" :class="`is-${destinationAccent(target.destination)}`">
            <v-icon :icon="destinationIcon(target.destination)" size="20" />
            <span class="publish-confirm__where">
              <strong>{{ labels[target.destination] || target.destination }}</strong>
              <span>{{ packageLabel(target.package) }}<template v-if="target.channel"> · {{ target.channel }}</template></span>
            </span>
            <span class="publish-confirm__version">{{ versionOf(target.package) }}</span>
          </li>
        </ul>
        <v-text-field
          v-if="needsKeys && locked"
          v-model="passphrase"
          :prepend-inner-icon="mdiLockOutline"
          autocomplete="current-password"
          class="mt-4"
          hide-details="auto"
          hint="Your keys stay unlocked for 15 minutes."
          label="Publishing keys passphrase"
          persistent-hint
          type="password"
          variant="outlined"
          @keydown.enter="publish"
        />
        <v-alert v-if="error" class="mt-4" type="error" variant="tonal">{{ error }}</v-alert>
      </v-card-text>
      <v-card-actions class="publish-dialog__actions">
        <v-spacer />
        <v-btn :disabled="working" rounded="pill" variant="text" @click="emit('update:modelValue', false)">Not now</v-btn>
        <v-btn
          :disabled="needsKeys && locked && passphrase.length < 12"
          :loading="working"
          :prepend-icon="mdiRocketLaunchOutline"
          color="primary"
          data-test="confirm-publish"
          rounded="pill"
          size="large"
          variant="flat"
          @click="publish"
        >
          Publish
        </v-btn>
      </v-card-actions>
    </v-card>
  </v-dialog>
</template>

<style scoped>
.publish-confirm__hero {
  background:
    radial-gradient(120% 140% at 50% 0%, color-mix(in srgb, rgb(var(--v-theme-primary)) 16%, transparent), transparent 70%),
    var(--v64-surface-container-low);
  border-bottom: 1px solid var(--v64-outline-variant);
  display: grid;
  justify-items: center;
  padding: 28px 24px 20px;
  text-align: center;
}

.publish-confirm__badge {
  align-items: center;
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  box-shadow: 0 8px 24px color-mix(in srgb, rgb(var(--v-theme-primary)) 35%, transparent);
  color: rgb(var(--v-theme-on-primary));
  display: inline-flex;
  height: 56px;
  justify-content: center;
  margin-bottom: 12px;
  width: 56px;
}

.publish-confirm__hero h2 {
  font: var(--v64-type-headline-sm);
  margin: 0 0 6px;
}

.publish-confirm__hero p {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
  max-width: 26rem;
}

.publish-confirm__body {
  padding: 20px 24px 8px !important;
}

.publish-confirm__meta {
  align-items: center;
  color: var(--v64-on-surface-variant);
  display: flex;
  flex-wrap: wrap;
  font: var(--v64-type-label-lg);
  gap: 6px 16px;
  margin-bottom: 12px;
}

.publish-confirm__meta span {
  align-items: center;
  display: inline-flex;
  gap: 4px;
}

.publish-confirm__plan {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  margin-left: auto;
}

.publish-confirm__targets {
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  list-style: none;
  margin: 0;
  overflow: hidden;
  padding: 0;
}

.publish-confirm__targets li {
  --accent: rgb(var(--v-theme-primary));
  align-items: center;
  display: grid;
  gap: 12px;
  grid-template-columns: 20px minmax(0, 1fr) auto;
  padding: 12px 16px;
}

.publish-confirm__targets li + li {
  border-top: 1px solid var(--v64-outline-variant);
}

.publish-confirm__targets li.is-success { --accent: rgb(var(--v-theme-success)); }
.publish-confirm__targets li.is-error { --accent: rgb(var(--v-theme-error)); }
.publish-confirm__targets li.is-info { --accent: rgb(var(--v-theme-info)); }

.publish-confirm__targets .v-icon {
  color: var(--accent);
}

.publish-confirm__where {
  display: grid;
  min-width: 0;
}

.publish-confirm__where strong {
  font: var(--v64-type-label-lg);
}

.publish-confirm__where span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-confirm__version {
  font: var(--v64-type-title-md);
  font-variant-numeric: tabular-nums;
}
</style>
