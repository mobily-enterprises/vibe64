<script setup>
import ShellTabLinkItem from "@jskit-ai/shell-web/client/components/ShellTabLinkItem";

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
  <ShellTabLinkItem v-bind="props" />
</template>

<style scoped>
:deep(.v-btn),
:deep(a),
:deep(button) {
  min-height: 38px;
}

:deep(.v-btn--active) {
  background: var(--studio-control-active-bg, #e7e7e7);
  color: var(--studio-control-text, #202124);
  font-weight: 560;
}
</style>
