<template>
  <ul class="vibe64-source-tree">
    <li
      v-for="child in nodes"
      :key="child.path || child.name"
      class="vibe64-source-tree__item"
    >
      <button
        v-if="child.type === 'file'"
        class="vibe64-source-tree__button"
        :class="{ 'vibe64-source-tree__button--active': child.path === selectedPath }"
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
        open
      >
        <summary class="vibe64-source-tree__summary">
          <v-icon
            :icon="mdiFolderOutline"
            size="15"
          />
          <span>{{ child.name || "source" }}</span>
        </summary>
        <Vibe64SourceFileTree
          :node="child"
          :selected-path="selectedPath"
          @open-file="emit('open-file', $event)"
        />
      </details>
    </li>
  </ul>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiFileDocumentOutline,
  mdiFolderOutline
} from "@mdi/js";

const props = defineProps({
  node: {
    default: null,
    type: Object
  },
  selectedPath: {
    default: "",
    type: String
  }
});
const emit = defineEmits(["open-file"]);

const nodes = computed(() => Array.isArray(props.node?.children) ? props.node.children : []);
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
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  font: inherit;
  gap: 0.42rem;
  line-height: 1.2;
  min-height: 1.9rem;
  min-width: 0;
  padding: 0.28rem 0.38rem;
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
  font-weight: 700;
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
  font-weight: 650;
  list-style: none;
}

.vibe64-source-tree__summary::-webkit-details-marker {
  display: none;
}
</style>
