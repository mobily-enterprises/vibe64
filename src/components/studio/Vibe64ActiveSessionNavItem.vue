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
    <div class="vibe64-active-session-nav-item__heading">
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
    :subtitle="itemDisabled ? itemDisabledReason : ''"
    :to="itemTo || undefined"
    @click="selectTool"
  />
</template>

<style scoped>
.vibe64-active-session-nav-item--heading {
  min-width: 0;
}

.vibe64-active-session-nav-item__divider {
  margin: 0.35rem 0 0.4rem;
}

.vibe64-active-session-nav-item__heading {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.68);
  display: flex;
  font-size: 0.78rem;
  font-weight: 720;
  gap: 0.45rem;
  line-height: 1.2;
  min-width: 0;
  padding: 0.3rem 0.65rem 0.25rem;
}

.vibe64-active-session-nav-item__status {
  background: rgb(var(--v-theme-primary));
  border-radius: 999px;
  box-shadow: 0 0 0 0.22rem rgba(var(--v-theme-primary), 0.12);
  flex: 0 0 auto;
  height: 0.45rem;
  width: 0.45rem;
}

.vibe64-active-session-nav-item__status--completed,
.vibe64-active-session-nav-item__status--merged {
  background: rgb(var(--v-theme-success));
  box-shadow: 0 0 0 0.22rem rgba(var(--v-theme-success), 0.12);
}

.vibe64-active-session-nav-item__status--failed,
.vibe64-active-session-nav-item__status--abandoned {
  background: rgb(var(--v-theme-error));
  box-shadow: 0 0 0 0.22rem rgba(var(--v-theme-error), 0.12);
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
