<template>
  <div v-if="visibleTasks.length || error" class="studio-background-tasks">
    <v-alert
      v-for="task in visibleTasks"
      :key="task.id"
      border="start"
      class="studio-background-tasks__alert"
      density="compact"
      :type="task.status === 'failed' ? 'warning' : 'info'"
      variant="tonal"
    >
      <div class="studio-background-tasks__row">
        <v-icon
          class="studio-background-tasks__icon"
          :icon="task.status === 'failed' ? mdiAlertCircleOutline : mdiProgressClock"
          size="20"
        />
        <div class="studio-background-tasks__content">
          <div class="studio-background-tasks__title-row">
            <strong>{{ task.label }}</strong>
            <span v-if="taskUpdatedTime(task)" class="studio-background-tasks__time">
              {{ taskUpdatedTime(task) }}
            </span>
          </div>
          <span>{{ taskMessage(task) }}</span>
        </div>
        <v-btn
          v-if="taskCanRetry(task)"
          :loading="taskIsRetrying(task)"
          :prepend-icon="mdiRefresh"
          size="small"
          type="button"
          variant="tonal"
          @click="$emit('retry', task)"
        >
          {{ task.retry?.label || "Retry" }}
        </v-btn>
      </div>
    </v-alert>

    <v-alert
      v-if="error"
      border="start"
      class="studio-background-tasks__alert"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ error }}
    </v-alert>
  </div>
</template>

<script setup>
import { computed } from "vue";
import {
  mdiAlertCircleOutline,
  mdiProgressClock,
  mdiRefresh
} from "@mdi/js";
import {
  controlHasClientAction
} from "@/lib/vibe64PresentationControls.js";

const props = defineProps({
  error: {
    default: "",
    type: String
  },
  retryingTaskId: {
    default: "",
    type: String
  },
  tasks: {
    default: () => [],
    type: Array
  }
});

defineEmits(["retry"]);

const visibleTasks = computed(() => {
  return (Array.isArray(props.tasks) ? props.tasks : [])
    .filter((task) => task && ["failed", "running"].includes(String(task.status || "")));
});

function taskCanRetry(task = {}) {
  return task.status === "failed" && controlHasClientAction(task.retry);
}

function taskIsRetrying(task = {}) {
  return Boolean(task.id && task.id === props.retryingTaskId);
}

function taskMessage(task = {}) {
  if (task.status === "failed") {
    return task.error || task.message || "This background task failed.";
  }
  return task.message || "Running in the background.";
}

function taskUpdatedTime(task = {}) {
  const date = new Date(task.updatedAt || "");
  if (Number.isNaN(date.getTime())) {
    return "";
  }
  return date.toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit"
  });
}
</script>

<style scoped>
.studio-background-tasks {
  display: grid;
  gap: 0.45rem;
  max-width: 52rem;
  width: 100%;
}

.studio-background-tasks__alert {
  margin: 0;
}

.studio-background-tasks__row {
  align-items: center;
  display: flex;
  gap: 0.65rem;
  min-width: 0;
}

.studio-background-tasks__icon {
  flex: 0 0 auto;
}

.studio-background-tasks__content {
  display: grid;
  flex: 1 1 auto;
  gap: 0.1rem;
  min-width: 0;
}

.studio-background-tasks__title-row {
  align-items: baseline;
  display: flex;
  flex-wrap: wrap;
  gap: 0.35rem 0.55rem;
}

.studio-background-tasks__time {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
}
</style>
