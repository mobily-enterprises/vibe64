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
          >
            {{ fact.value }}
          </a>
          <div v-else class="studio-ai-session-facts__value">{{ fact.value }}</div>
          <div v-if="fact.detail" class="studio-ai-session-facts__detail">{{ fact.detail }}</div>
        </div>
        <div
          v-if="fact.href || fact.copyValue"
          class="studio-ai-session-facts__actions"
        >
          <v-btn
            v-if="fact.href"
            :href="fact.href"
            target="_blank"
            rel="noreferrer"
            icon="$openInNew"
            size="x-small"
            variant="text"
          />
          <v-btn
            v-if="fact.copyValue"
            :aria-label="`Copy ${fact.label}`"
            icon="$contentCopy"
            size="x-small"
            variant="text"
            @click="emit('copy', fact.copyValue, fact.label)"
          />
        </div>
      </div>
    </div>
  </v-sheet>
</template>

<script setup>

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
</script>

<style scoped>
.studio-ai-session-facts {
  align-content: start;
  display: grid;
  gap: 0.65rem;
  grid-auto-rows: max-content;
  padding: 0.8rem;
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
  align-items: start;
  display: grid;
  gap: 0.5rem;
  grid-auto-rows: max-content;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.studio-ai-session-facts__item {
  align-items: flex-start;
  align-self: start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.28);
  border-radius: 8px;
  display: grid;
  gap: 0.48rem;
  grid-template-columns: 1.55rem minmax(0, 1fr) auto;
  min-width: 0;
  padding: 0.62rem;
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

@media (max-width: 860px) {
  .studio-ai-session-facts__grid {
    grid-template-columns: 1fr;
  }
}
</style>
