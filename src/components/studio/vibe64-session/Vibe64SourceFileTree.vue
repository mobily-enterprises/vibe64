<template>
  <ul class="vibe64-source-tree">
    <li
      v-for="child in visibleNodes"
      :key="child.path || child.name"
      class="vibe64-source-tree__item"
    >
      <div class="vibe64-source-tree__row">
        <button
          v-if="child.type === 'file'"
          class="vibe64-source-tree__button"
          :class="{ 'vibe64-source-tree__button--active': child.path === selectedPath }"
          :title="child.path || child.name || 'source'"
          type="button"
          @click="emit('open-file', child.path)"
        >
          <v-icon
            :icon="mdiFileDocumentOutline"
            size="15"
          />
          <span>{{ child.name }}</span>
        </button>

        <button
          v-else
          class="vibe64-source-tree__button vibe64-source-tree__button--directory"
          :title="child.path || child.name || 'source'"
          type="button"
          @click="toggleDirectory(child)"
        >
          <v-icon
            v-if="directoryExpandable(child)"
            class="vibe64-source-tree__chevron"
            :class="{ 'vibe64-source-tree__chevron--open': directoryOpen(child) }"
            :icon="mdiChevronRight"
            size="14"
          />
          <span
            v-else
            class="vibe64-source-tree__chevron-spacer"
            aria-hidden="true"
          />
          <v-icon
            :icon="mdiFolderOutline"
            size="15"
          />
          <span>{{ child.name || "source" }}</span>
        </button>

        <v-menu
          location="bottom end"
        >
          <template #activator="{ props: activatorProps }">
            <v-btn
              v-bind="activatorProps"
              :aria-label="`Actions for ${child.path || child.name || 'source'}`"
              class="vibe64-source-tree__menu-button"
              :icon="mdiDotsVertical"
              size="x-small"
              :title="`Actions for ${child.path || child.name || 'source'}`"
              type="button"
              variant="text"
              @click.stop
            />
          </template>
          <v-list
            class="vibe64-source-tree__menu"
            density="compact"
          >
            <v-list-item
              v-if="child.type === 'directory'"
              :prepend-icon="mdiFilePlusOutline"
              title="New file here"
              @click="emit('new-file', child.path || '')"
            />
            <v-list-item
              :prepend-icon="mdiContentCopy"
              title="Copy path"
              @click="emit('copy-path', child.path || child.name || '')"
            />
            <v-list-item
              v-if="child.type === 'file' && askCodexAvailable"
              :prepend-icon="mdiRobotOutline"
              title="Ask Codex about this file"
              @click="emit('ask-codex', child.path || '')"
            />
          </v-list>
        </v-menu>
      </div>

      <div
        v-if="child.type !== 'file' && directoryOpen(child)"
        class="vibe64-source-tree__directory"
      >
        <Vibe64SourceFileTree
          :node="child"
          :ask-codex-available="askCodexAvailable"
          :selected-path="selectedPath"
          :expanded-paths="expandedPaths"
          :load-errors="loadErrors"
          :loading-paths="loadingPaths"
          :depth="depth + 1"
          @load-more-directory="emit('load-more-directory', $event)"
          @open-file="emit('open-file', $event)"
          @directory-open-change="emit('directory-open-change', $event)"
          @new-file="emit('new-file', $event)"
          @copy-path="emit('copy-path', $event)"
          @ask-codex="emit('ask-codex', $event)"
        />
        <div
          v-if="directoryLoading(child)"
          class="vibe64-source-tree__notice"
        >
          Loading...
        </div>
        <div
          v-else-if="directoryLoadError(child)"
          class="vibe64-source-tree__notice vibe64-source-tree__notice--error"
        >
          {{ directoryLoadError(child) }}
        </div>
        <div
          v-else-if="directoryOpen(child) && child.loaded && !directoryChildCount(child) && !child.hasMore"
          class="vibe64-source-tree__notice"
        >
          Empty directory.
        </div>
      </div>
    </li>
    <li
      v-if="nodeHasMore"
      class="vibe64-source-tree__item"
    >
      <button
        class="vibe64-source-tree__button vibe64-source-tree__button--more"
        :disabled="currentNodeLoading"
        :title="`Load ${nextHiddenNodeCount} more entries in ${nodeLabel}`"
        type="button"
        @click="showMore"
      >
        <v-icon
          :icon="mdiDotsHorizontal"
          size="15"
        />
        <span v-if="currentNodeLoading">Loading...</span>
        <span v-else>Load {{ nextHiddenNodeCount }} more</span>
      </button>
    </li>
  </ul>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiChevronRight,
  mdiContentCopy,
  mdiDotsHorizontal,
  mdiDotsVertical,
  mdiFileDocumentOutline,
  mdiFilePlusOutline,
  mdiFolderOutline,
  mdiRobotOutline
} from "@mdi/js";

const DIRECTORY_BATCH_SIZE = 20;

const props = defineProps({
  expandedPaths: {
    default: () => [],
    type: Array
  },
  loadErrors: {
    default: () => ({}),
    type: Object
  },
  loadingPaths: {
    default: () => [],
    type: Array
  },
  node: {
    default: null,
    type: Object
  },
  selectedPath: {
    default: "",
    type: String
  },
  depth: {
    default: 0,
    type: Number
  },
  askCodexAvailable: {
    default: false,
    type: Boolean
  }
});
const emit = defineEmits(["ask-codex", "copy-path", "directory-open-change", "load-more-directory", "new-file", "open-file"]);

const nodes = computed(() => Array.isArray(props.node?.children) ? props.node.children : []);
const visibleNodes = computed(() => nodes.value);
const nodeHasMore = computed(() => props.node?.hasMore === true);
const currentNodeLoading = computed(() => pathLoading(props.node?.path || ""));
const nextHiddenNodeCount = computed(() => {
  const loadedCount = nodes.value.length;
  const totalCount = Number(props.node?.total || 0);
  return totalCount > loadedCount
    ? Math.min(DIRECTORY_BATCH_SIZE, totalCount - loadedCount)
    : DIRECTORY_BATCH_SIZE;
});
const nodeLabel = computed(() => props.node?.path || props.node?.name || "source");
const expandedPathSet = computed(() => new Set(
  (Array.isArray(props.expandedPaths) ? props.expandedPaths : [])
    .map((path) => normalizeTreePath(path))
    .filter(Boolean)
));
const loadingPathSet = computed(() => new Set(
  (Array.isArray(props.loadingPaths) ? props.loadingPaths : [])
    .map((path) => normalizeTreePath(path))
));

function normalizeTreePath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function directoryExpandable(node = {}) {
  return node.type === "directory" && (
    node.loaded !== true ||
    node.hasMore === true ||
    (Array.isArray(node.children) && node.children.length > 0)
  );
}

function directoryKey(node = {}) {
  return normalizeTreePath(node.path || node.name || "");
}

function directoryOpen(node = {}) {
  return expandedPathSet.value.has(directoryKey(node));
}

function pathLoading(path = "") {
  return loadingPathSet.value.has(normalizeTreePath(path));
}

function directoryLoading(node = {}) {
  return pathLoading(directoryKey(node));
}

function directoryLoadError(node = {}) {
  return String(props.loadErrors?.[directoryKey(node)] || "");
}

function directoryChildCount(node = {}) {
  return Array.isArray(node.children) ? node.children.length : 0;
}

function toggleDirectory(node = {}) {
  const key = directoryKey(node);
  if (!key) {
    return;
  }
  emit("directory-open-change", {
    open: !directoryOpen(node),
    path: key
  });
}

function showMore() {
  emit("load-more-directory", props.node?.path || "");
}
</script>

<style scoped>
.vibe64-source-tree {
  display: grid;
  gap: 0.08rem;
  list-style: none;
  margin: 0;
  min-width: 0;
  padding: 0;
}

.vibe64-source-tree .vibe64-source-tree {
  padding-left: 0.75rem;
}

.vibe64-source-tree__item {
  min-width: 0;
}

.vibe64-source-tree__row {
  align-items: center;
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto;
  min-width: 0;
}

.vibe64-source-tree__button {
  align-items: center;
  border: 0;
  border-radius: 6px;
  color: rgba(var(--v-theme-on-surface), 0.78);
  display: flex;
  font-size: 0.82rem;
  font-weight: 400;
  gap: 0.42rem;
  line-height: 1.25;
  min-height: 1.72rem;
  min-width: 0;
  padding: 0.22rem 0.38rem;
  text-align: left;
  width: 100%;
}

.vibe64-source-tree__button {
  background: transparent;
  cursor: pointer;
}

.vibe64-source-tree__button:hover,
.vibe64-source-tree__button:focus-visible {
  background: rgba(var(--v-theme-primary), 0.08);
  outline: 0;
}

.vibe64-source-tree__button--active {
  background: rgba(var(--v-theme-primary), 0.14);
  color: rgb(var(--v-theme-primary));
  font-weight: 500;
}

.vibe64-source-tree__button--more {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.78rem;
  font-weight: 500;
}

.vibe64-source-tree__button:disabled {
  cursor: default;
  opacity: 0.62;
}

.vibe64-source-tree__menu-button {
  color: rgba(var(--v-theme-on-surface), 0.56);
  flex: 0 0 auto;
  min-block-size: 1.72rem;
  min-inline-size: 1.72rem;
}

.vibe64-source-tree__menu :deep(.v-list-item-title) {
  font-size: 0.82rem;
}

.vibe64-source-tree__notice {
  color: rgba(var(--v-theme-on-surface), 0.58);
  font-size: 0.74rem;
  padding: 0.22rem 0.38rem 0.28rem 2.05rem;
}

.vibe64-source-tree__notice--error {
  color: rgb(var(--v-theme-error));
}

.vibe64-source-tree__button span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-tree__chevron {
  color: rgba(var(--v-theme-on-surface), 0.58);
  flex: 0 0 auto;
  transition: transform 0.14s ease;
}

.vibe64-source-tree__chevron--open {
  transform: rotate(90deg);
}

.vibe64-source-tree__chevron-spacer {
  flex: 0 0 14px;
  height: 14px;
  width: 14px;
}
</style>
