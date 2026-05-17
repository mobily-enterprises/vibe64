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

    <ProjectTypeGate
      @error="handleProjectTypeError"
      @missing="handleProjectTypeMissing"
      @ready="handleProjectTypeReady"
    >
      <template #default>
        <AiStudioSessionPanel @title-change="emitPageTitle" />
      </template>
    </ProjectTypeGate>
  </section>
</template>

<script setup>
import { onBeforeUnmount, ref } from "vue";
import AiStudioSessionPanel from "@/components/studio/AiStudioSessionPanel.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";

const pageError = ref("");
const emit = defineEmits(["page-title-change"]);

function emitPageTitle(title = "") {
  emit("page-title-change", String(title || "").trim());
}

function handleProjectTypeReady() {
  pageError.value = "";
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
