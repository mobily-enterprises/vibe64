<script setup>
import { computed } from "vue";
import { trainingIcons as icons } from "./trainingIcons.js";

// Presentational browser of the official course catalogue: topics (catalogue
// domains) and their courses. It emits only exact install and view intents;
// the server re-reads the catalogue and verifies everything it installs.
const props = defineProps({
  availableResult: { type: Object, default: null },
  availableLoading: Boolean,
  availableError: { type: String, default: "" },
  installState: { type: Object, default: null },
  busy: Boolean
});
const emit = defineEmits(["install", "view", "refresh"]);
const text = value => typeof value === "string" && value.length > 0;
const ready = computed(() => props.availableResult?.ok === true && props.availableResult.available === true &&
  Array.isArray(props.availableResult.domains) && Array.isArray(props.availableResult.courses));
const courses = computed(() => ready.value ? props.availableResult.courses.filter(course => text(course?.courseId) && text(course.release) && text(course.title)) : []);
const topics = computed(() => {
  if (!ready.value) return [];
  const known = new Set(props.availableResult.domains.map(domain => domain.domainId));
  const groups = props.availableResult.domains.map(domain => ({ id: domain.domainId, title: domain.title,
    courses: courses.value.filter(course => course.domainId === domain.domainId) }));
  const other = courses.value.filter(course => !known.has(course.domainId));
  return other.length ? [...groups, { id: "", title: "Other courses", courses: other }] : groups;
});
const key = course => `${course.courseId}@${course.release}`;
const plural = (count, word) => `${count} ${word}${count === 1 ? "" : "s"}`;
const stateOf = course => props.installState && props.installState.courseId === course.courseId &&
  props.installState.release === course.release ? props.installState : null;
function progressText(course) {
  const progress = course.installing;
  if (!progress) return "Downloading and verifying the course…";
  if (progress.phase === "queued") return "Waiting for another course installation to finish…";
  if (progress.phase === "catalogue") return "Reading the official catalogue…";
  if (progress.phase === "topic") return `Downloading and verifying topic ${Math.min(progress.topicsDone + 1, progress.topicsTotal)} of ${progress.topicsTotal}…`;
  if (progress.phase === "enable") return "Enabling the course…";
  return "Installing…";
}
const installedLabel = { enabled: "Installed", disabled: "Disabled on this server", conflict: "Conflicting copy installed", "not-installed": "Not installed" };
const installedTone = { enabled: "enabled", disabled: "disabled", conflict: "disabled", "not-installed": "neutral" };
const installable = course => course.installed === "not-installed";
function install(course) {
  if (props.busy || !installable(course)) return;
  emit("install", { courseId: course.courseId, release: course.release });
}
</script>

<template>
  <section class="tcc training-course-catalogue" aria-labelledby="tcc-heading" :aria-busy="availableLoading">
    <header class="tcc__head">
      <div>
        <p class="tcc__eyebrow"><v-icon :icon="icons.download" size="18" /> Course catalogue</p>
        <h3 id="tcc-heading">Install a course</h3>
        <p class="tcc__intro">Courses from the official Vibe64 catalogue, grouped by topic. Installing downloads and verifies the course on this server; it does not start a lesson.</p>
      </div>
    </header>
    <div v-if="availableLoading && !ready" class="tcc__loading" role="status">
      <v-progress-circular indeterminate size="20" width="2" color="primary" /><span>Reading the course catalogue…</span>
    </div>
    <v-alert v-else-if="availableError" type="error" variant="tonal" rounded="lg" role="alert">
      {{ availableError }}
      <template #append><v-btn variant="text" min-height="40" :disabled="busy" @click="emit('refresh')">Retry</v-btn></template>
    </v-alert>
    <p v-else-if="availableResult && !ready" class="tcc__note" role="status">
      <v-icon :icon="icons.info" size="20" /><span>{{ availableResult.error || 'The course catalogue is not available in this installation.' }}</span>
    </p>
    <p v-else-if="ready && !courses.length" class="tcc__note" role="status">
      <v-icon :icon="icons.info" size="20" /><span>The catalogue has no courses yet.</span>
    </p>

    <section v-for="topic in topics" :key="topic.id || 'other'" class="tcc__topic" :aria-label="`Topic ${topic.title}`">
      <h4 class="tcc__topic-title"><v-icon :icon="icons.layers" size="20" />{{ topic.title }}</h4>
      <p v-if="!topic.courses.length" class="tcc__empty">No courses in this topic yet.</p>
      <ul class="tcc__list">
        <li v-for="course in topic.courses" :key="key(course)" class="tcc__course" :data-course="key(course)">
          <div class="tcc__course-main">
            <strong class="tcc__title">{{ course.title }}</strong>
            <p class="tcc__chips">
              <span class="tcc__chip"><code>{{ course.release }}</code></span>
              <span class="tcc__chip" :class="course.status === 'released' ? 'tcc__chip--enabled' : 'tcc__chip--preview'">{{ course.status === 'released' ? 'Released' : 'Preview' }}</span>
              <span class="tcc__chip">{{ plural(course.lessonCount, 'lesson') }}</span>
              <span v-if="!course.updateFrom" class="tcc__chip" :class="`tcc__chip--${installedTone[course.installed] || 'neutral'}`">{{ installedLabel[course.installed] || course.installed }}</span>
              <span v-if="course.updateFrom" class="tcc__chip tcc__chip--update"><v-icon :icon="icons.update" size="14" />Update available: {{ course.release }}</span>
            </p>
            <p v-if="course.updateFrom" class="tcc__detail">You have {{ course.updateFrom }}. Updating keeps your saved lessons and progress.</p>
            <p v-if="course.status !== 'released'" class="tcc__detail">Preview course: it can be installed; until it is released, only the workspace owner can try its lessons from Courses.</p>
            <p v-if="course.installed === 'disabled'" class="tcc__detail">This release was disabled on this server. Installing cannot enable it again; only the server's operator can.</p>
            <p v-if="stateOf(course)?.phase === 'installing'" class="tcc__progress" role="status">
              <v-progress-circular indeterminate size="18" width="2" color="primary" /><span>{{ progressText(course) }}</span>
            </p>
            <p v-else-if="stateOf(course)?.phase === 'failed'" class="tcc__failure" role="alert">
              <v-icon :icon="icons.info" size="18" /><span>{{ stateOf(course).message }}</span>
            </p>
          </div>
          <div class="tcc__actions">
            <v-btn v-if="course.installed === 'enabled'" variant="text" rounded="pill" min-height="48" :append-icon="icons.arrowRight"
              @click="emit('view', { courseId: course.courseId, release: course.release })">View course</v-btn>
            <v-btn v-else-if="installable(course)" color="primary" :variant="course.updateFrom ? 'flat' : 'tonal'" rounded="pill" min-height="48"
              :prepend-icon="course.updateFrom ? icons.update : icons.download" :loading="stateOf(course)?.phase === 'installing'"
              :disabled="busy" @click="install(course)">
              {{ stateOf(course)?.phase === 'failed' ? (course.updateFrom ? 'Retry update' : 'Retry install') : (course.updateFrom ? 'Update' : 'Install') }}
            </v-btn>
          </div>
        </li>
      </ul>
    </section>
  </section>
</template>

<style scoped>
.tcc { display: flex; flex-direction: column; gap: var(--v64-space-4, 16px); min-width: 0; }
.tcc p, .tcc code, .tcc strong { white-space: normal; overflow-wrap: anywhere; }
.tcc :deep(.v-btn) { letter-spacing: 0.01em; text-transform: none; font-weight: 600; }
.tcc__head h3 { margin: var(--v64-space-1, 4px) 0; font: var(--v64-type-headline-sm); }
.tcc__eyebrow {
  display: inline-flex; align-items: center; gap: var(--v64-space-1, 4px); margin: 0;
  font: var(--v64-type-label-md); letter-spacing: 0.08em; text-transform: uppercase; color: var(--v64-on-learning-container);
}
.tcc__intro { margin: 0; max-width: 40rem; font: var(--v64-type-body-md); color: var(--v64-on-surface-variant); }
.tcc__loading, .tcc__note, .tcc__progress, .tcc__failure {
  display: flex; align-items: flex-start; gap: var(--v64-space-2, 8px); margin: 0; font: var(--v64-type-body-md);
}
.tcc__note { padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px); background: var(--v64-surface-container); color: var(--v64-on-surface-variant); }
.tcc__progress { color: var(--v64-on-primary-container); }
.tcc__failure { color: rgb(var(--v-theme-error)); }
.tcc__topic { display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); }
.tcc__topic-title { display: flex; align-items: center; gap: var(--v64-space-2, 8px); margin: 0; font: var(--v64-type-title-md); }
.tcc__empty { margin: 0; font: var(--v64-type-body-md); color: var(--v64-on-surface-variant); }
.tcc__list { list-style: none; margin: 0; padding: 0; display: flex; flex-direction: column; gap: var(--v64-space-2, 8px); }
.tcc__course {
  display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: var(--v64-space-3, 12px);
  padding: var(--v64-space-3, 12px) var(--v64-space-4, 16px); border-radius: var(--v64-shape-lg, 16px);
  border: 1px solid var(--v64-outline-variant); background: var(--v64-surface-container-low);
}
.tcc__course-main { flex: 1 1 18rem; min-width: 0; display: flex; flex-direction: column; gap: var(--v64-space-1, 4px); }
.tcc__title { font: var(--v64-type-title-md); }
.tcc__chips { display: flex; flex-wrap: wrap; gap: var(--v64-space-1, 4px); margin: 0; }
.tcc__chip {
  display: inline-flex; align-items: center; gap: 4px; min-height: 24px; padding: 1px 8px; border-radius: var(--v64-shape-sm, 8px);
  font: var(--v64-type-label-md); background: var(--v64-surface-container-high); color: var(--v64-on-surface-variant);
}
.tcc__chip code { font-size: 0.75rem; }
.tcc__chip--enabled { background: var(--v64-success-container); color: var(--v64-on-surface); }
.tcc__chip--preview { background: var(--v64-primary-container); color: var(--v64-on-primary-container); }
.tcc__chip--disabled { background: var(--v64-surface-container-highest); }
.tcc__chip--update { background: var(--v64-learning); color: var(--v64-on-learning); }
.tcc__detail { margin: 0; font: var(--v64-type-body-sm, 400 0.8125rem/1.25rem system-ui, sans-serif); color: var(--v64-on-surface-variant); }
.tcc__actions { flex: none; display: flex; gap: var(--v64-space-2, 8px); }
:global(.v-theme--dark .tcc__eyebrow) { color: var(--v64-learning); }
@container (max-width: 34rem) {
  .tcc__actions { flex: 1 1 100%; }
  .tcc__actions :deep(.v-btn) { flex: 1 1 100%; }
}
</style>
