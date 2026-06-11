<template>
  <section
    class="vibe64-async-module-state"
    :class="{ 'vibe64-async-module-state--loading': loading }"
    :style="stateStyle"
  >
    <div class="vibe64-async-module-state__icon">
      <v-progress-circular
        v-if="loading"
        color="primary"
        indeterminate
        size="28"
        width="3"
      />
      <v-icon
        v-else
        :icon="mdiAlertCircleOutline"
        color="warning"
        size="30"
      />
    </div>
    <div class="vibe64-async-module-state__copy">
      <h2>{{ title }}</h2>
      <p>{{ message }}</p>
      <p v-if="stale && !loading" class="vibe64-async-module-state__hint">
        If retry keeps failing, reload Vibe64 to pick up the current app files.
      </p>
      <div
        v-if="!loading"
        class="vibe64-async-module-state__actions"
      >
        <v-btn
          color="primary"
          size="small"
          type="button"
          variant="flat"
          @click="emit('retry')"
        >
          Retry
        </v-btn>
        <v-btn
          size="small"
          type="button"
          variant="tonal"
          @click="emit('reload')"
        >
          Reload Vibe64
        </v-btn>
      </div>
    </div>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { mdiAlertCircleOutline } from "@mdi/js";

const props = defineProps({
  label: {
    default: "Vibe64 module",
    type: String
  },
  loading: {
    default: false,
    type: Boolean
  },
  message: {
    default: "",
    type: String
  },
  minHeight: {
    default: "",
    type: String
  },
  stale: {
    default: false,
    type: Boolean
  }
});

const emit = defineEmits(["reload", "retry"]);

const title = computed(() => (
  props.loading
    ? `Loading ${props.label}...`
    : `${props.label} could not load`
));
const stateStyle = computed(() => (
  props.minHeight
    ? {
        minHeight: props.minHeight
      }
    : {}
));
</script>

<style scoped>
.vibe64-async-module-state {
  align-items: flex-start;
  background: rgba(var(--v-theme-warning), 0.06);
  border: 1px solid rgba(var(--v-theme-warning), 0.22);
  border-radius: 8px;
  color: rgb(var(--v-theme-on-surface));
  display: flex;
  gap: 0.85rem;
  min-width: 0;
  padding: 1rem;
}

.vibe64-async-module-state--loading {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.18);
}

.vibe64-async-module-state__icon {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  min-height: 2rem;
}

.vibe64-async-module-state__copy {
  display: grid;
  gap: 0.35rem;
  min-width: 0;
}

.vibe64-async-module-state__copy h2,
.vibe64-async-module-state__copy p {
  letter-spacing: 0;
  margin: 0;
}

.vibe64-async-module-state__copy h2 {
  font-size: 1rem;
  font-weight: 720;
  line-height: 1.25;
}

.vibe64-async-module-state__copy p {
  color: rgba(var(--v-theme-on-surface), 0.74);
  font-size: 0.91rem;
  line-height: 1.35;
}

.vibe64-async-module-state__hint {
  color: rgba(var(--v-theme-on-surface), 0.62) !important;
}

.vibe64-async-module-state__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
  padding-top: 0.25rem;
}
</style>
