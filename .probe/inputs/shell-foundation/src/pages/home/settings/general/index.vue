<script setup>
import { computed } from "vue";
import { useShellLayoutState } from "@jskit-ai/shell-web/client/composables/useShellLayoutState";

definePage({
  meta: {
    jskit: {
      title: "General",
      parent: "/settings"
    }
  }
});

const { drawerDefaultOpen, setDrawerDefaultOpen } = useShellLayoutState();

const drawerDefaultOpenModel = computed({
  get() {
    return drawerDefaultOpen.value;
  },
  set(value) {
    setDrawerDefaultOpen(Boolean(value));
  }
});
</script>

<template>
  <v-card>
    <v-list lines="three">
      <v-list-item
        title="Start with expanded navigation on wider screens"
        subtitle="On wider screens, collapsed navigation remains available as a rail. Phone layouts close the drawer and keep primary navigation in the bottom bar."
      >
        <template #append>
          <v-switch
            v-model="drawerDefaultOpenModel"
            aria-label="Start with expanded navigation on wider screens"
          />
        </template>
      </v-list-item>
    </v-list>
  </v-card>
</template>
