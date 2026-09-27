<template>
  <div
    ref="browser"
    class="vibe64-repository-file-browser"
    :class="{
      'vibe64-repository-file-browser--embedded': embedded,
      'vibe64-repository-file-browser--stacked': stacked,
      'vibe64-repository-file-browser--resizing': resizing
    }"
    :style="{ '--repository-file-list-width': `${listWidth}px` }"
  >
    <aside :id="listId" :aria-label="ariaLabel" class="vibe64-repository-file-browser__list">
      <header v-if="listTitle">
        <strong>{{ listTitle }}</strong>
        <span v-if="listDescription">{{ listDescription }}</span>
      </header>
      <button
        v-for="file in files"
        :key="file.path"
        :aria-current="selectedPath === file.path ? 'true' : undefined"
        class="vibe64-repository-file-browser__file"
        :class="{ 'vibe64-repository-file-browser__file--active': selectedPath === file.path }"
        type="button"
        @click="$emit('select', file)"
      >
        <span class="vibe64-repository-file-browser__path">{{ file.path }}</span>
        <span class="vibe64-repository-file-browser__meta">
          {{ fileStatusLabel(file.status) }}
          <span class="vibe64-repository-file-browser__counts">+{{ file.added }} −{{ file.deleted }}</span>
        </span>
      </button>
      <v-btn
        v-if="truncated"
        :loading="loadingMore"
        size="small"
        type="button"
        variant="text"
        @click="$emit('load-more')"
      >
        Load more files
      </v-btn>
    </aside>
    <div
      :aria-controls="listId"
      aria-label="Changed files width"
      aria-orientation="vertical"
      :aria-valuemax="maxWidth"
      :aria-valuemin="MIN_WIDTH"
      :aria-valuenow="listWidth"
      :aria-valuetext="`${listWidth} pixels`"
      class="vibe64-repository-file-browser__separator"
      role="separator"
      tabindex="0"
      title="Drag to resize, or use Left and Right arrow keys"
      @keydown="resizeWithKeyboard"
      @pointerdown="startResize"
      @pointermove="moveResize"
      @pointerup="stopResize"
      @pointercancel="stopResize"
      @lostpointercapture="stopResize"
    />
    <main class="vibe64-repository-file-browser__detail">
      <h2>{{ selectedPath || emptyTitle }}</h2>
      <Vibe64RepositoryDiff
        :error="error"
        :loading="loading"
        :payload="payload"
      />
    </main>
  </div>
</template>

<script setup>
import { computed, onBeforeUnmount, onMounted, ref, useId } from "vue";
import Vibe64RepositoryDiff from "@/components/studio/repository/Vibe64RepositoryDiff.vue";
import { readLocalStorageJson, writeLocalStorageJson } from "@/lib/browserLocalStorage.js";

defineEmits(["load-more", "select"]);

defineProps({
  ariaLabel: { default: "Changed files", type: String },
  embedded: { default: false, type: Boolean },
  emptyTitle: { default: "Select a file", type: String },
  error: { default: "", type: String },
  files: { default: () => [], type: Array },
  listDescription: { default: "", type: String },
  listTitle: { default: "", type: String },
  loading: { default: false, type: Boolean },
  loadingMore: { default: false, type: Boolean },
  payload: { default: null, type: Object },
  selectedPath: { default: "", type: String },
  truncated: { default: false, type: Boolean }
});

const WIDTH_STORAGE_KEY = "vibe64:repository-file-list-width";
const MIN_WIDTH = 160;
const MAX_WIDTH = 480;
const DEFAULT_WIDTH = 336;
const SEPARATOR_WIDTH = 12;
const DETAIL_MIN_WIDTH = 280;
const listId = useId();
const browser = ref(null);
const containerWidth = ref(0);
const resizing = ref(false);
const savedWidth = readLocalStorageJson(WIDTH_STORAGE_KEY, null);
const preferredWidth = ref(Number.isFinite(savedWidth) ? savedWidth : DEFAULT_WIDTH);
const stacked = computed(() => containerWidth.value > 0 && containerWidth.value < 480);
const maxWidth = computed(() => containerWidth.value > 0
  ? Math.max(MIN_WIDTH, Math.min(MAX_WIDTH, containerWidth.value - DETAIL_MIN_WIDTH - SEPARATOR_WIDTH))
  : MAX_WIDTH);
const listWidth = computed(() => Math.round(Math.min(maxWidth.value, Math.max(MIN_WIDTH, preferredWidth.value))));
let observer;
let drag;

function syncBounds() {
  containerWidth.value = browser.value?.clientWidth || 0;
}

function startResize(event) {
  if (event.button !== 0 || drag) return;
  event.preventDefault();
  syncBounds();
  drag = { pointerId: event.pointerId, startX: event.clientX, startWidth: listWidth.value, target: event.currentTarget };
  resizing.value = true;
  event.currentTarget.focus();
  event.currentTarget.setPointerCapture(event.pointerId);
}

function moveResize(event) {
  if (!drag || event.pointerId !== drag.pointerId) return;
  preferredWidth.value = Math.min(maxWidth.value, Math.max(MIN_WIDTH, drag.startWidth + event.clientX - drag.startX));
}

function stopResize(event) {
  if (!drag || (event && event.pointerId !== drag.pointerId)) return;
  const { target, pointerId } = drag;
  drag = null;
  resizing.value = false;
  if (target.hasPointerCapture(pointerId)) target.releasePointerCapture(pointerId);
  writeLocalStorageJson(WIDTH_STORAGE_KEY, listWidth.value);
}

function resizeWithKeyboard(event) {
  syncBounds();
  let nextWidth;
  switch (event.key) {
    case "Home": nextWidth = MIN_WIDTH; break;
    case "End": nextWidth = maxWidth.value; break;
    case "ArrowLeft": nextWidth = listWidth.value - 16; break;
    case "ArrowRight": nextWidth = listWidth.value + 16; break;
    default: return;
  }
  event.preventDefault();
  preferredWidth.value = Math.min(maxWidth.value, Math.max(MIN_WIDTH, nextWidth));
  writeLocalStorageJson(WIDTH_STORAGE_KEY, listWidth.value);
}

onMounted(() => {
  syncBounds();
  if (typeof ResizeObserver !== "undefined") {
    observer = new ResizeObserver(syncBounds);
    observer.observe(browser.value);
  }
});

onBeforeUnmount(() => {
  stopResize();
  observer?.disconnect();
});

function fileStatusLabel(value = "") {
  return ({
    A: "Added",
    C: "Copied",
    D: "Removed",
    M: "Changed",
    R: "Renamed",
    T: "Type changed",
    U: "Needs attention"
  })[String(value || "").slice(0, 1).toUpperCase()] || "Changed";
}
</script>

<style scoped>
.vibe64-repository-file-browser {
  align-items: start;
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 0.75rem;
  display: grid;
  grid-template-columns: var(--repository-file-list-width, 21rem) 12px minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.vibe64-repository-file-browser--embedded {
  border: 0;
  border-radius: 0;
  height: 100%;
  width: 100%;
}

.vibe64-repository-file-browser__list {
  max-height: 44rem;
  min-width: 0;
  overflow: auto;
}

.vibe64-repository-file-browser__separator {
  align-self: stretch;
  cursor: col-resize;
  outline: none;
  position: relative;
  touch-action: none;
}

.vibe64-repository-file-browser__separator::before {
  background: rgba(var(--v-theme-outline), 0.18);
  content: "";
  inset: 0 5px;
  position: absolute;
}

.vibe64-repository-file-browser__separator:hover::before,
.vibe64-repository-file-browser__separator:focus-visible::before,
.vibe64-repository-file-browser--resizing .vibe64-repository-file-browser__separator::before {
  background: rgb(var(--v-theme-primary));
}

.vibe64-repository-file-browser--resizing {
  cursor: col-resize;
  user-select: none;
}

.vibe64-repository-file-browser--embedded .vibe64-repository-file-browser__list {
  align-self: stretch;
  max-height: none;
  min-height: 0;
}

.vibe64-repository-file-browser__list header {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.14);
  display: grid;
  gap: 0.18rem;
  padding: 0.75rem;
}

.vibe64-repository-file-browser__list header span {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.84rem;
}

.vibe64-repository-file-browser__file {
  background: transparent;
  border: 0;
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.1);
  color: inherit;
  cursor: pointer;
  display: grid;
  gap: 0.18rem;
  padding: 0.62rem 0.75rem;
  text-align: start;
  width: 100%;
}

.vibe64-repository-file-browser__file:hover,
.vibe64-repository-file-browser__file:focus-visible,
.vibe64-repository-file-browser__file--active {
  background: rgba(var(--v-theme-primary), 0.09);
  outline: none;
}

.vibe64-repository-file-browser__path {
  font-family: ui-monospace, SFMono-Regular, Menlo, monospace;
  font-size: 0.78rem;
  overflow-wrap: anywhere;
}

.vibe64-repository-file-browser__meta {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.62);
  display: flex;
  font-size: 0.74rem;
  gap: 0.5rem;
  justify-content: space-between;
}

.vibe64-repository-file-browser__counts {
  white-space: nowrap;
}

.vibe64-repository-file-browser__detail {
  align-content: start;
  align-self: start;
  display: grid;
  gap: 0.65rem;
  min-width: 0;
  overflow: auto;
  padding: 0.75rem;
}

.vibe64-repository-file-browser--embedded .vibe64-repository-file-browser__detail {
  align-self: stretch;
  min-height: 0;
}

.vibe64-repository-file-browser__detail h2 {
  font-size: 0.94rem;
  font-weight: 700;
  letter-spacing: 0;
  margin: 0;
  overflow-wrap: anywhere;
}

@media (min-width: 781px) {
  .vibe64-repository-file-browser:not(.vibe64-repository-file-browser--embedded) {
    align-self: stretch;
    grid-template-rows: minmax(0, 1fr);
  }

  .vibe64-repository-file-browser:not(.vibe64-repository-file-browser--embedded) > .vibe64-repository-file-browser__list,
  .vibe64-repository-file-browser:not(.vibe64-repository-file-browser--embedded) > .vibe64-repository-file-browser__detail {
    align-self: stretch;
    min-height: 0;
  }

  .vibe64-repository-file-browser:not(.vibe64-repository-file-browser--embedded) > .vibe64-repository-file-browser__list {
    max-height: none;
  }
}

@media (max-width: 780px) {
  .vibe64-repository-file-browser {
    grid-template-columns: minmax(0, 1fr);
  }

  .vibe64-repository-file-browser--embedded {
    grid-template-rows: min(16rem, 50%) minmax(0, 1fr);
  }

  .vibe64-repository-file-browser__list,
  .vibe64-repository-file-browser--embedded .vibe64-repository-file-browser__list {
    border-bottom: 1px solid rgba(var(--v-theme-outline), 0.16);
    border-inline-end: 0;
    max-height: 16rem;
  }

  .vibe64-repository-file-browser__separator {
    display: none;
  }
}

.vibe64-repository-file-browser--stacked {
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto minmax(0, 1fr);
}

.vibe64-repository-file-browser--stacked.vibe64-repository-file-browser--embedded {
  grid-template-rows: min(16rem, 50%) minmax(0, 1fr);
}

.vibe64-repository-file-browser--stacked > .vibe64-repository-file-browser__list {
  border-bottom: 1px solid rgba(var(--v-theme-outline), 0.16);
  max-height: 16rem;
}

.vibe64-repository-file-browser--stacked > .vibe64-repository-file-browser__separator {
  display: none;
}
</style>
