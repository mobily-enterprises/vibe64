<template>
  <aside class="database-workspace__copilot">
    <header>
      <span class="database-workspace__copilot-mark"><v-icon icon="$autoAwesome" size="18" /></span>
      <div><strong>Database copilot</strong><small>{{ statusLabel }}</small></div>
      <v-btn
        icon="$close"
        size="small"
        title="Collapse database copilot"
        type="button"
        variant="text"
        @click="emit('close')"
      />
    </header>
    <div v-if="configured" class="database-workspace__copilot-body">
      <div class="database-workspace__assistant-note">
        Looks up bounded parts of the refreshed schema as needed. Database credentials stay server-side, schema metadata is untrusted, and it can run only read-only queries.
      </div>
      <AssistantConversationElement :adapter="adapter" configuration-mode="hidden" label="Database copilot">
        <template #message-actions="{ message }">
          <small v-if="message.table">{{ message.table }}</small>
          <v-btn
            v-if="message.sql"
            prepend-icon="$code"
            size="x-small"
            type="button"
            variant="tonal"
            @click="emit('use-sql', message.sql)"
          >
            Put SQL in editor
          </v-btn>
        </template>
        <template #hints>
          <div v-if="busy" class="database-workspace__assistant-skeleton" role="status">
            <v-skeleton-loader type="list-item-two-line, paragraph" />
          </div>
        </template>
        <template #composer-tools>
          <small class="database-workspace__assistant-context">{{ tableName ? `Table: ${tableName}` : 'Whole database' }}</small>
        </template>
      </AssistantConversationElement>
    </div>
    <div v-else class="database-workspace__copilot-unavailable">
      <v-icon icon="$info" size="26" />
      <strong>Copilot is unavailable</strong>
      <span>{{ unavailableCopy }}</span>
    </div>
  </aside>
</template>

<script setup>
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";

defineProps({
  adapter: { type: Object, required: true },
  busy: { type: Boolean, default: false },
  configured: { type: Boolean, default: false },
  statusLabel: { type: String, required: true },
  tableName: { type: String, default: "" },
  unavailableCopy: { type: String, required: true }
});
const emit = defineEmits(["close", "use-sql"]);
</script>

<style scoped>
.database-workspace__copilot-mark { display: grid; flex: 0 0 2.15rem; width: 2.15rem; height: 2.15rem; place-items: center; border-radius: 11px; background: rgba(var(--v-theme-primary), 0.12); color: rgb(var(--v-theme-primary)); }
.database-workspace__assistant-context { grid-column: 1 / -1; overflow-wrap: anywhere; color: rgba(var(--v-theme-on-surface), .65); }
.database-workspace__copilot-unavailable { display: grid; align-content: center; justify-items: center; gap: 0.4rem; padding: 2rem; color: rgba(var(--v-theme-on-surface), 0.62); text-align: center; }
.database-workspace__copilot-unavailable strong { color: rgb(var(--v-theme-on-surface)); }
.database-workspace__copilot-unavailable span { max-width: 30rem; font-size: 0.74rem; }
.database-workspace__copilot > header { display: flex; gap: 0.55rem; align-items: center; min-height: 3.7rem; padding: 0.65rem; border-bottom: 1px solid rgb(var(--v-theme-outline-variant)); }
.database-workspace__copilot > header > div { min-width: 0; flex: 1; }
.database-workspace__copilot > header strong, .database-workspace__copilot > header small { display: block; }
.database-workspace__copilot > header small { color: rgba(var(--v-theme-on-surface), 0.54); font-size: 0.63rem; }
.database-workspace__copilot-body { display: grid; grid-template-rows: auto minmax(0, 1fr); min-height: 0; }
.database-workspace__assistant-note { margin: 0.65rem; padding: 0.6rem; border-radius: 10px; background: rgb(var(--v-theme-surface-container-high)); color: rgba(var(--v-theme-on-surface), 0.68); font-size: 0.67rem; }
.database-workspace__assistant-skeleton { margin: 0.5rem 0; }
</style>
