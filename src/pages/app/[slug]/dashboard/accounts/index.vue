<template>
  <section class="vibe64-dashboard-page">
    <AccountsSetup :show-continue="false" />
  </section>
</template>

<script setup>
import AccountsSetup from "@/components/studio/AccountsSetup.vue";
</script>

<style scoped>
.vibe64-dashboard-page {
  min-width: 0;
}
</style>
