<template>
  <ul class="vibe64-source-tree">
    <li
      v-for="child in visibleNodes"
      :key="child.path || child.name"
      class="vibe64-source-tree__item"
    >
      <button
        v-if="child.type === 'file'"
        class="vibe64-source-tree__button"
        :class="{ 'vibe64-source-tree__button--active': child.path === selectedPath }"
        :title="child.path || child.name"
        type="button"
        @click="emit('open-file', child.path)"
      >
        <v-icon
          :icon="mdiFileDocumentOutline"
          size="15"
        />
        <span>{{ child.name }}</span>
      </button>

      <details
        v-else
        class="vibe64-source-tree__directory"
        :open="directoryOpen(child)"
        @toggle="handleDirectoryToggle(child, $event)"
      >
        <summary
          class="vibe64-source-tree__summary"
          :title="child.path || child.name || 'source'"
        >
          <v-icon
            v-if="directoryExpandable(child)"
            class="vibe64-source-tree__chevron"
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
        </summary>
        <Vibe64SourceFileTree
          :node="child"
          :selected-path="selectedPath"
          :expanded-paths="expandedPaths"
          :depth="depth + 1"
          @open-file="emit('open-file', $event)"
          @directory-open-change="emit('directory-open-change', $event)"
        />
      </details>
    </li>
    <li
      v-if="hiddenNodeCount > 0"
      class="vibe64-source-tree__item"
    >
      <button
        class="vibe64-source-tree__button vibe64-source-tree__button--more"
        :title="`Show ${nextHiddenNodeCount} more files in ${nodeLabel}`"
        type="button"
        @click="showMore"
      >
        <v-icon
          :icon="mdiDotsHorizontal"
          size="15"
        />
        <span>Show {{ nextHiddenNodeCount }} more</span>
      </button>
    </li>
  </ul>
</template>

<script setup>
import { computed, ref, watch } from "vue";
import {
  mdiChevronRight,
  mdiDotsHorizontal,
  mdiFileDocumentOutline,
  mdiFolderOutline
} from "@mdi/js";

const DIRECTORY_BATCH_SIZE = 20;

const props = defineProps({
  expandedPaths: {
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
  }
});
const emit = defineEmits(["directory-open-change", "open-file"]);

const nodes = computed(() => Array.isArray(props.node?.children) ? props.node.children : []);
const visibleNodeLimit = ref(DIRECTORY_BATCH_SIZE);
const visibleNodes = computed(() => nodes.value.slice(0, visibleNodeLimit.value));
const hiddenNodeCount = computed(() => Math.max(0, nodes.value.length - visibleNodeLimit.value));
const nextHiddenNodeCount = computed(() => Math.min(DIRECTORY_BATCH_SIZE, hiddenNodeCount.value));
const nodeLabel = computed(() => props.node?.path || props.node?.name || "source");
const expandedPathSet = computed(() => new Set(
  (Array.isArray(props.expandedPaths) ? props.expandedPaths : [])
    .map((path) => normalizeTreePath(path))
    .filter(Boolean)
));

function normalizeTreePath(value = "") {
  return String(value || "").trim().replaceAll("\\", "/").replace(/^\.\/+/u, "");
}

function directoryExpandable(node = {}) {
  return Array.isArray(node.children) && node.children.length > 0;
}

function directoryKey(node = {}) {
  return normalizeTreePath(node.path || node.name || "");
}

function directoryOpen(node = {}) {
  return expandedPathSet.value.has(directoryKey(node));
}

function treeContainsPath(node = null, filePath = "") {
  const normalizedPath = normalizeTreePath(filePath);
  if (!node || !normalizedPath) {
    return false;
  }
  if (node.type === "file") {
    return normalizeTreePath(node.path) === normalizedPath;
  }
  return (Array.isArray(node.children) ? node.children : [])
    .some((child) => treeContainsPath(child, normalizedPath));
}

function handleDirectoryToggle(node = {}, event = {}) {
  if (event?.target !== event?.currentTarget) {
    return;
  }
  const key = directoryKey(node);
  if (!key) {
    return;
  }
  emit("directory-open-change", {
    open: event?.target?.open === true,
    path: key
  });
}

function showMore() {
  visibleNodeLimit.value = Math.min(nodes.value.length, visibleNodeLimit.value + DIRECTORY_BATCH_SIZE);
}

watch(() => props.selectedPath, (selectedPath = "") => {
  if (!selectedPath) {
    return;
  }
  nodes.value.forEach((child, index) => {
    if (treeContainsPath(child, selectedPath) && index >= visibleNodeLimit.value) {
      visibleNodeLimit.value = Math.min(
        nodes.value.length,
        Math.ceil((index + 1) / DIRECTORY_BATCH_SIZE) * DIRECTORY_BATCH_SIZE
      );
    }
  });
}, {
  immediate: true
});

watch(() => props.node?.path, () => {
  visibleNodeLimit.value = DIRECTORY_BATCH_SIZE;
});
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

.vibe64-source-tree__button,
.vibe64-source-tree__summary {
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
.vibe64-source-tree__summary:hover {
  background: rgba(var(--v-theme-primary), 0.08);
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

.vibe64-source-tree__button span,
.vibe64-source-tree__summary span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-tree__summary {
  cursor: pointer;
  list-style: none;
}

.vibe64-source-tree__chevron {
  color: rgba(var(--v-theme-on-surface), 0.58);
  flex: 0 0 auto;
  transition: transform 0.14s ease;
}

.vibe64-source-tree__directory[open] > .vibe64-source-tree__summary .vibe64-source-tree__chevron {
  transform: rotate(90deg);
}

.vibe64-source-tree__chevron-spacer {
  flex: 0 0 14px;
  height: 14px;
  width: 14px;
}

.vibe64-source-tree__summary::-webkit-details-marker {
  display: none;
}
</style>
