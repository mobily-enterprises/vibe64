<script setup>
import { inject } from "vue";
import { VIBE64_COLLEAGUE_LAUNCHER_KEY } from "@/lib/vibe64AssistantHost.js";

const target = inject(VIBE64_COLLEAGUE_LAUNCHER_KEY, null);
const enabled = Boolean(target);
let currentElement;
function setTarget(element) {
  if (element) target.value = element;
  else if (target.value === currentElement) target.value = null;
  currentElement = element;
}
</script>

<template>
  <div v-if="enabled" :ref="setTarget" class="vibe64-colleague-launcher-target" />
</template>

<style scoped>
.vibe64-colleague-launcher-target { display: flex; flex: 0 0 48px; width: 48px; height: 48px; }
</style>
