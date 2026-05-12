<template>
  <section class="generated-ui-screen generated-ui-screen--app studio-screen d-flex flex-column ga-3">
    <v-alert
      v-if="currentAppError"
      type="error"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ currentAppError }}
    </v-alert>

    <v-progress-linear
      v-if="(gateLoading || currentAppLoading) && !currentApp"
      color="primary"
      height="6"
      indeterminate
      rounded
    />

    <IssueSessionPanel v-if="currentApp" />

    <v-sheet
      v-if="!gateLoading && !currentAppLoading && !currentApp && !currentAppError"
      rounded="lg"
      border
      class="studio-screen__panel"
    >
      <h2 class="text-subtitle-1 mb-2">Current app unavailable</h2>
      <p class="text-body-2 text-medium-emphasis mb-0">
        The inspection endpoint did not return project metadata.
      </p>
    </v-sheet>
  </section>
</template>

<script setup>
import { onMounted, ref } from "vue";
import {
  readCurrentApp
} from "@/lib/studioApi.js";
import IssueSessionPanel from "@/components/studio/IssueSessionPanel.vue";

const gateLoading = ref(false);
const currentApp = ref(null);
const currentAppLoading = ref(false);
const currentAppError = ref("");

async function loadCurrentApp() {
  currentAppLoading.value = true;
  currentAppError.value = "";
  try {
    currentApp.value = await readCurrentApp();
  } catch (loadError) {
    currentAppError.value = String(loadError?.message || loadError || "Current app inspection failed.");
  } finally {
    currentAppLoading.value = false;
  }
}

async function loadHome() {
  gateLoading.value = true;
  currentAppError.value = "";
  try {
    await loadCurrentApp();
  } catch (loadError) {
    currentAppError.value = String(loadError?.message || loadError || "Current app inspection failed.");
  } finally {
    gateLoading.value = false;
  }
}

onMounted(() => {
  void loadHome();
});
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0.5rem 0.625rem;
}

.studio-screen {
  margin-inline: auto;
  max-width: min(96rem, calc(100vw - 2rem));
}

.studio-screen__title {
  font-size: var(--generated-ui-screen-title-size);
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.05;
  margin: 0 0 0.15rem;
}

.studio-screen__panel {
  padding: var(--generated-ui-screen-panel-padding);
}

@media (max-width: 520px) {
  .studio-screen {
    max-width: 100%;
  }

}
</style>
