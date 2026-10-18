<template>
  <section class="vibe64-dashboard-page">
    <ArchivedVibe64Sessions
      empty-text="Archived chats will appear here after their active workspaces are removed."
      empty-title="No archived chats"
    >
      <template #title>
        <Vibe64DashboardPageHeader
          description="Archived chats and their conversations."
          :icon="mdiHistory"
          title="Session history"
        />
      </template>
    </ArchivedVibe64Sessions>
  </section>
</template>

<script setup>
import { mdiHistory } from "@mdi/js";
import ArchivedVibe64Sessions from "@/components/studio/ArchivedVibe64Sessions.vue";
import Vibe64DashboardPageHeader from "@/components/studio/Vibe64DashboardPageHeader.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  display: grid;
  gap: 0.75rem;
  margin-inline: auto;
  max-width: 68rem;
  min-width: 0;
  width: 100%;
}

</style>
