<script setup>
// Every release and dry run: what was planned, each step, each target's
// outcome with its proof, and the log. A running release updates live.
import { computed, ref } from "vue";
import { mdiChevronDown, mdiDownload, mdiQrcode, mdiTestTube, mdiRocketLaunchOutline, mdiReplay } from "@mdi/js";
import { apkDownloadUrl } from "./usePublishing.js";
import { proofLine, relativeTime, shortCommit, statusInfo, stepLabel } from "./publishFormat.js";

const props = defineProps({
  releases: { type: Array, default: () => [] },
  targets: { type: Array, default: () => [] },
  destinations: { type: Array, default: () => [] },
  activeRelease: { type: String, default: "" },
  call: { type: Function, required: true }
});
const emit = defineEmits(["install", "resume"]);

const open = ref("");
const logs = ref({});
const targetsById = computed(() => {
  const labels = Object.fromEntries(props.destinations.map((entry) => [entry.id, entry.shortLabel || entry.label]));
  return Object.fromEntries(props.targets.map((target) => [target.id, { ...target, destinationLabel: labels[target.destination] }]));
});

// A dry run never publishes: its success reads "Would publish".
function outcomeLabel(release) {
  if (release.kind === "dry-run" && release.status === "succeeded") return "Would publish — nothing was sent";
  return statusInfo(release.status).label;
}

function toggle(id) {
  open.value = open.value === id ? "" : id;
}

async function showLog(id) {
  const answer = await props.call(`/releases/${encodeURIComponent(id)}/logs`, { method: "GET", refreshAfter: false }).catch((error) => ({ log: [{ message: error.message }] }));
  logs.value = { ...logs.value, [id]: answer.log || [] };
}

function versionsLine(release) {
  return Object.entries(release.versions || {}).map(([id, version]) => `${id} ${version}`).join(" · ") || shortCommit(release.savedCommit);
}

function progress(release) {
  const steps = release.steps || [];
  if (!steps.length) return 0;
  return Math.round(100 * steps.filter((entry) => ["done", "failed", "skipped"].includes(entry.status)).length / steps.length);
}

function isApk(release, targetId) {
  return targetsById.value[targetId]?.destination === "android-sideload" || release.targets?.[targetId]?.destination === "android-sideload";
}
</script>

<template>
  <section class="publish-history" aria-labelledby="publish-history-title">
    <h2 id="publish-history-title" class="publish-section-title">History</h2>
    <p v-if="!releases.length" class="publish-history__empty">Releases and dry runs appear here, with every step and the proof of what was published.</p>
    <ol v-else class="publish-history__list">
      <li v-for="release in releases" :key="release.id" :class="{ 'is-open': open === release.id }" :data-release="release.id">
        <button class="publish-history__row" type="button" :aria-expanded="open === release.id" @click="toggle(release.id)">
          <v-icon
            :color="statusInfo(release.status).color"
            :icon="release.status === 'running' ? (release.kind === 'dry-run' ? mdiTestTube : mdiRocketLaunchOutline) : statusInfo(release.status).icon"
            size="22"
          />
          <span class="publish-history__what">
            <strong>{{ release.kind === "dry-run" ? "Dry run" : "Release" }} · {{ versionsLine(release) }}</strong>
            <span>{{ outcomeLabel(release) }} · {{ relativeTime(release.finishedAt || release.createdAt) }} · plan {{ release.planId }}</span>
          </span>
          <v-icon :icon="mdiChevronDown" class="publish-history__chevron" size="20" />
        </button>
        <v-progress-linear v-if="release.status === 'running'" :model-value="progress(release)" color="primary" height="3" />

        <div v-if="open === release.id || release.status === 'running'" class="publish-history__detail">
          <ol class="publish-history__steps">
            <li v-for="entry in release.steps" :key="entry.id">
              <v-icon :color="statusInfo(entry.status).color" :icon="statusInfo(entry.status).icon" size="16" />
              <span>{{ stepLabel(entry.id, targetsById) }}</span>
              <span class="publish-history__message">{{ entry.message }}</span>
            </li>
          </ol>
          <ul v-if="Object.keys(release.targets || {}).length" class="publish-history__outcomes">
            <li v-for="(outcome, targetId) in release.targets" :key="targetId">
              <strong>{{ targetId }}</strong>
              <span v-if="outcome.error" class="publish-history__error">{{ outcome.error.message }}</span>
              <span v-else class="publish-history__proof">{{ outcome.alreadyPublished ? "already published · " : "" }}{{ proofLine({ checksum: outcome.checksum, ...outcome.proof }) || statusInfo(outcome.status).label }}</span>
              <span v-if="release.kind === 'release' && outcome.status === 'proven' && isApk(release, targetId)" class="publish-history__apk">
                <v-btn :href="apkDownloadUrl(release.id, targetId)" :prepend-icon="mdiDownload" rounded="pill" size="small" variant="text">APK</v-btn>
                <v-btn :prepend-icon="mdiQrcode" rounded="pill" size="small" variant="text" @click="emit('install', { releaseId: release.id, targetId })">QR</v-btn>
              </span>
            </li>
          </ul>
          <p v-if="release.error" class="publish-history__error">{{ release.error.message }}</p>
          <div class="publish-history__tools">
            <v-btn v-if="release.kind === 'release' && ['partial', 'failed', 'interrupted'].includes(release.status)" :prepend-icon="mdiReplay" rounded="pill" size="small" variant="tonal" @click="emit('resume', release)">
              Finish this release
            </v-btn>
            <v-btn rounded="pill" size="small" variant="text" @click="showLog(release.id)">Show log</v-btn>
          </div>
          <pre v-if="logs[release.id]" class="publish-history__log">{{ logs[release.id].map((line) => `${line.at ? line.at.slice(11, 19) + "  " : ""}${line.message}`).join("\n") || "No log lines." }}</pre>
        </div>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.publish-history__empty {
  background: var(--v64-surface-container-low);
  border: 1px dashed var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  margin: 0;
  padding: 20px;
  text-align: center;
}

.publish-history__list {
  background: var(--v64-surface-container-low);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-lg, 16px);
  list-style: none;
  margin: 0;
  overflow: hidden;
  padding: 0;
}

.publish-history__list > li + li {
  border-top: 1px solid var(--v64-outline-variant);
}

.publish-history__row {
  align-items: center;
  background: transparent;
  border: 0;
  color: inherit;
  display: grid;
  gap: 12px;
  grid-template-columns: 22px minmax(0, 1fr) 20px;
  padding: 12px 16px;
  text-align: left;
  width: 100%;
}

.publish-history__row:hover {
  background: color-mix(in srgb, var(--v64-on-surface) 4%, transparent);
}

.publish-history__what {
  display: grid;
  min-width: 0;
}

.publish-history__what strong {
  font: var(--v64-type-label-lg);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-history__what span {
  color: var(--v64-on-surface-variant);
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
}

.publish-history__chevron {
  transition: transform 150ms ease;
}

.is-open .publish-history__chevron {
  transform: rotate(180deg);
}

.publish-history__detail {
  display: grid;
  gap: 10px;
  padding: 4px 16px 16px 50px;
}

.publish-history__steps,
.publish-history__outcomes {
  display: grid;
  gap: 4px;
  list-style: none;
  margin: 0;
  padding: 0;
}

.publish-history__steps li {
  align-items: center;
  display: grid;
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
  gap: 8px;
  grid-template-columns: 16px auto minmax(0, 1fr);
}

.publish-history__message {
  color: var(--v64-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.publish-history__outcomes li {
  align-items: center;
  background: var(--v64-surface);
  border-radius: var(--v64-shape-sm, 8px);
  display: flex;
  flex-wrap: wrap;
  font-size: 0.8125rem;
  gap: 4px 12px;
  padding: 6px 10px;
}

.publish-history__proof {
  color: var(--v64-on-surface-variant);
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  min-width: 0;
  overflow-wrap: anywhere;
}

.publish-history__apk {
  margin-left: auto;
}

.publish-history__error {
  color: rgb(var(--v-theme-error));
  font: var(--v64-type-body-md);
  font-size: 0.8125rem;
  margin: 0;
}

.publish-history__tools {
  display: flex;
  gap: 8px;
}

.publish-history__log {
  background: var(--v64-surface);
  border: 1px solid var(--v64-outline-variant);
  border-radius: var(--v64-shape-sm, 8px);
  font-size: 0.75rem;
  max-height: 16rem;
  overflow: auto;
  padding: 10px 12px;
  white-space: pre-wrap;
}

@media (max-width: 600px) {
  .publish-history__detail {
    padding-left: 16px;
  }
}
</style>
