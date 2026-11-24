<route lang="json">
{
  "meta": {
    "jskit": {
      "surface": "app"
    }
  }
}
</route>

<script setup>
import ShellLayout from "@/components/ShellLayout.vue";
import Vibe64CrashesScreen from "@/components/studio/Vibe64CrashesScreen.vue";

// /app/crashes (both hosts): the crash banner's See crashes, outside any project, as crashes belong to the server.
</script>

<template>
  <ShellLayout title="Crashes">
    <Vibe64CrashesScreen />
  </ShellLayout>
</template>
