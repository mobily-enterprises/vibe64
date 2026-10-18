<script setup>
import { computed, inject, unref } from "vue";
import {
  VIBE64_ACTIVE_SESSION_NAV_KEY
} from "@/lib/vibe64ActiveSessionNav.js";

const props = defineProps({
  disabled: {
    default: false,
    type: Boolean
  },
  icon: {
    default: "",
    type: String
  },
  guideId: {
    default: "",
    type: String
  },
  label: {
    default: "",
    type: String
  },
  role: {
    default: "",
    type: String
  },
  title: {
    default: "",
    type: String
  },
  to: {
    default: "",
    type: String
  },
  toolId: {
    default: "",
    type: String
  }
});

const injectedSessionNav = inject(VIBE64_ACTIVE_SESSION_NAV_KEY, null);

const sessionNav = computed(() => {
  const value = unref(injectedSessionNav);
  return value && typeof value === "object" ? value : {};
});
const tools = computed(() => Array.isArray(sessionNav.value.tools) ? sessionNav.value.tools : []);
const tool = computed(() => {
  const toolId = String(props.toolId || "").trim();
  return tools.value.find((candidate) => String(candidate?.id || "") === toolId) || {};
});
const navVisible = computed(() => Boolean(sessionNav.value.visible !== false && sessionNav.value.label));
const headerVisible = computed(() => Boolean(navVisible.value && props.role === "heading"));
const itemVisible = computed(() => Boolean(navVisible.value && props.role !== "heading" && props.toolId));
const itemLabel = computed(() => String(tool.value.label || props.label || ""));
const itemIcon = computed(() => String(tool.value.icon || props.icon || ""));
const itemTitle = computed(() => String(tool.value.title || props.title || ""));
const itemTo = computed(() => String(tool.value.to || props.to || "").trim());
const itemDisabled = computed(() => Boolean(props.disabled || tool.value.disabled));
const itemDisabledReason = computed(() => String(tool.value.disabledReason || itemTitle.value || ""));
const statusClass = computed(() => (
  `vibe64-active-session-nav-item__status--${String(sessionNav.value.status || "unknown").trim() || "unknown"}`
));

function selectTool() {
  if (itemDisabled.value || typeof sessionNav.value.selectTool !== "function") {
    return;
  }
  if (itemTo.value) {
    return;
  }
  sessionNav.value.selectTool(String(props.toolId || ""));
}
</script>

<template>
  <div
    v-if="headerVisible"
    class="vibe64-active-session-nav-item vibe64-active-session-nav-item--heading"
    aria-label="Active session navigation"
  >
    <v-divider class="vibe64-active-session-nav-item__divider" />
    <span class="vibe64-dashboard-nav-group-label">Session</span>
    <div class="vibe64-active-session-nav-item__heading" :title="sessionNav.label">
      <span
        class="vibe64-active-session-nav-item__status"
        :class="statusClass"
      />
      <span class="vibe64-active-session-nav-item__label">{{ sessionNav.label }}</span>
    </div>
  </div>
  <v-list-item
    v-else-if="itemVisible"
    class="vibe64-active-session-nav-item"
    :active="tool.active"
    :disabled="itemDisabled"
    :prepend-icon="itemIcon"
    :title="itemLabel"
    :data-vibe64-guide="props.guideId || undefined"
    :subtitle="itemDisabled ? itemDisabledReason : ''"
    :to="itemTo || undefined"
    @click="selectTool"
  />
</template>

<style scoped>
.vibe64-active-session-nav-item--heading {
  display: grid;
  gap: var(--v64-space-1, 4px);
  min-width: 0;
}

.vibe64-active-session-nav-item__divider {
  border-color: var(--v64-outline-variant, rgba(0, 0, 0, 0.12));
  margin: var(--v64-space-2, 8px) var(--v64-space-3, 12px) var(--v64-space-1, 4px);
  opacity: 1;
}

.vibe64-dashboard-nav-group-label {
  color: var(--v64-on-surface-variant, rgba(0, 0, 0, 0.72));
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  letter-spacing: 0.06em;
  padding: var(--v64-space-1, 4px) var(--v64-space-4, 16px) 0;
  text-transform: uppercase;
}

.vibe64-active-session-nav-item__heading {
  align-items: center;
  background: var(--v64-surface-container-high, rgba(0, 0, 0, 0.06));
  border-radius: var(--v64-shape-full, 999px);
  color: var(--v64-on-surface, inherit);
  display: flex;
  font: var(--v64-type-label-md, 500 0.75rem/1rem system-ui, sans-serif);
  font-weight: 650;
  gap: var(--v64-space-2, 8px);
  margin: 0 var(--v64-space-1, 4px) var(--v64-space-1, 4px);
  min-width: 0;
  padding: 6px var(--v64-space-3, 12px);
}

.vibe64-active-session-nav-item__status {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  box-shadow: 0 0 0 3px rgba(var(--v-theme-primary), 0.16);
  flex: 0 0 auto;
  height: 0.5rem;
  width: 0.5rem;
}

.vibe64-active-session-nav-item__status--failed,
.vibe64-active-session-nav-item__status--blocked,
.vibe64-active-session-nav-item__status--archived {
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 3px rgba(var(--v-theme-error), 0.16);
}

.vibe64-active-session-nav-item__label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-active-session-nav-item :deep(.v-list-item-subtitle) {
  white-space: normal;
}
</style>
