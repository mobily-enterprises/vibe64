<template>
  <section class="vibe64-dashboard-page">
    <ArchivedVibe64Sessions
      empty-text="Archived chats will appear here after their active workspaces are removed."
      empty-title="No archived chats"
    >
      <template #title><h1 class="text-headline-small font-weight-bold ma-0">Session history</h1></template>
    </ArchivedVibe64Sessions>
  </section>
</template>

<script setup>
import ArchivedVibe64Sessions from "@/components/studio/ArchivedVibe64Sessions.vue";
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
