<template>
  <div class="vibe64-project-tools">
    <v-menu
      v-model="menuOpen"
      location="bottom end"
      transition="scale-transition"
    >
      <template #activator="{ props: menuProps }">
        <v-btn
          v-bind="menuProps"
          :append-icon="mdiChevronDown"
          :loading="loading"
          :prepend-icon="mdiTools"
          size="small"
          type="button"
          variant="tonal"
          @click="loadTools"
        >
          Tools
        </v-btn>
      </template>

      <v-list
        class="vibe64-project-tools__menu"
        density="comfortable"
        lines="two"
        nav
      >
        <v-list-subheader>Project tools</v-list-subheader>
        <v-list-item
          v-for="tool in tools"
          :key="tool.id"
          :disabled="tool.enabled !== true"
          :subtitle="tool.enabled === true ? tool.description : tool.disabledReason"
          :title="tool.label"
          @click="selectTool(tool)"
        />
        <v-list-item
          v-if="!tools.length && !loading"
          disabled
          subtitle="No project tools are available."
          title="No tools"
        />
      </v-list>
    </v-menu>

    <v-dialog v-model="parametersDialogOpen" max-width="34rem">
      <v-card>
        <v-card-title>{{ selectedTool?.label }}</v-card-title>
        <v-card-text>
          <v-form class="vibe64-project-tools__form" @submit.prevent="submitParameters">
            <template
              v-for="parameter in selectedToolParameters"
              :key="parameter.id"
            >
              <v-select
                v-if="parameter.type === 'enum'"
                v-model="parameterValues[parameter.id]"
                :items="parameter.options"
                item-title="label"
                item-value="value"
                :label="parameter.label"
                :hint="parameter.description"
                persistent-hint
                density="compact"
              />
              <v-text-field
                v-else
                v-model="parameterValues[parameter.id]"
                :type="parameter.type === 'integer' ? 'number' : 'text'"
                :label="parameter.label"
                :hint="parameter.description"
                persistent-hint
                density="compact"
              />
            </template>
          </v-form>
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="parametersDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="submitParameters">Run</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="confirmationDialogOpen" max-width="32rem">
      <v-card>
        <v-card-title>{{ selectedTool?.label }}</v-card-title>
        <v-card-text>
          {{ selectedTool?.confirmationMessage || "Run this project tool?" }}
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="confirmationDialogOpen = false">Cancel</v-btn>
          <v-btn color="primary" variant="flat" @click="confirmRun">Run</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <v-dialog v-model="terminalDialogOpen" fullscreen>
      <v-card class="vibe64-project-tools__terminal-dialog">
        <v-card-text>
          <Vibe64CommandTerminal
            v-if="terminalTool"
            :action="terminalTool"
            :action-input="runParameters"
            ai-fix-available
            :emit-closed-before-server-ack="true"
            terminal-kind="tool"
            :start-request-key="terminalStartKey"
            :title="terminalTool.label"
            @closed="terminalDialogOpen = false"
            @fix-requested="handleFixRequested"
          />
        </v-card-text>
      </v-card>
    </v-dialog>

    <Vibe64FixCodexDialog
      v-model="fixDialogOpen"
      :job="fixJob"
      :terminal="fixTerminal"
    />
  </div>
</template>

<script setup>
import { computed, onMounted, reactive, ref } from "vue";
import {
  mdiChevronDown,
  mdiTools
} from "@mdi/js";
import Vibe64CommandTerminal from "@/components/studio/Vibe64CommandTerminal.vue";
import Vibe64FixCodexDialog from "@/components/studio/Vibe64FixCodexDialog.vue";
import {
  useVibe64FixCodexDialog
} from "@/composables/useVibe64FixCodexDialog.js";
import {
  readVibe64ProjectTools,
  runVibe64ProjectTool
} from "@/lib/vibe64SessionApi.js";

const emit = defineEmits([
  "global-codex-open",
  "global-codex-update"
]);

const loading = ref(false);
const menuOpen = ref(false);
const tools = ref([]);
const selectedTool = ref(null);
const parametersDialogOpen = ref(false);
const confirmationDialogOpen = ref(false);
const terminalDialogOpen = ref(false);
const terminalTool = ref(null);
const terminalStartKey = ref("");
const runParameters = ref({});
const parameterValues = reactive({});
const {
  fixDialogOpen,
  fixJob,
  fixTerminal,
  openFixCodexDialog
} = useVibe64FixCodexDialog();

const selectedToolParameters = computed(() => (
  Array.isArray(selectedTool.value?.parameters) ? selectedTool.value.parameters : []
));

async function loadTools() {
  if (loading.value) {
    return;
  }
  loading.value = true;
  try {
    const response = await readVibe64ProjectTools();
    tools.value = Array.isArray(response?.tools) ? response.tools : [];
  } finally {
    loading.value = false;
  }
}

function resetParameterValues(tool = {}) {
  for (const key of Object.keys(parameterValues)) {
    delete parameterValues[key];
  }
  for (const parameter of Array.isArray(tool.parameters) ? tool.parameters : []) {
    parameterValues[parameter.id] = parameter.defaultValue ?? "";
  }
}

function selectTool(tool = {}) {
  if (tool.enabled !== true) {
    return;
  }
  selectedTool.value = tool;
  resetParameterValues(tool);
  menuOpen.value = false;
  if (selectedToolParameters.value.length) {
    parametersDialogOpen.value = true;
    return;
  }
  queueRun({});
}

function submitParameters() {
  parametersDialogOpen.value = false;
  queueRun({ ...parameterValues });
}

function queueRun(parameters = {}) {
  runParameters.value = parameters;
  if (selectedTool.value?.requiresConfirmation) {
    confirmationDialogOpen.value = true;
    return;
  }
  void runSelectedTool();
}

function confirmRun() {
  confirmationDialogOpen.value = false;
  void runSelectedTool();
}

async function runSelectedTool() {
  const tool = selectedTool.value;
  if (!tool?.id) {
    return;
  }
  if (tool.type === "prompt") {
    const response = await runVibe64ProjectTool(tool.id, {
      parameters: runParameters.value
    });
    if (response?.ok !== false) {
      emit("global-codex-update", response);
      emit("global-codex-open");
    }
    return;
  }
  terminalTool.value = tool;
  terminalStartKey.value = `${tool.id}:${Date.now()}`;
  terminalDialogOpen.value = true;
}

const handleFixRequested = openFixCodexDialog;

onMounted(loadTools);
</script>

<style scoped>
.vibe64-project-tools {
  flex: 0 0 auto;
}

.vibe64-project-tools__menu {
  max-width: min(30rem, calc(100vw - 2rem));
  min-width: min(23rem, calc(100vw - 2rem));
}

.vibe64-project-tools__menu :deep(.v-list-item-subtitle) {
  white-space: normal;
}

.vibe64-project-tools__form {
  display: grid;
  gap: 0.85rem;
}

.vibe64-project-tools__terminal-dialog {
  min-height: 100%;
}
</style>
