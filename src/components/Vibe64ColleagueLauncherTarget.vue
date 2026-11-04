<script setup>
import { inject } from "vue";
import { VIBE64_COLLEAGUE_LAUNCHER_KEY, elementSlotTarget } from "@/lib/vibe64AssistantHost.js";

/** @type {import("@/lib/vibe64AssistantHost.js").ShellSlot<HTMLElement>} */
const target = inject(VIBE64_COLLEAGUE_LAUNCHER_KEY);
const setTarget = elementSlotTarget(target);
</script>

<template>
  <div :ref="setTarget" class="vibe64-colleague-launcher-target" />
</template>

<style scoped>
.vibe64-colleague-launcher-target { display: flex; flex: 0 0 auto; min-width: 48px; height: 48px; }
</style>
