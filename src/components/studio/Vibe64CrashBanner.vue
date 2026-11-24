<template>
  <!-- Above the app bar on every page, taking its own room in the layout, until the crash is acknowledged. -->
  <v-layout-item
    v-if="visible"
    class="vibe64-crash-banner-item"
    model-value
    name="vibe64-crash-banner"
    :order="-1"
    position="top"
    :size="height"
  >
    <div ref="banner">
      <v-alert
        v-if="canAcknowledge"
        class="vibe64-crash-banner"
        data-testid="vibe64-crash-banner"
        density="compact"
        rounded="0"
        type="error"
        variant="flat"
      >
        <div class="vibe64-crash-banner__body">
          <p class="vibe64-crash-banner__text">
            <strong>{{ headline }}</strong>
            <span v-if="turnsText"> {{ turnsText }}</span>
            <span v-if="actionError" class="vibe64-crash-banner__error"> {{ actionError }}</span>
          </p>
          <div class="vibe64-crash-banner__actions">
            <v-btn :to="VIBE64_CRASHES_PATH" size="small" variant="outlined">See crashes</v-btn>
            <v-btn size="small" variant="outlined" @click="copyReport(latest)">
              {{ copiedId === latest.id ? "Copied" : "Copy for a bug report" }}
            </v-btn>
            <v-btn
              class="vibe64-crash-banner__acknowledge"
              :loading="acknowledging"
              size="small"
              variant="flat"
              @click="acknowledge(latest.id)"
            >
              Acknowledge
            </v-btn>
          </div>
        </div>
      </v-alert>
      <div v-else class="vibe64-crash-line bg-error" data-testid="vibe64-crash-line" role="status">
        {{ memberLine }}
      </div>
    </div>
  </v-layout-item>
</template>

<script setup>
import { computed, onBeforeUnmount, ref, watch } from "vue";
import { crashTurnsText } from "@local/vibe64-core/shared/crashText";
import { VIBE64_CRASHES_PATH, useVibe64CrashSummary } from "@/composables/useVibe64Crashes.js";
import { crashBannerHeadline, crashMemberLine } from "@/lib/vibe64CrashPresentation.js";

// After a crash, every page shows it until the workspace owner acknowledges it: the owner (or the person at their
// own computer) gets the error with See crashes, Copy for a bug report and Acknowledge; everyone else a smaller red
// line without the error. A new crash after an acknowledgement brings it back, with the count when there are several.
const {
  acknowledge,
  acknowledging,
  actionError,
  canAcknowledge,
  copiedId,
  copyReport,
  latest,
  unacknowledged,
  visible
} = useVibe64CrashSummary();

const headline = computed(() => (latest.value ? crashBannerHeadline(latest.value, unacknowledged.value) : ""));
const turnsText = computed(() => (latest.value ? crashTurnsText(latest.value) : ""));
const memberLine = computed(() => (latest.value ? crashMemberLine(latest.value, unacknowledged.value) : ""));

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
.vibe64-crash-banner__body {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem 1rem;
  justify-content: space-between;
}

.vibe64-crash-banner__text {
  flex: 1 1 24rem;
  margin: 0;
  min-width: 0;
  overflow-wrap: anywhere;
}

.vibe64-crash-banner__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.vibe64-crash-banner__acknowledge {
  background: rgb(var(--v-theme-on-error)) !important;
  color: rgb(var(--v-theme-error)) !important;
}

.vibe64-crash-line {
  font-size: 0.8125rem;
  line-height: 1.25rem;
  overflow-wrap: anywhere;
  padding: 0.25rem 1rem;
}
</style>
