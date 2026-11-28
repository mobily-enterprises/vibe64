<template>
  <!-- Above the app bar on every page: while the host's planned restart is near (amber), once after it (green), and after
       an update that changed the page's code (blue). One notice for each: JSKIT's offer to reload after an update is
       shown here, and while the page says "Updating…" this banner steps aside. -->
  <v-layout-item
    v-if="kind"
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
        :data-testid="KINDS[kind].testId"
        density="compact"
        rounded="0"
        :type="KINDS[kind].type"
        variant="flat"
      >
        <div class="vibe64-planned-restart-banner__body">
          <p class="vibe64-planned-restart-banner__text" role="status">{{ text }}</p>
          <!-- On the banner's own colour its buttons draw in its on-colour, as its words do: Reload filled with it,
               Dismiss outlined in it. -->
          <div v-if="kind !== 'notice'" class="vibe64-planned-restart-banner__actions">
            <v-btn
              v-if="updateOffer"
              :color="onColour"
              size="small"
              :style="{ color: colour }"
              variant="flat"
              @click="reloadForClientUpdate"
            >
              Reload
            </v-btn>
            <v-btn :color="onColour" size="small" variant="outlined" @click="dismissRestarted">Dismiss</v-btn>
          </div>
        </div>
      </v-alert>
    </div>
  </v-layout-item>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { usePlannedRestart, usePlannedRestartWatch } from "@/composables/usePlannedRestart.js";
import { reloadForClientUpdate } from "@/lib/vibe64ClientUpdateOffer.js";
import { plannedRestartAfterText, plannedRestartHeadline } from "@/lib/vibe64PlannedRestartPresentation.js";

// Every open editor shows the restart's time, a countdown and its reason; after the restart, once, what it stopped,
// with Reload when the update changed the page's code; and after an update without a planned restart, JSKIT's offer
// to reload.
usePlannedRestartWatch();
const { active, dismissRestarted, notice, now, restarted, updateOffer, updating } = usePlannedRestart();

const KINDS = Object.freeze({
  notice: Object.freeze({ testId: "vibe64-planned-restart-banner", type: "warning" }),
  restarted: Object.freeze({ testId: "vibe64-planned-restart-after", type: "success" }),
  updated: Object.freeze({ testId: "vibe64-client-update", type: "info" })
});

// What the banner shows, if anything: "Updating…" (the shell's banner) is the one notice while the editor does not
// answer, and the countdown, the message after the restart and the offer to reload take turns in that order.
const kind = computed(() => {
  if (updating.value) return "";
  if (active.value) return "notice";
  if (restarted.value) return "restarted";
  return updateOffer.value ? "updated" : "";
});
const colour = computed(() => `rgb(var(--v-theme-${KINDS[kind.value]?.type || "surface"}))`);
const onColour = computed(() => `rgb(var(--v-theme-on-${KINDS[kind.value]?.type || "surface"}))`);

const text = computed(() => {
  if (kind.value === "notice") return plannedRestartHeadline(notice.value, now.value);
  if (kind.value === "restarted") return plannedRestartAfterText(restarted.value, { updated: Boolean(updateOffer.value) });
  return kind.value === "updated" ? updateOffer.value.message : "";
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

.vibe64-planned-restart-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-planned-restart-banner__text {
  flex: 1 1 24rem;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}
</style>
