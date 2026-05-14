<template>
  <ArchivedIssueSessions
    archive="abandoned"
    description="Worktrees are removed; session branches remain recoverable in Git."
    empty-text="Abandoned sessions will appear here after their worktrees are removed."
    empty-title="No abandoned sessions"
    title="Abandoned Sessions"
  />
</template>

<script setup>
import ArchivedIssueSessions from "@/components/studio/ArchivedIssueSessions.vue";
</script>
