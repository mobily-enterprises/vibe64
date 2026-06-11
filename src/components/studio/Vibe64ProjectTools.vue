<template>
  <div
    class="vibe64-project-tools"
    :class="`vibe64-project-tools--${displayMode}`"
  >
    <v-menu
      v-if="menuMode"
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
          @click="refreshTools"
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

    <section
      v-else
      class="vibe64-project-tools__panel"
      aria-label="Remote project tools"
    >
      <v-progress-linear
        v-if="loading"
        color="primary"
        indeterminate
        rounded
      />

      <v-list
        class="vibe64-project-tools__list"
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
          subtitle="Configure remote project tools before using this section."
          title="No remote tools"
        />
      </v-list>
    </section>

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
import Vibe64CommandTerminal from "@/components/studio/Vibe64CommandTerminal.vue";
import Vibe64FixCodexDialog from "@/components/studio/Vibe64FixCodexDialog.vue";
import {
  useVibe64ProjectTools,
  vibe64ProjectToolsEmits,
  vibe64ProjectToolsProps
} from "@/composables/useVibe64ProjectTools.js";

const emit = defineEmits(vibe64ProjectToolsEmits);
const props = defineProps(vibe64ProjectToolsProps);

const {
  confirmationDialogOpen,
  confirmRun,
  displayMode,
  fixDialogOpen,
  fixJob,
  fixTerminal,
  handleFixRequested,
  loading,
  mdiChevronDown,
  mdiTools,
  menuMode,
  menuOpen,
  parameterValues,
  parametersDialogOpen,
  refreshTools,
  runParameters,
  selectedTool,
  selectedToolParameters,
  selectTool,
  submitParameters,
  terminalDialogOpen,
  terminalStartKey,
  terminalTool,
  tools
} = useVibe64ProjectTools(props, emit);
</script>

<style scoped>
.vibe64-project-tools {
  flex: 0 0 auto;
}

.vibe64-project-tools--panel {
  display: grid;
  gap: 0.75rem;
  min-width: 0;
}

.vibe64-project-tools__menu {
  max-width: min(30rem, calc(100vw - 2rem));
  min-width: min(23rem, calc(100vw - 2rem));
}

.vibe64-project-tools__panel {
  display: grid;
  gap: 0.65rem;
  min-width: 0;
}

.vibe64-project-tools__list {
  border: 1px solid rgba(var(--v-theme-outline), 0.18);
  border-radius: 8px;
  min-width: 0;
}

.vibe64-project-tools__menu :deep(.v-list-item-subtitle),
.vibe64-project-tools__list :deep(.v-list-item-subtitle) {
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
