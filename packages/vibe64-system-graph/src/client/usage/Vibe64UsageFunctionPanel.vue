<template>
  <article class="usage-panel" :aria-label="`Details for ${node.title}`">
    <header class="usage-panel__header">
      <div class="usage-panel__heading">
        <h3 class="text-title-medium">{{ node.title }}</h3>
        <p class="text-body-small">{{ node.subtitle }}</p>
      </div>
      <v-btn :icon="mdiClose" variant="text" size="small" aria-label="Close details" @click="emit('close')" />
    </header>
    <div class="usage-panel__actions">
      <v-btn variant="tonal" :prepend-icon="mdiCodeTags" @click="openAt(node.start)">Open source</v-btn>
      <span v-if="ranText" class="text-body-medium">{{ ranText }}</span>
    </div>
    <p v-if="joinNote" class="usage-panel__note text-body-small" role="note">{{ joinNote }}</p>
    <p v-if="importText" class="usage-panel__note text-body-medium">{{ importText }}</p>

    <template v-if="node.functionId">
      <v-alert v-if="error" type="error" variant="tonal" density="compact">
        {{ error }}
        <template #append><v-btn variant="text" size="small" @click="emit('retry')">Retry</v-btn></template>
      </v-alert>
      <div v-else-if="loading && !detail" aria-busy="true" aria-label="Loading calls">
        <v-skeleton-loader type="list-item-two-line, list-item-two-line, list-item-two-line" />
      </div>
      <template v-else-if="detail">
        <p class="usage-panel__note text-body-small">{{ coverageText(detail.function.coverage || '') }}</p>
        <section v-for="group in sections" :key="group.title" class="usage-panel__section" :aria-label="group.title">
          <h4 class="text-title-small">{{ group.title }}</h4>
          <v-list density="compact" class="usage-panel__list">
            <v-list-item v-for="(row, position) in group.rows" :key="position" rounded="lg" lines="two" @click="emit('select', row.fn)">
              <v-list-item-title class="text-body-medium">{{ functionLabel(row.fn) }}</v-list-item-title>
              <v-list-item-subtitle class="usage-panel__callee"><code>{{ row.callee }}</code><span v-if="methodText(row)"> · {{ methodText(row) }}</span></v-list-item-subtitle>
              <template #append>
                <v-chip size="x-small" :variant="row.certainty === 'exact' ? 'tonal' : 'outlined'" class="mr-1">{{ CERTAINTY_TEXT[row.certainty] }}</v-chip>
                <v-btn v-if="row.start" :icon="mdiCodeTags" variant="text" size="x-small" :aria-label="`Open the call at line ${row.start.line}`" @click.stop="openAt(row.start, row.site)" />
              </template>
            </v-list-item>
          </v-list>
        </section>
        <section v-if="detail.unresolved.length" class="usage-panel__section" aria-label="Unresolved calls">
          <h4 class="text-title-small">Unresolved ({{ detail.totals.unresolved }})</h4>
          <v-list density="compact" class="usage-panel__list">
            <v-list-item v-for="(item, position) in detail.unresolved" :key="position" rounded="lg" @click="openAt(item.start)">
              <v-list-item-title class="usage-panel__callee text-body-medium">Unresolved call: <code>{{ item.callee }}</code></v-list-item-title>
              <v-list-item-subtitle>Line {{ item.start.line }}</v-list-item-subtitle>
            </v-list-item>
          </v-list>
        </section>
        <p v-if="!sections.length && !detail.unresolved.length" class="usage-panel__note text-body-medium">No calls in or out are known for this function.</p>
        <p v-if="detail.truncated" class="usage-panel__note text-body-small">Each list shows its first {{ detail.limits.list }}.</p>
      </template>
    </template>
  </article>
</template>

<script setup>
import { computed } from "vue";
import { mdiClose, mdiCodeTags } from "@mdi/js";

import { CERTAINTY_TEXT, NOT_IGNORED_TEXT, callGroups, callMethodText, coverageText, functionLabel, joinText } from "./usageModel.js";

const props = defineProps({
  node: { type: Object, required: true },
  detail: { type: Object, default: null },
  loading: { type: Boolean, default: false },
  error: { type: String, default: "" }
});
const emit = defineEmits(["close", "select", "open-source", "retry"]);

const sections = computed(() => {
  if (!props.detail) return [];
  const calls = props.detail.calls.map((row) => ({ ...row, fn: row.target, site: props.detail.function.file }));
  const calledBy = props.detail.calledBy.map((row) => ({ ...row, fn: row.source, site: row.source.file }));
  return [...callGroups(calls, "Calls"), ...callGroups(calledBy, "Called by")];
});
const ranText = computed(() => {
  if (props.node.count === undefined) return "";
  return props.node.count == null ? "Ran in this request" : `Ran ${props.node.count.toLocaleString()} ${props.node.count === 1 ? "time" : "times"}`;
});
const joinNote = computed(() => {
  if (!props.node.join || props.node.join === "exact") return "";
  if (props.node.join === "name-line") return "Matched by name near this line: the file moved slightly since the scan.";
  if (props.node.reason === "not-ignored") return NOT_IGNORED_TEXT;
  if (props.node.reason === "language") return "The scan reads calls only in the languages of the project's Stack components, and this file's language is not among them.";
  return `${joinText(props.node.join)}. Refresh the architecture scan to see its calls.`;
});

const importText = computed(() => (props.node.functionId || props.node.join ? "" : `Imports ${props.node.outCount} of the reached files · imported by ${props.node.inCount}`));

const methodText = (row) => callMethodText(row.method);

function openAt(start, file = props.node.file) {
  emit("open-source", { path: file, line: start?.line || 1, column: start?.column || 1 });
}
</script>

<style scoped>
.usage-panel { display: flex; flex-direction: column; gap: 12px; padding: 16px; min-width: 0; }
.usage-panel__header { display: flex; align-items: flex-start; gap: 8px; }
.usage-panel__heading { flex: 1; min-width: 0; }
.usage-panel__heading h3, .usage-panel__heading p { margin: 0; overflow-wrap: anywhere; }
.usage-panel__heading p { color: rgb(var(--v-theme-on-surface-variant)); }
.usage-panel__actions { display: flex; align-items: center; flex-wrap: wrap; gap: 12px; }
.usage-panel__note { margin: 0; color: rgb(var(--v-theme-on-surface-variant)); }
.usage-panel__section h4 { margin: 0 0 4px; }
.usage-panel__list { padding: 0; background: transparent; }
.usage-panel__callee code { font-size: .8125rem; overflow-wrap: anywhere; white-space: normal; }
.usage-panel__list :deep(.v-list-item-subtitle) { -webkit-line-clamp: 3; }
</style>
