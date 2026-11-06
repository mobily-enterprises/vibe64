<script setup>
import ShellSurfaceAwareMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellSurfaceAwareMenuLinkItem";
import { computed } from "vue";

const props = defineProps({
  label: {
    type: String,
    default: ""
  },
  to: {
    type: String,
    default: ""
  },
  icon: {
    type: String,
    default: ""
  },
  surface: {
    type: String,
    default: ""
  },
  scopedSuffix: {
    type: String,
    default: "/"
  },
  unscopedSuffix: {
    type: String,
    default: "/"
  },
  disabled: {
    type: Boolean,
    default: false
  },
  exact: {
    type: Boolean,
    default: false
  },
  // A lesson teacher's overlay points at this real section by its guide id.
  guideId: {
    type: String,
    default: ""
  }
});
const linkProps = computed(() => {
  const { guideId, ...value } = props;
  return value;
});
</script>

<template>
  <div v-if="guideId" class="surface-aware-menu-link-guide" :data-vibe64-guide="guideId">
    <ShellSurfaceAwareMenuLinkItem v-bind="linkProps" />
  </div>
  <ShellSurfaceAwareMenuLinkItem v-else v-bind="linkProps" />
</template>

<style>
.v-list-item.v-list-item--nav {
  min-height: 40px;
}
</style>

<style scoped>
:deep(.v-list-item),
:deep(a),
:deep(button) {
  min-height: 38px;
}

:deep(.v-list-item--active) {
  background: var(--studio-control-active-bg, rgb(var(--v-theme-secondary-container)));
  border-left: 0;
  color: var(--studio-control-text, rgb(var(--v-theme-on-surface)));
  font-weight: 560;
}

:deep(.v-list-item--active .v-list-item__prepend),
:deep(.v-list-item--active .v-list-item-title) {
  color: var(--studio-control-text, rgb(var(--v-theme-on-surface)));
}
</style>
