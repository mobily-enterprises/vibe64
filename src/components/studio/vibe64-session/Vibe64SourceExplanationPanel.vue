<template>
  <aside
    class="vibe64-source-explanation"
    aria-label="Source explanation"
  >
    <header class="vibe64-source-explanation__header">
      <div>
        <p>Explanation</p>
        <h3>{{ explanation.title || "Code explanation" }}</h3>
      </div>
      <v-btn
        :icon="mdiClose"
        size="small"
        title="Close explanation"
        type="button"
        variant="text"
        @click="emit('close')"
      />
    </header>

    <div class="vibe64-source-explanation__meta">
      <button
        class="vibe64-source-explanation__range"
        type="button"
        @click="emit('open-range', explanation)"
      >
        {{ explanation.sourceRange.path }}:{{ explanation.sourceRange.startLine }}-{{ explanation.sourceRange.endLine }}
      </button>
      <v-chip
        v-if="explanation.stale"
        color="warning"
        size="x-small"
        variant="tonal"
      >
        Stale
      </v-chip>
    </div>

    <v-alert
      v-if="explanation.stale"
      density="compact"
      type="warning"
      variant="tonal"
    >
      {{ explanation.staleReason || "The source changed after this explanation was created." }}
    </v-alert>

    <section class="vibe64-source-explanation__section">
      <strong>Summary</strong>
      <p>{{ explanation.summary || "No summary saved." }}</p>
    </section>

    <section class="vibe64-source-explanation__section">
      <strong>Details</strong>
      <pre>{{ explanation.body }}</pre>
    </section>

    <section
      v-if="explanation.followups.length"
      class="vibe64-source-explanation__thread"
      aria-label="Explanation follow-ups"
    >
      <article
        v-for="message in explanation.followups"
        :key="message.id"
        class="vibe64-source-explanation__message"
        :class="`vibe64-source-explanation__message--${message.role}`"
      >
        <strong>{{ message.role === "user" ? "You" : "Vibe64" }}</strong>
        <p>{{ message.text }}</p>
      </article>
    </section>

    <form
      class="vibe64-source-explanation__followup"
      @submit.prevent="emit('send-followup')"
    >
      <v-textarea
        auto-grow
        density="compact"
        hide-details
        label="Ask about this explanation"
        max-rows="4"
        :model-value="followup"
        rows="2"
        variant="outlined"
        @keydown.enter.exact.prevent="emit('send-followup')"
        @update:model-value="emit('update:followup', $event)"
      />
      <v-btn
        color="primary"
        :disabled="!followup.trim() || busy"
        :icon="mdiSend"
        :loading="busy"
        title="Send follow-up"
        type="submit"
        variant="flat"
      />
    </form>
  </aside>
</template>

<script setup>
import {
  mdiClose,
  mdiSend
} from "@mdi/js";

defineProps({
  busy: {
    default: false,
    type: Boolean
  },
  explanation: {
    default: () => ({
      body: "",
      followups: [],
      sourceRange: {},
      summary: "",
      title: ""
    }),
    type: Object
  },
  followup: {
    default: "",
    type: String
  }
});

const emit = defineEmits([
  "close",
  "open-range",
  "send-followup",
  "update:followup"
]);
</script>

<style scoped>
.vibe64-source-explanation {
  border-left: 1px solid rgba(var(--v-border-color), 0.28);
  display: grid;
  gap: 0.75rem;
  grid-template-rows: auto auto auto minmax(0, auto) minmax(0, 1fr) auto;
  min-width: 0;
  overflow: auto;
  padding: 0.78rem;
}

.vibe64-source-explanation__header {
  align-items: start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.vibe64-source-explanation__header p {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.72rem;
  font-weight: 760;
  letter-spacing: 0.06em;
  margin: 0 0 0.15rem;
  text-transform: uppercase;
}

.vibe64-source-explanation__header h3 {
  font-size: 0.95rem;
  line-height: 1.2;
  margin: 0;
}

.vibe64-source-explanation__meta {
  align-items: center;
  display: flex;
  gap: 0.45rem;
  min-width: 0;
}

.vibe64-source-explanation__range {
  background: transparent;
  border: 0;
  color: rgb(var(--v-theme-primary));
  cursor: pointer;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.76rem;
  min-width: 0;
  overflow: hidden;
  padding: 0;
  text-align: left;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-source-explanation__section {
  display: grid;
  gap: 0.35rem;
}

.vibe64-source-explanation__section strong,
.vibe64-source-explanation__message strong {
  font-size: 0.76rem;
}

.vibe64-source-explanation__section p,
.vibe64-source-explanation__message p {
  color: rgba(var(--v-theme-on-surface), 0.78);
  font-size: 0.84rem;
  line-height: 1.45;
  margin: 0;
  white-space: pre-wrap;
}

.vibe64-source-explanation__section pre {
  background: rgba(var(--v-theme-surface-variant), 0.32);
  border: 1px solid rgba(var(--v-border-color), 0.24);
  border-radius: 6px;
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.75rem;
  line-height: 1.42;
  margin: 0;
  overflow: auto;
  padding: 0.58rem;
  white-space: pre-wrap;
}

.vibe64-source-explanation__thread {
  display: grid;
  gap: 0.55rem;
  min-height: 0;
}

.vibe64-source-explanation__message {
  border-radius: 7px;
  display: grid;
  gap: 0.28rem;
  padding: 0.55rem 0.65rem;
}

.vibe64-source-explanation__message--user {
  background: rgba(var(--v-theme-primary), 0.12);
}

.vibe64-source-explanation__message--assistant {
  background: rgba(var(--v-theme-surface-variant), 0.36);
}

.vibe64-source-explanation__followup {
  align-items: end;
  display: grid;
  gap: 0.45rem;
  grid-template-columns: minmax(0, 1fr) auto;
}
</style>
