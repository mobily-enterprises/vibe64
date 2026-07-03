<template>
  <v-menu
    :close-on-content-click="false"
    location="end top"
    transition="scale-transition"
  >
    <template #activator="{ props: groupMenuProps }">
      <button
        v-bind="groupMenuProps"
        class="vibe64-composer-prompt-menu-group__activator"
        type="button"
      >
        <v-icon :icon="mdiFileDocumentOutline" size="18" />
        <span>{{ group.label }}</span>
        <v-icon
          class="vibe64-composer-prompt-menu-group__chevron"
          :icon="mdiChevronRight"
          size="18"
        />
      </button>
    </template>

    <div
      class="vibe64-composer-prompt-menu-group__menu"
      :aria-label="`${group.label} prompt templates`"
    >
      <Vibe64ComposerPromptMenuItem
        v-for="item in group.items"
        :key="item.id"
        :disabled="isItemDisabled(item)"
        :item="item"
        @insert-text="$emit('insert-text', $event)"
        @select="$emit('select', $event)"
      />
      <Vibe64ComposerPromptMenuGroup
        v-for="subgroup in group.groups"
        :key="subgroup.key"
        :group="subgroup"
        :item-disabled="isItemDisabled"
        @insert-text="$emit('insert-text', $event)"
        @select="$emit('select', $event)"
      />
    </div>
  </v-menu>
</template>

<script setup>
import {
  mdiChevronRight,
  mdiFileDocumentOutline
} from "@mdi/js";
import Vibe64ComposerPromptMenuItem from "@/components/studio/vibe64-session/Vibe64ComposerPromptMenuItem.vue";

defineOptions({
  name: "Vibe64ComposerPromptMenuGroup"
});

defineEmits([
  "insert-text",
  "select"
]);

const props = defineProps({
  group: {
    default: () => ({
      groups: [],
      items: [],
      label: ""
    }),
    type: Object
  },
  itemDisabled: {
    default: () => false,
    type: Function
  }
});

function isItemDisabled(item = {}) {
  return props.itemDisabled(item);
}
</script>

<style scoped>
.vibe64-composer-prompt-menu-group__activator {
  align-items: center;
  appearance: none;
  background: rgba(var(--v-theme-on-surface), 0.035);
  border: 1px solid rgba(var(--v-theme-outline), 0.12);
  border-radius: 8px;
  color: rgba(var(--v-theme-on-surface), 0.84);
  display: inline-flex;
  font: inherit;
  gap: 0.48rem;
  justify-content: flex-start;
  line-height: 1.2;
  min-height: 2rem;
  min-width: 0;
  padding: 0.34rem 0.52rem;
  text-align: left;
  width: 100%;
}

.vibe64-composer-prompt-menu-group__activator span {
  flex: 1 1 auto;
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-composer-prompt-menu-group__activator:hover {
  background: rgba(var(--v-theme-primary), 0.07);
  border-color: rgba(var(--v-theme-primary), 0.2);
}

.vibe64-composer-prompt-menu-group__chevron {
  margin-left: auto;
  opacity: 0.62;
}

.vibe64-composer-prompt-menu-group__menu {
  display: grid;
  gap: 0.28rem;
  min-width: min(15rem, calc(100vw - 2rem));
}
</style>
