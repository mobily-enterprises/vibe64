<template>
  <!-- Above the app bar on every page while the host's planned restart is near, and once after it. -->
  <v-layout-item
    v-if="active || restarted"
    class="vibe64-planned-restart-banner-item"
    model-value
    name="vibe64-planned-restart-banner"
    :order="-2"
    position="top"
    :size="height"
  >
    <div ref="banner">
      <v-alert
        class="vibe64-planned-restart-banner"
        :data-testid="active ? 'vibe64-planned-restart-banner' : 'vibe64-planned-restart-after'"
        density="compact"
        rounded="0"
        :type="active ? 'warning' : 'info'"
        variant="flat"
      >
        <div class="vibe64-planned-restart-banner__body">
          <p class="vibe64-planned-restart-banner__text" role="status">{{ text }}</p>
          <v-btn v-if="!active" size="small" variant="outlined" @click="dismissRestarted">Dismiss</v-btn>
        </div>
      </v-alert>
    </div>
  </v-layout-item>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { usePlannedRestart, usePlannedRestartWatch } from "@/composables/usePlannedRestart.js";
import { plannedRestartAfterText, plannedRestartHeadline } from "@/lib/vibe64PlannedRestartPresentation.js";

// Every open editor shows the restart's time, a countdown and its reason; after the restart, once, what it stopped.
usePlannedRestartWatch();
const { active, dismissRestarted, notice, now, restarted } = usePlannedRestart();

const text = computed(() => {
  if (active.value) return plannedRestartHeadline(notice.value, now.value);
  return restarted.value ? plannedRestartAfterText(restarted.value) : "";
});

// The layout gives the banner the room it takes, which grows when its words wrap on a narrow screen.
const banner = ref(null);
const height = ref(48);
let observer = null;
watch(banner, (element) => {
  observer?.disconnect();
  observer = null;
  if (!element || typeof ResizeObserver === "undefined") return;
  observer = new ResizeObserver(() => {
    height.value = Math.ceil(element.getBoundingClientRect().height) || height.value;
  });
  observer.observe(element);
});
onBeforeUnmount(() => observer?.disconnect());
</script>

<style scoped>
.vibe64-planned-restart-banner__body {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  justify-content: space-between;
}

.vibe64-planned-restart-banner__text {
  flex: 1 1 24rem;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
