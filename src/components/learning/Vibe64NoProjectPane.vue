<script setup>
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";
import Vibe64EmptySessionLayout from "@/components/studio/Vibe64EmptySessionLayout.vue";
import Vibe64SessionFrame from "@/components/studio/Vibe64SessionFrame.vue";

// No project selected: Learn mode without a practice project (/app/learning).
// The session area a project shows with no session open, saying so in each
// pane; the Dashboard keeps its section menu. Both hosts' project pages
// render it.
defineProps({
  chatCollapsed: { type: Boolean, default: false },
  projectPane: { type: String, default: "preview" },
  section: { type: String, default: "" }
});
defineEmits(["select"]);
</script>

<template>
  <Vibe64SessionFrame
    class="studio-screen__no-project"
    :chat-collapsed="chatCollapsed"
    data-test="no-project-pane"
  >
    <Vibe64EmptySessionLayout
      :chat-collapsed="chatCollapsed"
      :dashboard="projectPane === 'dashboard'"
      hint="No project selected"
      preview-title="No project selected"
    >
      <template #dashboard>
        <Vibe64DashboardShell
          no-project
          :section="section"
          @select="$emit('select', $event)"
        >
          <p class="studio-screen__no-project-text">No project selected</p>
        </Vibe64DashboardShell>
      </template>
    </Vibe64EmptySessionLayout>
  </Vibe64SessionFrame>
</template>

<style scoped>
.studio-screen__no-project {
  flex: 1 1 auto;
  min-height: 0;
}

.studio-screen__no-project-text {
  color: var(--v64-on-surface-variant);
  margin: 0;
  padding: var(--v64-space-4);
}
</style>
