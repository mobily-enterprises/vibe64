<script setup>
import { computed } from "vue";
import { RouterView, useRoute } from "vue-router";
import ShellListDetail from "@jskit-ai/shell-web/client/components/ShellListDetail";
import ShellOutlet from "@jskit-ai/shell-web/client/components/ShellOutlet";

definePage({
  meta: {
    jskit: {
      title: "Settings"
    }
  }
});

const route = useRoute();
// The section list shows beside the open section on wide windows, and on its own at /home/settings.
const detailOpen = computed(() => !/\/settings\/?$/u.test(route.path));
</script>

<template>
  <ShellListDetail :detail-open="detailOpen">
    <template #list>
      <nav aria-label="Home settings sections">
        <v-list nav>
          <ShellOutlet target="home-settings:primary-menu" />
        </v-list>
      </nav>
    </template>
    <template #detail>
      <RouterView />
    </template>
  </ShellListDetail>
</template>
