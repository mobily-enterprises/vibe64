<script setup>
import Vibe64DashboardShell from "@/components/studio/Vibe64DashboardShell.vue";

// No project selected: Learn mode without a practice project (/app/learning).
// The same chat column and project pane as a project, each saying so; the
// Dashboard keeps its section menu. Both hosts' project pages render it.
defineProps({
  chatCollapsed: { type: Boolean, default: false },
  projectPane: { type: String, default: "preview" },
  section: { type: String, default: "" }
});
defineEmits(["select"]);
</script>

<template>
  <div
    class="studio-screen__no-project"
    :class="{ 'studio-screen__no-project--chat-collapsed': chatCollapsed }"
    data-test="no-project-pane"
  >
    <section class="studio-screen__no-project-chat" aria-label="Session chat">
      <p class="studio-screen__no-project-text">No project selected</p>
    </section>
    <section class="studio-screen__no-project-panel" aria-label="Project">
      <Vibe64DashboardShell
        v-if="projectPane === 'dashboard'"
        no-project
        :section="section"
        @select="$emit('select', $event)"
      >
        <p class="studio-screen__no-project-text">No project selected</p>
      </Vibe64DashboardShell>
      <p v-else class="studio-screen__no-project-text" data-vibe64-guide-pane="preview">No project selected</p>
    </section>
  </div>
</template>

<style scoped>
.studio-screen__no-project {
  display: grid;
  flex: 1 1 auto;
  gap: var(--studio-home-project-gap);
  grid-template-columns: var(--studio-home-chat-column-width) minmax(0, 1fr);
  min-height: 0;
}

.studio-screen__no-project--chat-collapsed {
  grid-template-columns: minmax(0, 1fr);
}

.studio-screen__no-project--chat-collapsed .studio-screen__no-project-chat {
  display: none;
}

.studio-screen__no-project-chat,
.studio-screen__no-project-panel {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-theme-outline), 0.14);
  border-radius: 14px;
  display: grid;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-screen__no-project-panel > .studio-screen__no-project-text,
.studio-screen__no-project-chat > .studio-screen__no-project-text {
  align-self: center;
  justify-self: center;
}

.studio-screen__no-project-text {
  color: var(--v64-on-surface-variant);
  margin: 0;
  padding: var(--v64-space-4);
}

@media (max-width: 980px) {
  .studio-screen__no-project {
    grid-template-columns: minmax(0, 1fr);
  }

  .studio-screen__no-project:not(.studio-screen__no-project--chat-collapsed) .studio-screen__no-project-panel {
    display: none;
  }
}
</style>
