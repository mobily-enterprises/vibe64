<template>
  <v-sheet
    v-if="facts.length"
    rounded="lg"
    border
    class="studio-ai-session-facts"
  >
    <div class="studio-ai-session-facts__header">
      <h2 class="studio-ai-session-facts__title">Session details</h2>
      <v-chip
        :color="statusColor"
        density="comfortable"
        size="small"
        variant="tonal"
      >
        {{ statusLabel }}
      </v-chip>
    </div>

    <div class="studio-ai-session-facts__grid">
      <div
        v-for="fact in facts"
        :key="fact.key"
        class="studio-ai-session-facts__item"
        :class="{
          'studio-ai-session-facts__item--expandable': fact.expandable,
          'studio-ai-session-facts__item--expanded': factIsExpanded(fact)
        }"
        :aria-expanded="fact.expandable ? String(factIsExpanded(fact)) : undefined"
        :role="fact.expandable ? 'button' : undefined"
        :tabindex="fact.expandable ? 0 : undefined"
        @click="toggleFact(fact)"
        @keydown.enter.prevent="toggleFact(fact)"
        @keydown.space.prevent="toggleFact(fact)"
      >
        <div class="studio-ai-session-facts__icon">
          <v-icon :icon="fact.icon" size="18" />
        </div>
        <div class="studio-ai-session-facts__copy">
          <div class="studio-ai-session-facts__label">{{ fact.label }}</div>
          <a
            v-if="fact.href"
            class="studio-ai-session-facts__value studio-ai-session-facts__link"
            :href="fact.href"
            target="_blank"
            rel="noreferrer"
            @click.stop
          >
            {{ fact.value }}
          </a>
          <div v-else class="studio-ai-session-facts__value">{{ fact.value }}</div>
          <div v-if="fact.detail" class="studio-ai-session-facts__detail">{{ fact.detail }}</div>
        </div>
        <div
          v-if="fact.href || fact.copyValue || fact.expandable"
          class="studio-ai-session-facts__actions"
        >
          <v-btn
            v-if="fact.expandable"
            :aria-label="factIsExpanded(fact) ? `Collapse ${fact.label}` : `Expand ${fact.label}`"
            :icon="factIsExpanded(fact) ? mdiChevronUp : mdiChevronDown"
            size="x-small"
            variant="text"
            @click.stop="toggleFact(fact)"
          />
          <v-btn
            v-if="fact.href"
            :href="fact.href"
            target="_blank"
            rel="noreferrer"
            :icon="mdiOpenInNew"
            size="x-small"
            variant="text"
            @click.stop
          />
          <v-btn
            v-if="fact.copyValue"
            :icon="mdiContentCopy"
            size="x-small"
            variant="text"
            @click.stop="emit('copy', fact.copyValue, fact.label)"
          />
        </div>
        <div
          v-if="fact.expandable && factIsExpanded(fact)"
          class="studio-ai-session-facts__expanded"
        >
          <pre>{{ fact.expandedValue }}</pre>
        </div>
      </div>
    </div>
  </v-sheet>
</template>

<script setup>
import { ref } from "vue";
import {
  mdiChevronDown,
  mdiChevronUp,
  mdiContentCopy,
  mdiOpenInNew
} from "@mdi/js";

defineProps({
  facts: {
    default: () => [],
    type: Array
  },
  statusColor: {
    default: "default",
    type: String
  },
  statusLabel: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["copy"]);
const expandedFactKeys = ref({});

function factKey(fact = {}) {
  return String(fact.key || fact.label || "").trim();
}

function factIsExpanded(fact = {}) {
  return Boolean(expandedFactKeys.value[factKey(fact)]);
}

function toggleFact(fact = {}) {
  if (!fact.expandable) {
    return;
  }
  const key = factKey(fact);
  if (!key) {
    return;
  }
  expandedFactKeys.value = {
    ...expandedFactKeys.value,
    [key]: !expandedFactKeys.value[key]
  };
}
</script>

<style scoped>
.studio-ai-session-facts {
  display: grid;
  gap: 0.65rem;
  padding: 0.7rem;
}

.studio-ai-session-facts__header {
  align-items: center;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-ai-session-facts__title {
  font-size: 0.92rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.studio-ai-session-facts__grid {
  display: grid;
  gap: 0.5rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.studio-ai-session-facts__item {
  align-items: flex-start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: 8px;
  display: grid;
  gap: 0.48rem;
  grid-template-columns: 1.55rem minmax(0, 1fr) auto;
  min-width: 0;
  padding: 0.56rem;
}

.studio-ai-session-facts__item--expandable {
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease;
}

.studio-ai-session-facts__item--expandable:hover,
.studio-ai-session-facts__item--expandable:focus-visible {
  background: rgba(var(--v-theme-primary), 0.04);
  border-color: rgba(var(--v-theme-primary), 0.38);
  outline: none;
}

.studio-ai-session-facts__item--expanded {
  border-color: rgba(var(--v-theme-primary), 0.5);
  grid-column: 1 / -1;
}

.studio-ai-session-facts__icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.1);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  height: 1.55rem;
  justify-content: center;
  width: 1.55rem;
}

.studio-ai-session-facts__copy {
  min-width: 0;
}

.studio-ai-session-facts__label {
  color: rgba(var(--v-theme-on-surface), 0.65);
  font-size: 0.68rem;
  font-weight: 750;
  letter-spacing: 0.02em;
  line-height: 1.18;
  text-transform: uppercase;
}

.studio-ai-session-facts__value {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.84rem;
  font-weight: 650;
  line-height: 1.25;
  margin-top: 0.12rem;
  overflow-wrap: anywhere;
}

.studio-ai-session-facts__link {
  color: rgb(var(--v-theme-primary));
  text-decoration: none;
}

.studio-ai-session-facts__link:hover,
.studio-ai-session-facts__link:focus-visible {
  text-decoration: underline;
}

.studio-ai-session-facts__detail {
  color: rgba(var(--v-theme-on-surface), 0.6);
  font-size: 0.74rem;
  line-height: 1.28;
  margin-top: 0.16rem;
  overflow-wrap: anywhere;
}

.studio-ai-session-facts__actions {
  align-items: center;
  display: inline-flex;
  gap: 0.05rem;
  margin-top: -0.22rem;
}

.studio-ai-session-facts__expanded {
  border-top: 1px solid rgba(var(--v-border-color), 0.32);
  grid-column: 1 / -1;
  padding-top: 0.56rem;
}

.studio-ai-session-facts__expanded pre {
  background: rgba(var(--v-theme-surface-variant), 0.44);
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.78rem;
  line-height: 1.38;
  margin: 0;
  max-height: 16rem;
  overflow: auto;
  padding: 0.65rem;
  white-space: pre-wrap;
}

@media (max-width: 860px) {
  .studio-ai-session-facts__grid {
    grid-template-columns: 1fr;
  }
}
</style>
