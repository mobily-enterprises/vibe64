<script setup>
import { RouterView } from "vue-router";
import ShellErrorHost from "@jskit-ai/shell-web/client/components/ShellErrorHost";
import Vibe64AuthGate from "@/components/auth/Vibe64AuthGate.vue";
import Vibe64AsyncModuleErrorHost from "@/components/common/Vibe64AsyncModuleErrorHost.vue";
</script>

<template>
  <v-app>
    <Vibe64AuthGate>
      <RouterView />
    </Vibe64AuthGate>
    <ShellErrorHost />
    <Vibe64AsyncModuleErrorHost />
  </v-app>
</template>
