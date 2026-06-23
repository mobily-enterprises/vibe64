<template>
  <v-btn
    v-if="action.enabled === true"
    color="primary"
    :variant="variant"
    :disabled="busy"
    :loading="actions.runActionCommand.isRunning && actions.activeActionId === action.id"
    :prepend-icon="actions.actionIcon(action)"
    :title="action.label"
    @click="runAction"
  >
    {{ action.label }}
  </v-btn>
</template>

<script setup>
const props = defineProps({
  action: {
    default: () => ({}),
    type: Object
  },
  actions: {
    default: () => ({}),
    type: Object
  },
  busy: {
    default: false,
    type: Boolean
  },
  beforeRun: {
    default: async () => true,
    type: Function
  },
  variant: {
    default: "flat",
    type: String
  }
});

async function runAction() {
  if (await props.beforeRun(props.action) === false) {
    return;
  }
  await props.actions.runAction(props.action);
}
</script>
