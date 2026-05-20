<template>
  <section class="studio-autopilot">
    <div class="studio-autopilot__input-grid">
      <v-textarea
        v-model="initialPrompt"
        auto-grow
        class="studio-autopilot__prompt"
        label="Initial prompt"
        rows="4"
        variant="outlined"
      />

      <v-textarea
        v-model="followUpAnswer"
        auto-grow
        class="studio-autopilot__prompt"
        label="Follow-up answer"
        rows="3"
        variant="outlined"
      />
    </div>

    <div class="studio-autopilot__stage">
      <v-progress-circular
        class="studio-autopilot__cog"
        color="primary"
        indeterminate
        :size="148"
        :width="8"
      >
        <v-icon :icon="mdiCog" size="64" />
      </v-progress-circular>

      <div class="studio-autopilot__status">
        <h2>Autopilot</h2>
        <p>{{ statusText }}</p>
      </div>

      <v-btn
        color="primary"
        :prepend-icon="mdiTune"
        variant="tonal"
        @click="emit('inspect')"
      >
        Inspect
      </v-btn>
    </div>
  </section>
</template>

<script setup>
import { computed, ref } from "vue";
import {
  mdiCog,
  mdiTune
} from "@mdi/js";

const props = defineProps({
  session: {
    default: null,
    type: Object
  }
});
const emit = defineEmits(["inspect"]);

const initialPrompt = ref("");
const followUpAnswer = ref("");
const statusText = computed(() => {
  if (!props.session?.sessionId) {
    return "Create a session to start.";
  }
  return "Controller placeholder.";
});
</script>

<style scoped>
.studio-autopilot {
  align-items: stretch;
  display: grid;
  gap: 1rem;
  min-height: 0;
  min-width: 0;
}

.studio-autopilot__input-grid {
  display: grid;
  gap: 0.75rem;
}

.studio-autopilot__prompt {
  max-width: 100%;
}

.studio-autopilot__stage {
  align-items: center;
  border: 1px solid rgba(var(--v-theme-outline), 0.24);
  border-radius: 8px;
  display: grid;
  gap: 0.85rem;
  justify-items: center;
  min-height: 22rem;
  padding: 1.25rem;
  text-align: center;
}

.studio-autopilot__cog :deep(.v-icon) {
  animation: studio-autopilot-cog-spin 1.7s linear infinite;
}

.studio-autopilot__status {
  display: grid;
  gap: 0.25rem;
}

.studio-autopilot__status h2 {
  font-size: 1.2rem;
  font-weight: 720;
  letter-spacing: 0;
  line-height: 1.15;
  margin: 0;
}

.studio-autopilot__status p {
  color: rgb(var(--v-theme-on-surface-variant));
  margin: 0;
}

@keyframes studio-autopilot-cog-spin {
  from {
    transform: rotate(0deg);
  }

  to {
    transform: rotate(360deg);
  }
}

@media (min-width: 981px) {
  .studio-autopilot {
    align-content: start;
    overflow-y: auto;
    padding-right: 0.25rem;
    scrollbar-gutter: stable;
  }
}
</style>
