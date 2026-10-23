<script setup>
// The frame every target card shares: where it goes, what it publishes, the
// last version people can get, and the destination's own facts and actions.
import { computed } from "vue";
import { mdiDotsVertical, mdiTrashCanOutline, mdiAccountKeyOutline } from "@mdi/js";
import { destinationAccent, destinationIcon, proofLine, relativeTime } from "../publishFormat.js";

const props = defineProps({
  target: { type: Object, required: true },
  destination: { type: Object, default: null },
  packageInfo: { type: Object, default: null },
  accounts: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false }
});
const emit = defineEmits(["remove", "change-account"]);

const accent = computed(() => destinationAccent(props.target.destination));
const latest = computed(() => props.target.latest || null);
const account = computed(() => props.accounts.find((entry) => entry.id === props.target.account) || null);
const proof = computed(() => latest.value ? proofLine({ checksum: latest.value.checksum, ...latest.value.proof }) : "");
const accountChoices = computed(() => props.accounts.filter((entry) => entry.kind === props.destination?.accountKind));
</script>

<template>
  <article class="publish-target" :class="`publish-target--${accent}`" :data-target="target.id">
    <header class="publish-target__head">
      <span class="publish-target__icon" aria-hidden="true">
        <v-icon :icon="destinationIcon(target.destination)" size="22" />
      </span>
      <div class="publish-target__title">
        <h3>{{ destination?.label || target.destination }}</h3>
        <p>{{ packageInfo?.label || target.package }}<template v-if="account"> · {{ account.label }}</template></p>
      </div>
      <v-menu location="bottom end">
        <template #activator="{ props: menu }">
          <v-btn v-bind="menu" :aria-label="`More for ${target.id}`" :disabled="busy" :icon="mdiDotsVertical" size="small" variant="text" />
        </template>
        <v-list density="compact" min-width="220">
          <v-list-item
            v-for="choice in accountChoices"
            :key="choice.id"
            :active="choice.id === target.account"
            :prepend-icon="mdiAccountKeyOutline"
            :title="`Use ${choice.label}`"
            @click="emit('change-account', choice.id)"
          />
          <v-list-item :prepend-icon="mdiTrashCanOutline" base-color="error" title="Remove target" @click="emit('remove')" />
        </v-list>
      </v-menu>
    </header>

    <div class="publish-target__version">
      <template v-if="latest">
        <strong>{{ latest.version }}</strong>
        <span>published {{ relativeTime(latest.at) }}</span>
      </template>
      <template v-else>
        <strong class="publish-target__none">Not published yet</strong>
        <span>{{ destination?.firstTime }}</span>
      </template>
    </div>

    <dl class="publish-target__facts">
      <slot name="facts" />
      <div v-if="proof">
        <dt>Proof</dt>
        <dd class="publish-target__mono" :title="proof">{{ proof }}</dd>
      </div>
    </dl>

    <slot name="setup" />

    <footer v-if="$slots.actions" class="publish-target__actions">
      <slot name="actions" />
    </footer>
  </article>
</template>

<style scoped>
.publish-target {
  --accent: rgb(var(--v-theme-primary));
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  display: grid;
  gap: var(--v64-space-3, 12px);
  grid-template-rows: auto auto 1fr auto;
  min-width: 0;
  overflow: hidden;
  padding: var(--v64-space-4, 16px);
  position: relative;
  transition: border-color var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease),
    box-shadow var(--v64-duration-short, 150ms) var(--v64-ease-standard, ease);
}

.publish-target::before {
  background: linear-gradient(90deg, var(--accent), color-mix(in srgb, var(--accent) 20%, transparent));
  content: "";
  height: 3px;
  inset: 0 0 auto;
  opacity: 0.85;
  position: absolute;
}

.publish-target:hover {
  border-color: color-mix(in srgb, var(--accent) 40%, var(--v64-outline-variant));
  box-shadow: var(--v64-elevation-1);
}

.publish-target--success { --accent: rgb(var(--v-theme-success)); }
.publish-target--error { --accent: rgb(var(--v-theme-error)); }
.publish-target--info { --accent: rgb(var(--v-theme-info)); }

.publish-target__head {
  align-items: center;
  display: flex;
  gap: var(--v64-space-3, 12px);
  min-width: 0;
}

.publish-target__icon {
  align-items: center;
  background: color-mix(in srgb, var(--accent) 14%, var(--v64-surface));
  border-radius: var(--v64-shape-md, 12px);
  color: var(--accent);
  display: inline-flex;
  flex: 0 0 auto;
  height: 40px;
  justify-content: center;
  width: 40px;
}

.publish-target__title {
  flex: 1 1 auto;
  min-width: 0;
}

.publish-target__title h3 {
  font: var(--v64-type-title-md);
  letter-spacing: 0;
  margin: 0;
}

.publish-target__title p,
.publish-target__version span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-target__version {
  display: grid;
  gap: 2px;
}

.publish-target__version strong {
  font: var(--v64-type-headline-sm);
  font-variant-numeric: tabular-nums;
  letter-spacing: -0.01em;
}

.publish-target__version strong.publish-target__none {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-title-md);
}

.publish-target__facts {
  align-content: start;
  display: grid;
  gap: 6px;
  margin: 0;
}

.publish-target__facts :deep(> div) {
  align-items: baseline;
  display: grid;
  gap: var(--v64-space-2, 8px);
  grid-template-columns: 6.5rem minmax(0, 1fr);
}

.publish-target__facts :deep(dt) {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-label-md);
}

.publish-target__facts :deep(dd) {
  font: var(--v64-type-body-md);
  margin: 0;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-target__mono,
.publish-target__facts :deep(.publish-target__mono) {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.8125rem;
}

.publish-target__actions {
  display: flex;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
}
</style>
