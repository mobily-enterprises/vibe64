<script setup>
import ShellSurfaceAwareMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellSurfaceAwareMenuLinkItem";

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
  }
});
</script>

<template>
  <ShellSurfaceAwareMenuLinkItem v-bind="props" />
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
  min-height: 40px;
}

:deep(.v-list-item--active) {
  background: rgba(var(--v-theme-primary), 0.12);
  border-left: 3px solid rgb(var(--v-theme-primary));
  color: rgb(var(--v-theme-primary));
  font-weight: 700;
}

:deep(.v-list-item--active .v-list-item__prepend),
:deep(.v-list-item--active .v-list-item-title) {
  color: rgb(var(--v-theme-primary));
}
</style>
