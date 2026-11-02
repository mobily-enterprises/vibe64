<template>
  <v-menu
    v-if="previewIssueVisible"
    :close-on-content-click="false"
    location="bottom end"
  >
    <template #activator="{ props: menuProps }">
      <v-btn
        v-bind="menuProps"
        class="vibe64-launch-controls__attention-button"
        color="warning"
        :icon="mdiAlertCircleOutline"
        size="small"
        :title="previewIssue.title"
        variant="text"
      />
    </template>

    <v-card class="vibe64-launch-controls__attention-menu">
      <v-card-text class="vibe64-launch-controls__attention-body">
        <v-icon
          class="vibe64-launch-controls__attention-icon"
          :icon="mdiAlertCircleOutline"
          size="28"
        />
        <div>
          <strong>{{ previewIssue.title }}</strong>
          <p>{{ previewIssue.message }}</p>
        </div>
      </v-card-text>

      <v-card-actions class="vibe64-launch-controls__attention-actions">
        <v-btn
          v-if="previewCanShowLog"
          :prepend-icon="mdiConsoleLine"
          size="small"
          variant="tonal"
          @click="showLaunchLog"
        >
          Show log
        </v-btn>
        <v-btn
          v-if="previewCanRestart && embeddedStartTarget"
          :disabled="operationBusy"
          :prepend-icon="mdiRefresh"
          size="small"
          variant="tonal"
          @click="recoverEmbeddedPreview"
        >
          Restart preview
        </v-btn>
        <v-btn
          v-if="terminalCanRetry && !(previewCanRestart && embeddedStartTarget)"
          :disabled="operationBusy"
          :icon="mdiRefresh"
          size="small"
          title="Retry preview"
          variant="text"
          @click="retryTerminal"
        />
      </v-card-actions>
    </v-card>
  </v-menu>
</template>

<script setup>
// The Preview's current problem, with the log, restart and retry it allows.
import {
  mdiAlertCircleOutline,
  mdiConsoleLine,
  mdiRefresh
} from "@mdi/js";

const props = defineProps({
  surface: {
    required: true,
    type: /** @type {import("vue").PropType<ReturnType<typeof import("@/composables/useVibe64OutputControlsSurface.js").useVibe64OutputControlsSurface>>} */ (Object)
  }
});

const {
  embeddedStartTarget,
  operationBusy,
  previewCanRestart,
  previewCanShowLog,
  previewIssue,
  previewIssueVisible,
  recoverEmbeddedPreview,
  retryTerminal,
  showLaunchLog,
  terminalCanRetry
} = props.surface;
</script>

<style scoped>
.vibe64-launch-controls__attention-button {
  color: rgb(var(--v-theme-warning));
}

.vibe64-launch-controls__attention-menu {
  max-width: min(25rem, calc(100vw - 2rem));
}

.vibe64-launch-controls__attention-body {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  padding-bottom: 0.35rem;
}

.vibe64-launch-controls__attention-body strong {
  color: rgba(var(--v-theme-on-surface), 0.9);
  display: block;
  font-size: 0.95rem;
  line-height: 1.35;
}

.vibe64-launch-controls__attention-body p {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.86rem;
  line-height: 1.45;
  margin: 0.25rem 0 0;
  overflow-wrap: anywhere;
}

.vibe64-launch-controls__attention-icon {
  color: rgb(var(--v-theme-warning));
  flex: 0 0 auto;
  margin-top: 0.08rem;
}

.vibe64-launch-controls__attention-actions {
  gap: 0.5rem;
  justify-content: flex-end;
  padding: 0 1rem 0.9rem;
}
</style>
