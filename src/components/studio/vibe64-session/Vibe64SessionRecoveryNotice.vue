<template>
  <section
    v-if="recoveryIssues.length"
    class="session-recovery"
    aria-live="polite"
  >
    <header class="session-recovery__header">
      <v-icon :icon="mdiAlertCircleOutline" size="20" />
      <div>
        <h3>{{ recovery.title }}</h3>
        <p>{{ recovery.message }}</p>
      </div>
    </header>

    <article
      v-for="issue in recoveryIssues"
      :key="`${issue.id}:${issue.signature}`"
      class="session-recovery__issue"
    >
      <h4>{{ issue.title }}</h4>
      <p>{{ issue.explanation }}</p>

      <dl v-if="issue.evidence?.length" class="session-recovery__evidence">
        <template v-for="entry in issue.evidence" :key="`${entry.label}:${entry.value}`">
          <dt>{{ entry.label }}</dt>
          <dd>{{ entry.value }}</dd>
        </template>
      </dl>

      <div v-if="issue.options?.length" class="session-recovery__actions">
        <v-btn
          v-for="option in issue.options"
          :key="option.id"
          :color="option.style === 'primary' ? 'primary' : undefined"
          :loading="resolvingKey === `${issue.id}:${option.id}`"
          size="small"
          type="button"
          :variant="option.style === 'primary' ? 'flat' : 'tonal'"
          @click="resolve(issue, option)"
        >
          {{ option.label }}
          <v-tooltip activator="parent" location="top">
            {{ option.description }}
          </v-tooltip>
        </v-btn>
      </div>
    </article>

    <p v-if="error" class="session-recovery__error" role="alert">
      {{ error }}
    </p>
  </section>
</template>

<script setup>
import { computed } from "vue";
import { mdiAlertCircleOutline } from "@mdi/js";

const props = defineProps({
  error: {
    default: "",
    type: String
  },
  recovery: {
    default: () => ({}),
    type: Object
  },
  resolvingKey: {
    default: "",
    type: String
  }
});

const emit = defineEmits(["resolve"]);
const recoveryIssues = computed(() => (
  Array.isArray(props.recovery?.issues) ? props.recovery.issues : []
));

function resolve(issue = {}, option = {}) {
  emit("resolve", {
    issueId: String(issue.id || ""),
    optionId: String(option.id || ""),
    signature: String(issue.signature || "")
  });
}
</script>

<style scoped>
.session-recovery {
  background: color-mix(in srgb, rgb(var(--v-theme-warning)) 8%, rgb(var(--v-theme-surface)));
  border: 1px solid color-mix(in srgb, rgb(var(--v-theme-warning)) 38%, transparent);
  border-radius: 14px;
  color: rgb(var(--v-theme-on-surface));
  display: grid;
  gap: 0.85rem;
  margin: 0.75rem 1rem 0;
  padding: 1rem;
}

.session-recovery__header {
  align-items: flex-start;
  display: flex;
  gap: 0.65rem;
}

.session-recovery h3,
.session-recovery h4,
.session-recovery p,
.session-recovery dl {
  margin: 0;
}

.session-recovery h3 {
  font-size: 1rem;
  line-height: 1.3;
}

.session-recovery h4 {
  font-size: 0.92rem;
}

.session-recovery p {
  color: color-mix(in srgb, currentColor 76%, transparent);
  font-size: 0.84rem;
  line-height: 1.45;
  margin-top: 0.25rem;
}

.session-recovery__issue {
  display: grid;
  gap: 0.65rem;
  padding-left: 1.75rem;
}

.session-recovery__evidence {
  display: grid;
  font-size: 0.78rem;
  gap: 0.2rem 0.75rem;
  grid-template-columns: max-content minmax(0, 1fr);
}

.session-recovery__evidence dt {
  color: color-mix(in srgb, currentColor 60%, transparent);
}

.session-recovery__evidence dd {
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  overflow-wrap: anywhere;
}

.session-recovery__actions {
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.session-recovery__error {
  color: rgb(var(--v-theme-error));
  padding-left: 1.75rem;
}

@media (max-width: 600px) {
  .session-recovery {
    margin-inline: 0.5rem;
  }

  .session-recovery__issue {
    padding-left: 0;
  }

  .session-recovery__evidence {
    grid-template-columns: 1fr;
  }
}
</style>
