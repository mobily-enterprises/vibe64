<script setup>
import { RouterView } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
import Vibe64AuthGate from "@/components/auth/Vibe64AuthGate.vue";
</script>

<template>
  <v-app>
    <Vibe64AuthGate>
      <RouterView />
    </Vibe64AuthGate>
    <ShellErrorHost />
  </v-app>
</template>
