<script setup>
import { inject } from "vue";
import { VIBE64_AI_TASK_TRAY_KEY } from "@/lib/vibe64AssistantHost.js";

const target = inject(VIBE64_AI_TASK_TRAY_KEY, null);
const enabled = Boolean(target);
let currentElement;
function setTarget(element) {
  if (element) target.value = element;
  else if (target.value === currentElement) target.value = null;
  currentElement = element;
}
</script>

<template>
  <div v-if="enabled" :ref="setTarget" class="vibe64-ai-task-tray-target" />
</template>

<style scoped>
.vibe64-ai-task-tray-target { align-items: center; display: flex; flex: 0 1 auto; min-width: 0; }
</style>
