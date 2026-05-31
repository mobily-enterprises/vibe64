<template>
  <section class="generated-ui-screen generated-ui-screen--studio studio-target-scripts">
    <ProjectSelectionGate>
      <ProjectTypeGate>
        <template #default>
          <SetupReadinessGate>
            <TargetScriptsPanel :mode="targetScriptsMode" />
          </SetupReadinessGate>
        </template>
      </ProjectTypeGate>
    </ProjectSelectionGate>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import TargetScriptsPanel from "@/components/studio/TargetScriptsPanel.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import ProjectTypeGate from "@/components/studio/ProjectTypeGate.vue";
import SetupReadinessGate from "@/components/studio/SetupReadinessGate.vue";

const route = useRoute();
const targetScriptsMode = computed(() => route.query.mode === "inspect" ? "inspect" : "autopilot");
</script>

<style scoped>
.studio-target-scripts {
  margin-inline: auto;
  max-width: min(86rem, calc(100vw - 2rem));
  width: 100%;
}

@media (max-width: 640px) {
  .studio-target-scripts {
    max-width: min(100%, calc(100vw - 1rem));
  }
}
</style>
