<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-screen d-flex flex-column ga-3">
    <v-alert
      v-if="pageError"
      type="error"
      variant="tonal"
      border="start"
      class="studio-screen__alert"
    >
      {{ pageError }}
    </v-alert>

    <div class="studio-screen__gate-scroll">
      <ProjectSelectionGate
        @error="handleProjectSelectionError"
        @missing="handleProjectSelectionMissing"
        @ready="handleProjectSelectionReady"
      >
        <template #default="projectSelectionSlotProps">
          <ProjectTypeGate
            :configure-project="configureProject"
            @error="handleProjectTypeError"
            @missing="handleProjectTypeMissing"
            @ready="handleProjectTypeReady"
          >
            <template #default>
              <SetupReadinessGate
                :cache-key="projectSelectionSlotProps?.projectSelection?.targetRoot || ''"
                :non-blocking-stage-ids="['accounts']"
              >
                <AccountsReadinessGate :cache-key="projectSelectionSlotProps?.projectSelection?.targetRoot || ''">
                  <Vibe64SessionPanel @title-change="emitPageTitle" />
                </AccountsReadinessGate>
              </SetupReadinessGate>
            </template>
          </ProjectTypeGate>
        </template>
      </ProjectSelectionGate>
    </div>
  </section>
</template>

<script setup>
import { computed, onBeforeUnmount, ref } from "vue";
import { useRoute } from "vue-router";
import Vibe64SessionPanel from "@/components/studio/Vibe64SessionPanel.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import SetupReadinessGate from "@/components/studio/SetupReadinessGate.vue";
import AccountsReadinessGate from "@/components/studio/AccountsReadinessGate.vue";

const pageError = ref("");
const emit = defineEmits(["page-title-change"]);
const route = useRoute();
const configureProject = computed(() => route.query.configure === "project");

function emitPageTitle(title = "") {
  emit("page-title-change", String(title || "").trim());
}

function handleProjectTypeReady() {
  pageError.value = "";
}

function handleProjectSelectionReady() {
  pageError.value = "";
  emitPageTitle();
}

function handleProjectSelectionMissing() {
  pageError.value = "";
  emitPageTitle("Choose project");
}

function handleProjectSelectionError(error) {
  pageError.value = String(error || "");
  emitPageTitle();
}

function handleProjectTypeMissing(project = {}) {
  pageError.value = "";
  emitPageTitle(project?.projectType?.ready === true ? "Configure project" : "Choose project type");
}

function handleProjectTypeError(error) {
  pageError.value = String(error || "");
  emitPageTitle();
}

onBeforeUnmount(() => {
  emitPageTitle();
});
</script>

<style scoped>
.generated-ui-screen {
  --generated-ui-screen-title-size: clamp(1.2rem, 1.7vw, 1.55rem);
  --generated-ui-screen-panel-padding: 0;
}

.studio-screen {
  margin-inline: 0;
  max-width: none;
  min-height: 0;
  width: 100%;
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

@media (min-width: 981px) {
  .studio-screen {
    height:
      calc(
        100dvh
        - var(--v-layout-top, 0px)
        - var(--v-layout-bottom, 0px)
        - 1.25rem
        - env(safe-area-inset-bottom, 0px)
      );
    overflow: hidden;
  }

  .studio-screen__gate-scroll {
    display: flex;
    flex-direction: column;
    flex: 1 1 auto;
    min-height: 0;
    overflow: hidden;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate) {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.project-selection-gate) {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate > .setup-readiness-gate) {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.accounts-readiness-gate),
  .studio-screen__gate-scroll :deep(.accounts-readiness-gate__content) {
    display: flex;
    flex: 1 1 auto;
    flex-direction: column;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate .studio-ai-sessions) {
    flex: 1 1 auto;
    min-height: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-gate .studio-ai-sessions--autopilot) {
    padding: 0;
  }

  .studio-screen__gate-scroll :deep(.project-type-setup),
  .studio-screen__gate-scroll :deep(.project-config-setup) {
    flex: 1 1 auto;
    min-height: 0;
    overflow-y: auto;
  }
}
</style>
