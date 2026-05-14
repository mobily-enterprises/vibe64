<template>
  <ArchivedIssueSessions
    archive="completed"
    description="Finished sessions keep their reports, decisions, issue links, and PR outcome."
    empty-text="Completed sessions will appear here after a session is finalized."
    empty-title="No completed sessions"
    title="Completed Sessions"
  />
</template>

<script setup>
import ArchivedIssueSessions from "@/components/studio/ArchivedIssueSessions.vue";
</script>
