<script setup>
import ShellMenuLinkItem from "@jskit-ai/shell-web/client/components/ShellMenuLinkItem";

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
  <ShellMenuLinkItem v-bind="props" />
</template>

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
