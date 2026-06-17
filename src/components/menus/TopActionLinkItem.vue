<script setup>
import { computed } from "vue";
import { useRoute } from "vue-router";
import {
  mdiLinkVariant
} from "@mdi/js";

const props = defineProps({
  disabled: {
    default: false,
    type: Boolean
  },
  exact: {
    default: false,
    type: Boolean
  },
  icon: {
    default: "",
    type: String
  },
  label: {
    default: "",
    type: String
  },
  returnToCurrent: {
    default: false,
    type: Boolean
  },
  to: {
    default: "",
    type: String
  }
});

const route = useRoute();
const resolvedIcon = computed(() => mdiLinkVariant);
const active = computed(() => {
  const target = String(props.to || "").trim();
  const path = String(route.path || "").trim();
  if (!target || !path) {
    return false;
  }
  return props.exact ? path === target : path === target || path.startsWith(`${target}/`);
});
const resolvedTo = computed(() => {
  const target = String(props.to || "").trim();
  if (!target || !props.returnToCurrent || active.value) {
    return target;
  }
  return {
    path: target,
    query: {
      returnTo: route.fullPath || route.path || "/app"
    }
  };
});
</script>

<template>
  <v-btn
    v-if="props.to"
    class="top-action-link-item text-none"
    :class="{ 'top-action-link-item--active': active }"
    :disabled="props.disabled"
    :prepend-icon="resolvedIcon || undefined"
    :to="resolvedTo"
    variant="tonal"
    color="primary"
    density="comfortable"
  >
    {{ props.label || "Open" }}
  </v-btn>
</template>

<style scoped>
.top-action-link-item {
  flex: 0 0 auto;
  letter-spacing: 0;
  min-height: 48px;
}

.top-action-link-item--active {
  background: rgba(var(--v-theme-primary), 0.16);
  font-weight: 720;
}

@media (max-width: 640px) {
  .top-action-link-item {
    min-width: 48px;
    padding-inline: 0.65rem;
  }
}
</style>
