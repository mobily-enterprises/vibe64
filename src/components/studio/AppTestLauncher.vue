<template>
  <div class="app-test-launcher">
    <v-btn
      color="primary"
      variant="tonal"
      :prepend-icon="mdiPlayCircleOutline"
      @click="launchTargetAppTest"
    >
      Test app
    </v-btn>

    <v-dialog v-model="dialogOpen" max-width="min(94vw, 72rem)" persistent>
      <AppTestTerminal
        ref="terminalRef"
        scope="target"
        title="Test target app"
        :visible="dialogOpen"
        @closed="dialogOpen = false"
      />
    </v-dialog>
  </div>
</template>

<script setup>
import { nextTick, ref } from "vue";
import { mdiPlayCircleOutline } from "@mdi/js";
import AppTestTerminal from "@/components/studio/AppTestTerminal.vue";

const dialogOpen = ref(false);
const terminalRef = ref(null);

async function launchTargetAppTest() {
  const popupWindow = window.open("", "_blank");
  dialogOpen.value = true;
  await nextTick();
  await terminalRef.value?.start?.({
    popupWindow
  });
}
</script>

<style scoped>
.app-test-launcher {
  display: flex;
  justify-content: flex-end;
  min-width: 0;
}
</style>
