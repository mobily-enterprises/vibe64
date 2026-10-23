<script setup>
// The frame every target card shares: where it goes, what it publishes, the
// version people can get now (verified by reading it back), what is happening
// to it, and the destination's own facts and actions.
import { computed } from "vue";
import { mdiAlertCircleOutline, mdiCheckDecagram, mdiDotsVertical, mdiOpenInNew, mdiTrashCanOutline, mdiAccountKeyOutline } from "@mdi/js";
import { destinationAccent, destinationIcon, proofLine, publicPageUrl, relativeTime } from "../publishFormat.js";

const props = defineProps({
  target: { type: Object, required: true },
  destination: { type: Object, default: null },
  packageInfo: { type: Object, default: null },
  accounts: { type: Array, default: () => [] },
  busy: { type: Boolean, default: false },
  waiting: { type: String, default: "" },
  // { running, version, failure: { release, message } } from the page.
  activity: { type: Object, default: () => ({}) }
});
const emit = defineEmits(["remove", "change-account", "show-release"]);

const accent = computed(() => destinationAccent(props.target.destination));
const latest = computed(() => props.target.latest || null);
const account = computed(() => props.accounts.find((entry) => entry.id === props.target.account) || null);
const proof = computed(() => latest.value ? proofLine({ checksum: latest.value.checksum, ...latest.value.proof, url: "" }) : "");
// Each file's own sha256 as the destination reported it, so people can match it
// to what pip or a release page shows; the combined fingerprint is only a fallback.
const proofFiles = computed(() => {
  const facts = latest.value?.proof || {};
  const listed = Array.isArray(facts.files) && facts.files.length ? facts.files : (Array.isArray(facts.assets) ? facts.assets : []);
  return listed
    .filter((file) => file?.name && /^sha256:[0-9a-f]{64}$/u.test(String(file.sha256 || "")))
    .map((file) => ({ name: file.name, sha256: String(file.sha256).slice("sha256:".length) }));
});
const accountChoices = computed(() => props.accounts.filter((entry) => entry.kind === props.destination?.accountKind));
// Only a page the destination itself named, or npmjs.com for a package it named.
const pageUrl = computed(() => {
  const proofFacts = latest.value?.proof || {};
  if (proofFacts.page) return proofFacts.page;
  return proofFacts.package ? publicPageUrl(props.target.destination, { package: proofFacts.package, version: latest.value.version, settings: props.target.settings }) : "";
});
const failure = computed(() => props.activity?.failure || null);
</script>

<template>
  <article class="publish-target" :class="[`publish-target--${accent}`, { 'is-running': activity.running, 'is-live': latest && !activity.running }]" :data-target="target.id">
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

    <div class="publish-target__version" aria-live="polite">
      <template v-if="activity.running">
        <strong class="publish-target__pending">{{ activity.version ? `Publishing ${activity.version}` : "Publishing" }}…</strong>
        <v-progress-linear class="publish-target__progress" color="primary" indeterminate rounded />
      </template>
      <template v-else-if="latest">
        <strong>{{ latest.version }}</strong>
        <span class="publish-target__live"><i aria-hidden="true" />Live · published {{ relativeTime(latest.at) }}</span>
      </template>
      <template v-else>
        <strong class="publish-target__none">Not published yet</strong>
        <span>{{ waiting || "Ready for its first release" }}</span>
      </template>
    </div>

    <button v-if="failure && !activity.running" class="publish-target__failure" type="button" @click="emit('show-release', failure.release.id)">
      <v-icon :icon="mdiAlertCircleOutline" size="18" />
      <span><strong>Last release failed.</strong> {{ failure.message }}</span>
    </button>

    <dl class="publish-target__facts">
      <slot name="facts" />
      <div v-if="proofFiles.length && !activity.running">
        <dt>Verified</dt>
        <dd class="publish-target__verified-files">
          <span
            v-for="file in proofFiles"
            :key="file.name"
            class="publish-target__verified publish-target__verified--file"
            :title="`Read back from ${destination?.label || 'the destination'} after publishing: ${file.name} sha256 ${file.sha256}`"
          >
            <v-icon :icon="mdiCheckDecagram" color="success" size="16" />
            <span class="publish-target__file-lines">
              <span class="publish-target__file">{{ file.name }}</span>
              <span class="publish-target__mono">sha256 {{ file.sha256.slice(0, 12) }}…</span>
            </span>
          </span>
        </dd>
      </div>
      <div v-else-if="proof && !activity.running">
        <dt>Verified</dt>
        <dd class="publish-target__verified" :title="`Read back from ${destination?.label || 'the destination'} after publishing: ${proof}`">
          <v-icon :icon="mdiCheckDecagram" color="success" size="16" />
          <span class="publish-target__mono">{{ proof }}</span>
        </dd>
      </div>
    </dl>

    <slot name="setup" />

    <footer v-if="$slots.actions || pageUrl" class="publish-target__actions">
      <slot name="actions" />
      <v-btn v-if="pageUrl" :append-icon="mdiOpenInNew" :href="pageUrl" rel="noopener" rounded="pill" size="small" target="_blank" variant="tonal">
        View {{ latest.version }}
      </v-btn>
    </footer>
  </article>
</template>

<style scoped>
.publish-target {
  --accent: rgb(var(--v-theme-primary));
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  display: flex;
  flex-direction: column;
  gap: var(--v64-space-3, 12px);
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

.publish-target.is-running::before {
  animation: publish-target-sweep 1.4s linear infinite;
  background: linear-gradient(90deg, transparent, var(--accent), transparent);
  background-size: 50% 100%;
  background-repeat: no-repeat;
}

@keyframes publish-target-sweep {
  from { background-position: -50% 0; }
  to { background-position: 150% 0; }
}

@media (prefers-reduced-motion: reduce) {
  .publish-target.is-running::before { animation: none; }
}

.publish-target__pending {
  color: rgb(var(--v-theme-primary));
  font: var(--v64-type-title-md) !important;
}

.publish-target__progress {
  margin-top: 6px;
}

.publish-target__version .publish-target__live {
  align-items: center;
  display: inline-flex;
  gap: 6px;
}

.publish-target__live i {
  background: rgb(var(--v-theme-success));
  border-radius: 50%;
  box-shadow: 0 0 0 3px color-mix(in srgb, rgb(var(--v-theme-success)) 22%, transparent);
  display: inline-block;
  flex: 0 0 auto;
  height: 7px;
  width: 7px;
}

.publish-target__failure {
  align-items: flex-start;
  background: color-mix(in srgb, rgb(var(--v-theme-error)) 9%, var(--v64-surface));
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-error)) 28%, transparent);
  border-radius: var(--v64-shape-md, 12px);
  color: inherit;
  cursor: pointer;
  display: flex;
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
  gap: 8px;
  padding: 8px 10px;
  text-align: left;
}

.publish-target__failure .v-icon {
  color: rgb(var(--v-theme-error));
  flex: 0 0 auto;
  margin-top: 1px;
}

.publish-target__failure span {
  display: -webkit-box;
  overflow: hidden;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
}

.publish-target__failure:hover,
.publish-target__failure:focus-visible {
  border-color: rgb(var(--v-theme-error));
}

.publish-target__verified {
  align-items: center;
  display: flex !important;
  gap: 6px;
}

.publish-target__verified span {
  color: var(--v64-on-surface-variant);
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.publish-target__verified-files {
  display: grid !important;
  gap: 4px;
  min-width: 0;
}

.publish-target__verified--file {
  align-items: flex-start !important;
}

.publish-target__file-lines {
  display: grid;
  min-width: 0;
}

.publish-target__file-lines > span {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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
  margin-top: auto;
  flex-wrap: wrap;
  gap: var(--v64-space-2, 8px);
}
</style>
