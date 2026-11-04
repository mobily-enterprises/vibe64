<script setup>
import { inject } from "vue";
import { VIBE64_AI_TASK_TRAY_KEY, elementSlotTarget } from "@/lib/vibe64AssistantHost.js";

/** @type {import("@/lib/vibe64AssistantHost.js").ShellSlot<HTMLElement>} */
const target = inject(VIBE64_AI_TASK_TRAY_KEY);
const setTarget = elementSlotTarget(target);
</script>

<template>
  <div :ref="setTarget" class="vibe64-ai-task-tray-target" />
</template>

<style scoped>
.vibe64-ai-task-tray-target { align-items: center; display: flex; flex: 0 1 auto; min-width: 0; }
</style>
