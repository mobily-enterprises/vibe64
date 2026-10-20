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
        show-practice
      />
    </section>
  </StudioAppShellLayout>
</template>

<style scoped>
.vibe64-local-app-index__top {
  color: var(--v64-on-surface);
  font: var(--v64-type-title-lg);
  font-size: 1.25rem;
  letter-spacing: -0.01em;
  min-width: 0;
  padding-inline: var(--v64-space-4) var(--v64-space-3);
}

.vibe64-local-app-index {
  flex: 1 1 auto;
  min-height: 0;
  overflow-y: auto;
  padding: clamp(1rem, 3vw, 2rem);
}
</style>
