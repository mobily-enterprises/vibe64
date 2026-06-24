<script setup>
import StudioAppShellLayout from "@/components/StudioAppShellLayout.vue";
import ProjectSelectionGate from "@/components/studio/ProjectSelectionGate.vue";
import Vibe64AuthSettingsButton from "@/components/studio/Vibe64AuthSettingsButton.vue";
</script>

<template>
  <StudioAppShellLayout>
    <template #top-left>
      <div class="vibe64-local-app-index__top">Projects</div>
    </template>
    <template #top-right>
      <Vibe64AuthSettingsButton />
    </template>

    <section class="vibe64-local-app-index">
      <ProjectSelectionGate
        force-picker
        navigate-on-select
      />
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-local-app-index__top {
  color: rgb(var(--v-theme-on-surface));
  font-size: 1rem;
  font-weight: 720;
  min-width: 0;
  padding-left: 1rem;
}

.vibe64-local-app-index {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(1rem, 3vw, 2rem);
}
</style>
