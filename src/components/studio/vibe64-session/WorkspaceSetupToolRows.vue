<template>
  <section v-if="tools.length" class="setup-tools" :class="{ 'setup-tools--quiet': !missing.length }" aria-label="Tools this step uses">
    <template v-if="missing.length">
      <header class="setup-tools__header">
        <strong>{{ missing.length === 1 ? "This step needs a tool that isn't working" : "This step needs tools that aren't working" }}</strong>
        <span>Fix it below, then choose Retry.</span>
      </header>
      <ToolInstallRow
        v-for="tool in missing"
        :key="tool.id"
        :checking="checking"
        :tool="tool"
        @check="check"
      />
    </template>
    <p v-if="ready.length" class="setup-tools__found">
      <v-icon :icon="mdiCheckCircle" size="16" />
      <span>
        {{ missing.length ? "Also used:" : "Tools this step used:" }}
        <span v-for="(tool, index) in ready" :key="tool.id" class="setup-tools__found-item">
          {{ tool.name }} {{ tool.version }}<code v-if="tool.path">{{ tool.path }}</code>{{ index < ready.length - 1 ? "," : "" }}
        </span>
      </span>
    </p>
  </section>
</template>

<script setup>
// After a workspace preparation step fails: the Stack runtimes it used, with
// the install command for any that are missing or didn't run.
import { computed, watch } from "vue";
import { mdiCheckCircle } from "@mdi/js";
import ToolInstallRow from "@/components/studio/ToolInstallRow.vue";
import { useLocalToolRows } from "@/composables/useLocalToolRows.js";

const props = defineProps({
  runtimes: { type: Array, default: () => [] },
  active: Boolean
});

const emit = defineEmits(["missing"]);

const { tools, missing, checking, check } = useLocalToolRows(() => props.runtimes, { enabled: () => props.active });
// The page shows one fix at a time: other setup panels wait while a tool is missing.
watch(() => missing.value.length, (count) => emit("missing", count), { immediate: true });
const ready = computed(() => tools.value.filter((tool) => tool.status === "ready"));
</script>

<style scoped>
.setup-tools {
  display: grid;
  gap: var(--v64-space-2, 8px);
  margin-top: var(--v64-space-2, 8px);
}

.setup-tools__header {
  display: grid;
  gap: 2px;
  padding-inline: 2px;
}

.setup-tools__header strong { font: var(--v64-type-title-md); font-size: 0.9375rem; }
.setup-tools__header span { color: var(--v64-on-surface-variant); font: var(--v64-type-body-md); }

.setup-tools__found {
  align-items: baseline;
  color: var(--v64-on-surface-variant);
  display: flex;
  font-size: 0.8125rem;
  gap: 6px;
  margin: 0;
  padding-inline: 2px;
}

.setup-tools__found .v-icon { color: var(--v64-success); flex: none; transform: translateY(2px); }

.setup-tools__found-item { margin-left: 4px; }

.setup-tools__found-item code {
  background: none;
  font-family: ui-monospace, SFMono-Regular, Menlo, Consolas, monospace;
  font-size: 0.75rem;
  margin-left: 4px;
  overflow-wrap: anywhere;
  padding: 0;
}
</style>
