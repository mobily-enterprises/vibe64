<template>
  <section
    v-if="temporary.open.value"
    ref="workspace"
    class="vibe64-temporary-ai"
    aria-label="Temporary AI workspace"
    tabindex="-1"
  >
    <nav
      class="vibe64-temporary-ai__tabs"
      aria-label="Main and temporary conversations"
    >
      <div class="vibe64-temporary-ai__tab vibe64-temporary-ai__tab--main">
        <button
          class="vibe64-temporary-ai__tab-select"
          data-temporary-ai-main-chat
          type="button"
          @click="emit('select-main-chat')"
        >
          Main chat
        </button>
      </div>
      <div class="vibe64-temporary-ai__task-tabs">
        <div
          v-for="task in temporary.tasks.value"
          :key="task.id"
          class="vibe64-temporary-ai__tab"
          :class="{ 'vibe64-temporary-ai__tab--active': task.id === temporary.activeTaskId.value }"
        >
          <button
            :ref="(element) => setTaskTabButton(task.id, element)"
            :aria-current="task.id === temporary.activeTaskId.value ? 'page' : undefined"
            class="vibe64-temporary-ai__tab-select"
            :data-temporary-ai-task-id="task.id"
            :title="task.title"
            type="button"
            @click="temporary.selectTask(task.id)"
          >
            <span>{{ task.title }}</span>
            <span v-if="task.busy" class="vibe64-temporary-ai__busy" aria-label="Assistant working" />
          </button>
          <v-btn
            :aria-label="`Close ${task.title}`"
            class="vibe64-temporary-ai__tab-close"
            :disabled="props.repositoryBusy || task.recoveryOutcome === 'checking' || closingTask || stoppingTaskId === task.id"
            height="32"
            :icon="mdiClose"
            min-width="32"
            size="x-small"
            :title="`Close ${task.title}`"
            type="button"
            variant="text"
            @click="requestCloseTask(task)"
          />
        </div>
        <v-btn
          aria-label="New temporary AI task"
          class="vibe64-temporary-ai__new-task"
          height="32"
          :icon="mdiPlus"
          min-width="32"
          size="x-small"
          title="New temporary AI task"
          type="button"
          variant="text"
          @click="temporary.openTask()"
        />
      </div>
      <span class="vibe64-temporary-ai__tabs-spacer" />
      <v-btn
        v-if="activeTask"
        :aria-label="activeTask.policy === workspaceWritePolicy
          ? 'Read/write: temporary AI may edit this session'
          : 'Read-only: temporary AI cannot edit this session'"
        class="vibe64-temporary-ai__policy"
        :color="activeTask.policy === workspaceWritePolicy ? 'warning' : undefined"
        :disabled="taskInputDisabled(activeTask)"
        height="28"
        min-width="40"
        size="x-small"
        :title="activeTask.policy === workspaceWritePolicy
          ? 'R/W: temporary AI may edit this session. Click to make it read-only.'
          : 'R/O: temporary AI cannot edit this session. Click to allow edits.'"
        type="button"
        variant="tonal"
        @click="togglePolicy(activeTask)"
      >
        {{ activeTask.policy === workspaceWritePolicy ? "R/W" : "R/O" }}
      </v-btn>
    </nav>

    <template v-if="activeTask">
      <div class="vibe64-temporary-ai__recovery-row">
        <v-alert
          v-if="activeTask.recoveryNotice"
          aria-live="polite"
          class="vibe64-temporary-ai__recovery"
          :color="activeTaskRecoveryVerified ? 'success' : undefined"
          data-temporary-ai-recovery
          density="compact"
          :icon="activeTaskRecoveryVerified ? mdiCheckCircleOutline : mdiRobotOutline"
          role="status"
          :title="activeTaskRecoveryTitle"
          variant="tonal"
        >
          <p v-if="activeTaskRecoveryStatus && !activeTask.busy">{{ activeTaskRecoveryStatus }}</p>
          <v-btn
            v-if="activeTask.recoveryOperation === 'update' && !activeTaskRecoveryVerified"
            class="vibe64-temporary-ai__check-update"
            data-temporary-ai-check-update
            :disabled="props.updateDisabled || taskInputDisabled(activeTask)"
            :loading="activeTaskRecoveryChecking"
            :title="props.updateDisabled ? props.updateDisabledReason : 'Check whether the repaired session can update'"
            size="small"
            variant="tonal"
            @click="emit('check-update', activeTask)"
          >
            Check Update
          </v-btn>
        </v-alert>
      </div>
      <div class="vibe64-temporary-ai__messages" aria-live="polite">
        <Vibe64EphemeralConversationMessages
          :session-id="props.sessionId"
          :messages="activeTask.messages"
          empty-message="Ask a focused question or investigate a problem without adding it to the main conversation."
        />
      </div>

      <div
        v-if="activeTask.error || actionErrors[activeTask.id] || activeTask.busy || activeTaskRecoveryChecking"
        class="vibe64-temporary-ai__feedback"
      >
        <div v-if="actionErrors[activeTask.id] && !taskToClose" class="vibe64-temporary-ai__error" role="alert">
          {{ actionErrors[activeTask.id] }}
        </div>
        <div
          v-if="activeTask.error"
          class="vibe64-temporary-ai__error"
          :class="{ 'vibe64-temporary-ai__error--recovered': activeTaskRecoveryVerified }"
          :role="activeTaskRecoveryVerified ? 'status' : 'alert'"
        >
          <template v-if="activeTaskRecoveryVerified">
            Temporary AI did not report a clean finish: {{ activeTask.error }} The repair was independently verified.
          </template>
          <template v-else>{{ activeTask.error }}</template>
        </div>
        <Vibe64PromptHints
          v-if="activeTask.busy || activeTaskRecoveryChecking"
          class="vibe64-temporary-ai__activity"
          :assistant-label="activeTaskRecoveryChecking ? 'Checking Update…' : 'AI is working…'"
        />
      </div>

      <Vibe64AutopilotPromptTextarea
        v-for="task in temporary.tasks.value"
        v-show="task.id === activeTask.id"
        :key="task.id"
        :ref="(element) => setTaskPrompt(task.id, element)"
        :model-value="task.draft"
        aria-label="Message temporary AI"
        :attachments-enabled="Boolean(props.sessionId)"
        :disabled="taskInputDisabled(task)"
        placeholder="Ask temporary AI…"
        :rows="2"
        :session-id="props.sessionId"
        tab-to-submit
        @attachments-change="temporary.updateAttachments(task.id, $event)"
        @submit="sendTask(task.id)"
        @tab-to-submit="focusSendButton"
        @update:model-value="temporary.updateDraft(task.id, $event)"
      >
        <template #footer="{ attachmentState }">
          <div class="vibe64-temporary-ai__composer-actions">
            <Vibe64AgentSettingsMenu
              :agent-settings="task.agentSettings"
              :disabled="taskInputDisabled(task)"
              @update-setting="updateActiveAgentSetting"
            />
            <v-btn
              aria-label="Attach files"
              :disabled="taskInputDisabled(task) || !attachmentState.canAddFiles"
              :icon="mdiPaperclip"
              size="small"
              title="Attach files"
              type="button"
              variant="text"
              @click="taskPrompt(task.id)?.openFilePicker?.()"
            />
            <span class="vibe64-temporary-ai__spacer" />
            <v-btn
              v-if="task.busy"
              color="error"
              :prepend-icon="mdiStopCircleOutline"
              size="small"
              type="button"
              variant="tonal"
              :disabled="task.status === 'starting'"
              :loading="stoppingTaskId === task.id"
              @click="stopTask(task.id)"
            >
              Stop
            </v-btn>
            <v-btn
              v-else
              :ref="(element) => setTaskSendButton(task.id, element)"
              aria-label="Send to temporary AI"
              color="primary"
              :disabled="task.recoveryOutcome === 'checking' || !task.draft.trim() || !attachmentState.canSubmit"
              :icon="mdiArrowUp"
              size="small"
              title="Send to temporary AI"
              type="button"
              variant="flat"
              @click="sendTask(task.id)"
            />
          </div>
        </template>
      </Vibe64AutopilotPromptTextarea>
    </template>
    <v-dialog
      v-if="taskToClose"
      :model-value="true"
      :aria-labelledby="closeTitleId"
      max-width="480"
      persistent
    >
      <v-card>
        <v-card-title :id="closeTitleId" class="text-wrap">
          {{ taskToClose.busy ? 'Stop and close repair?' : 'Close incomplete repair?' }}
        </v-card-title>
        <v-card-text>
          Partial edits will stay in this session and may still need repair.
          Closing does not undo those edits or complete Update.
          <p v-if="actionErrors[taskToClose.id]" class="vibe64-temporary-ai__error" role="alert">
            {{ actionErrors[taskToClose.id] }}
          </p>
        </v-card-text>
        <v-card-actions class="flex-wrap">
          <v-btn :disabled="closingTask" @click="closeTaskId = ''">Keep chat open</v-btn>
          <v-btn
            color="error"
            :loading="closingTask"
            @click="closeTask(taskToClose.id)"
          >
            {{ taskToClose.busy ? 'Stop and close' : 'Close repair' }}
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import { computed, nextTick, ref, useId, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  mdiArrowUp,
  mdiCheckCircleOutline,
  mdiClose,
  mdiPaperclip,
  mdiPlus,
  mdiRobotOutline,
  mdiStopCircleOutline
} from "@mdi/js";

import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64EphemeralConversationMessages from "@/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue";
import Vibe64PromptHints from "@/components/studio/vibe64-session/Vibe64PromptHints.vue";
import {
  TEMPORARY_AI_WORKSPACE_WRITE_POLICY,
  useVibe64TemporaryAi
} from "@/composables/useVibe64TemporaryAi.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const emit = defineEmits(["select-main-chat", "task-finished", "check-update"]);
const props = defineProps({
  active: Boolean,
  repositoryBusy: Boolean,
  updateDisabled: Boolean,
  updateDisabledReason: { type: String, default: "" },
  agentSettings: {
    default: () => ({}),
    type: Object
  },
  sessionId: {
    default: "",
    type: String
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  }
});

const workspace = ref(null);
const taskTabButtons = new Map();
const taskPrompts = new Map();
const taskSendButtons = new Map();
const resolvedSessionsApiPath = computed(() => readRefOrGetterValue(props.sessionsApiPath));
const temporaryAiFeedback = useUiFeedback({
  source: "vibe64.temporary-ai.feedback"
});
const temporary = useVibe64TemporaryAi({
  agentSettings: computed(() => props.agentSettings),
  operationBusy: () => props.repositoryBusy,
  onTaskFinished(task = {}) {
    emit("task-finished", task);
    if (props.active && temporary.open.value && temporary.activeTaskId.value === task.id) return;
    if (task.status === "completed") {
      if (task.outcomeKind === "continue" || task.recoveryOperation === "update") {
        return;
      }
      temporaryAiFeedback.success(
        task.completionMessage || `${task.title} finished. Review the result before continuing.`
      );
      return;
    }
    if (task.status === "failed" && task.failureMessage) {
      temporaryAiFeedback.error(task.failureMessage);
      return;
    }
    temporaryAiFeedback.error(task.error, `${task.title} stopped with an error.`);
  },
  sessionId: computed(() => props.sessionId),
  sessionsApiPath: resolvedSessionsApiPath
});
const activeTask = temporary.activeTask;
const closeTitleId = useId();
const closeTaskId = ref("");
const closingTask = ref(false);
const stoppingTaskId = ref("");
const actionErrors = ref({});
const taskToClose = computed(() => temporary.tasks.value.find((task) => task.id === closeTaskId.value));
const activeTaskRecoveryChecking = computed(() => activeTask.value?.recoveryOutcome === "checking");
const activeTaskRecoveryVerified = computed(() => (
  activeTask.value?.recoveryOutcome === "succeeded"
));
const activeTaskRecoveryTitle = computed(() => {
  if (activeTaskRecoveryChecking.value) {
    return "Checking Update…";
  }
  const status = String(activeTask.value?.status || "").trim();
  if (["starting", "inProgress"].includes(status)) {
    return "AI repair in progress";
  }
  if (activeTask.value?.recoveryOutcome === "failed") {
    return "Update needs attention";
  }
  if (activeTaskRecoveryVerified.value) {
    return activeTask.value?.recoveryOperation === "update" ? "Session updated" : "Repair verified";
  }
  if (activeTask.value?.recoveryOperation === "update") {
    return "Update not yet verified";
  }
  if (activeTask.value?.outcomeKind === "continue") {
    return "Waiting for your reply";
  }
  if (status === "completed") {
    return "AI repair finished";
  }
  if (status === "failed") {
    return "AI repair needs attention";
  }
  if (status === "interrupted") {
    return "AI repair stopped";
  }
  return "AI repair";
});
const activeTaskRecoveryStatus = computed(() => {
  const task = activeTask.value || {};
  if (task.recoveryOutcome === "checking") {
    return "";
  }
  if (task.recoveryOutcome === "succeeded") {
    return task.recoveryOutcomeMessage || "Vibe64 independently verified that the repair succeeded.";
  }
  if (task.recoveryOperation === "update" && props.updateDisabled && props.updateDisabledReason) {
    return props.updateDisabledReason;
  }
  if (task.recoveryOutcome === "failed") {
    return task.recoveryAutoPaused
      ? "Automatic repair paused after repeated conflicts. Continue here or check Update again; the latest diagnostic is in the activity panel above."
      : "The Update check did not succeed. Continue this repair or check Update again; the latest diagnostic is in the activity panel above.";
  }
  if (task.recoveryOperation === "update" && task.outcomeKind === "continue") {
    return "Reply if a decision is needed, or use Check Update to verify the prepared edits.";
  }
  if (task.outcomeKind === "continue") {
    return "";
  }
  const status = String(task.status || "").trim();
  if (status === "completed") {
    return task.completionMessage || "Temporary AI finished. Review its result below.";
  }
  if (status === "failed") {
    return task.failureMessage || "Temporary AI stopped before it could confirm the repair. Review the error and progress below.";
  }
  if (status === "interrupted") {
    return task.recoveryOperation === "update"
      ? "You stopped this repair. Partial edits remain and Update still needs to succeed. You can continue the repair here."
      : "You stopped this repair. You can continue in this temporary chat or return to Main chat.";
  }
  return task.nextStepMessage || "Follow progress here and reply below if Temporary AI needs a decision.";
});
const workspaceWritePolicy = TEMPORARY_AI_WORKSPACE_WRITE_POLICY;

function requestCloseTask(task) {
  if (task.recoveryOperation === "update" && task.recoveryOutcome !== "succeeded" && (task.busy || task.messages.length)) {
    closeTaskId.value = task.id;
    return;
  }
  void closeTask(task.id);
}

async function closeTask(taskId) {
  closingTask.value = true;
  delete actionErrors.value[taskId];
  try {
    await temporary.closeTask(taskId);
    closeTaskId.value = "";
  } catch (error) {
    actionErrors.value[taskId] = error?.message || "Temporary AI could not be closed. The chat is still open; try again.";
  } finally {
    closingTask.value = false;
  }
}

async function stopTask(taskId) {
  stoppingTaskId.value = taskId;
  delete actionErrors.value[taskId];
  try {
    await temporary.stopTask(taskId);
  } catch (error) {
    actionErrors.value[taskId] = error?.message || "Temporary AI could not be stopped. Try again.";
  } finally {
    stoppingTaskId.value = "";
  }
}

function taskInputDisabled(task) {
  return props.repositoryBusy || task.busy || task.recoveryOutcome === "checking";
}

function taskPrompt(taskId = "") {
  return taskPrompts.get(String(taskId || "")) || null;
}

function setTaskPrompt(taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    taskPrompts.set(normalizedTaskId, element);
    return;
  }
  taskPrompts.delete(normalizedTaskId);
}

function setTaskSendButton(taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    taskSendButtons.set(normalizedTaskId, element);
    return;
  }
  taskSendButtons.delete(normalizedTaskId);
}

async function sendTask(taskId = "") {
  const currentPrompt = taskPrompt(taskId);
  if (!taskId || currentPrompt?.attachmentsCanSubmit?.() === false) {
    return;
  }
  const sent = await temporary.send(taskId);
  if (sent) {
    currentPrompt?.clearAttachments?.();
  }
  return sent;
}

async function startTask(options = {}) {
  const started = temporary.startTask(options);
  const taskId = temporary.activeTaskId.value;
  await revealTaskTab(taskId, { focus: true });
  const result = await started;
  if (result?.started) {
    taskPrompt(taskId)?.clearAttachments?.();
  }
  return result;
}

function reportTaskRecovery(taskId = "", outcome = {}) {
  const reported = temporary.reportRecoveryOutcome(taskId, outcome);
  if (reported && outcome.status === "succeeded" &&
      !(props.active && temporary.open.value && temporary.activeTaskId.value === taskId)) {
    temporaryAiFeedback.success(
      outcome.message || "Vibe64 independently verified that the repair succeeded."
    );
  }
  return reported;
}

function showWorkspace() {
  const task = temporary.showWorkspace();
  void revealTaskTab(temporary.activeTaskId.value);
  return task;
}

function setTaskTabButton(taskId = "", element = null) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return;
  }
  if (element) {
    taskTabButtons.set(normalizedTaskId, element);
    return;
  }
  taskTabButtons.delete(normalizedTaskId);
}

function afterBrowserPaint() {
  if (typeof globalThis.requestAnimationFrame !== "function") {
    return Promise.resolve();
  }
  return new Promise((resolve) => {
    globalThis.requestAnimationFrame(() => resolve());
  });
}

async function revealTaskTab(taskId = "", { focus = false } = {}) {
  const normalizedTaskId = String(taskId || "");
  if (!normalizedTaskId) {
    return false;
  }
  await nextTick();
  await afterBrowserPaint();
  const button = taskTabButtons.get(normalizedTaskId);
  button?.scrollIntoView?.({
    block: "nearest",
    inline: "nearest"
  });
  if (focus) {
    const target = button || workspace.value;
    target?.focus?.({ preventScroll: true });
  }
  return Boolean(button);
}

function focusSendButton() {
  const sendButton = taskSendButtons.get(activeTask.value?.id);
  const button = sendButton?.$el || sendButton;
  button?.focus?.();
}

function togglePolicy(task = {}) {
  const policy = task.policy === workspaceWritePolicy ? "read" : workspaceWritePolicy;
  temporary.updatePolicy(task.id, policy);
}

function updateActiveAgentSetting(parameterId = "", value = "") {
  if (activeTask.value?.id) {
    temporary.updateAgentSetting(activeTask.value.id, parameterId, value);
  }
}

watch(() => temporary.activeTaskId.value, (taskId) => {
  void revealTaskTab(taskId);
}, { flush: "post" });

defineExpose({
  closeWorkspace: temporary.closeWorkspace,
  openTask: temporary.openTask,
  reportTaskRecovery,
  selectTask: temporary.selectTask,
  startTask,
  showWorkspace,
  updateRepairTask: temporary.updateRepairTask
});
</script>

<style scoped>
.vibe64-temporary-ai {
  background: rgb(var(--v-theme-surface));
  border: 2px solid rgba(var(--v-theme-tertiary), 0.42);
  border-radius: 12px;
  bottom: 0.3rem;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.22);
  display: grid;
  grid-row: 3 / -1;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr) auto auto;
  left: 0.3rem;
  min-height: 0;
  overflow: hidden;
  position: absolute;
  right: 0.3rem;
  top: 0;
  z-index: 12;
}

.vibe64-temporary-ai__composer-actions {
  align-items: center;
  display: flex;
}

.vibe64-temporary-ai__tabs {
  align-items: center;
  background: rgba(var(--v-theme-tertiary), 0.06);
  border-bottom: 1px solid rgba(var(--v-theme-tertiary), 0.18);
  display: flex;
  gap: 0.25rem;
  padding: 0.25rem 0.35rem;
}

.vibe64-temporary-ai__task-tabs {
  display: flex;
  flex: 1 1 auto;
  gap: 0.25rem;
  min-width: 0;
  overflow-x: auto;
  scrollbar-width: thin;
}

.vibe64-temporary-ai__tab {
  align-items: center;
  background: rgba(var(--v-theme-on-surface), 0.05);
  border: 1px solid transparent;
  border-radius: 999px;
  color: inherit;
  display: inline-flex;
  flex: 0 0 auto;
  max-width: 100%;
  min-height: 2rem;
  padding-left: 0.15rem;
}

.vibe64-temporary-ai__tab-select {
  align-items: center;
  align-self: stretch;
  background: transparent;
  border: 0;
  color: inherit;
  cursor: pointer;
  display: inline-flex;
  gap: 0.35rem;
  min-width: 0;
  padding: 0.2rem 0.35rem 0.2rem 0.55rem;
}

.vibe64-temporary-ai__tab-select > span:first-child {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.vibe64-temporary-ai__tab-close {
  flex: 0 0 auto;
}

.vibe64-temporary-ai:focus-visible,
.vibe64-temporary-ai__tab-select:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.vibe64-temporary-ai__tab--active {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.35);
  font-weight: 650;
}

.vibe64-temporary-ai__tab--main {
  background: rgb(var(--v-theme-surface));
  border-color: rgba(var(--v-theme-tertiary), 0.22);
}

.vibe64-temporary-ai__new-task {
  flex: 0 0 auto;
}

.vibe64-temporary-ai__tabs-spacer {
  flex: 1 1 auto;
}

.vibe64-temporary-ai__policy {
  flex: 0 0 auto;
  font-weight: 700;
}

.vibe64-temporary-ai__busy {
  background: rgb(var(--v-theme-primary));
  border-radius: 50%;
  height: 0.45rem;
  width: 0.45rem;
}

.vibe64-temporary-ai__messages {
  display: flex;
  flex-direction: column;
  gap: 0.55rem;
  min-height: 0;
  overflow-y: auto;
  padding: 0.55rem;
}

.vibe64-temporary-ai__recovery {
  flex: 0 0 auto;
  font-size: 0.85rem;
  overflow-wrap: anywhere;
}

.vibe64-temporary-ai__recovery-row:not(:empty) {
  padding: 0.35rem 0.55rem 0;
}

.vibe64-temporary-ai__recovery :deep(.v-alert-title) {
  font-size: 0.95rem;
  line-height: 1.4;
}

.vibe64-temporary-ai__check-update {
  margin-top: 0.4rem;
}

.vibe64-temporary-ai__recovery p {
  margin: 0;
}

.vibe64-temporary-ai__recovery p + p {
  margin-top: 0.3rem;
}

.vibe64-temporary-ai__error {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.82rem;
}

.vibe64-temporary-ai__feedback {
  min-width: 0;
}

.vibe64-temporary-ai__error {
  color: rgb(var(--v-theme-error));
  padding: 0.3rem 0.55rem;
}

.vibe64-temporary-ai__error--recovered {
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.vibe64-temporary-ai :deep(.studio-autopilot-prompt-textarea) {
  margin: 4px;
  width: auto;
}

.vibe64-temporary-ai__composer-actions {
  gap: 0.2rem;
  width: 100%;
}

.vibe64-temporary-ai__spacer {
  flex: 1 1 auto;
}

@media (max-width: 720px) {
  .vibe64-temporary-ai {
    border: 0;
    border-radius: 0;
    inset: 0;
    z-index: 30;
  }
}

@media (pointer: coarse) {
  .vibe64-temporary-ai__tab-select,
  .vibe64-temporary-ai__new-task,
  .vibe64-temporary-ai__policy,
  .vibe64-temporary-ai__tab-close,
  .vibe64-temporary-ai__check-update,
  .vibe64-temporary-ai__composer-actions .v-btn {
    min-height: 3rem !important;
    min-width: 3rem !important;
  }
}
</style>
