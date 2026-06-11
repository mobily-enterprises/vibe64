<template>
  <v-snackbar
    v-model="visible"
    class="vibe64-async-module-error-host"
    location="bottom right"
    :timeout="-1"
    width="min(32rem, calc(100vw - 2rem))"
  >
    <div class="vibe64-async-module-error-host__content">
      <strong>{{ title }}</strong>
      <span>{{ asyncModuleErrorState.message }}</span>
    </div>

    <template #actions>
      <v-btn
        v-if="asyncModuleErrorState.retry"
        color="primary"
        size="small"
        variant="tonal"
        @click="retry"
      >
        Retry
      </v-btn>
      <v-btn
        color="primary"
        size="small"
        variant="flat"
        @click="reloadVibe64App"
      >
        Reload
      </v-btn>
      <v-btn
        :icon="mdiClose"
        size="small"
        title="Dismiss"
        variant="text"
        @click="dismissVibe64AsyncModuleError"
      />
    </template>
  </v-snackbar>
</template>

<script setup>
import { computed } from "vue";
import { mdiClose } from "@mdi/js";
import {
  asyncModuleErrorState,
  dismissVibe64AsyncModuleError,
  reloadVibe64App
} from "@/lib/vibe64AsyncModuleCore.js";

const visible = computed({
  get() {
    return asyncModuleErrorState.visible;
  },
  set(value) {
    if (!value) {
      dismissVibe64AsyncModuleError();
    }
  }
});
const title = computed(() => `${asyncModuleErrorState.label || "Vibe64 module"} could not load`);

function retry() {
  const retryAction = asyncModuleErrorState.retry;
  dismissVibe64AsyncModuleError();
  if (typeof retryAction === "function") {
    void retryAction();
  }
}
</script>

<style scoped>
.vibe64-async-module-error-host__content {
  display: grid;
  gap: 0.2rem;
  min-width: 0;
}

.vibe64-async-module-error-host__content strong,
.vibe64-async-module-error-host__content span {
  letter-spacing: 0;
}

.vibe64-async-module-error-host__content span {
  color: rgba(var(--v-theme-on-surface), 0.72);
  font-size: 0.9rem;
  line-height: 1.35;
}
</style>
