<template>
  <section
    v-if="temporary.open.value || hostConversation?.selected"
    ref="workspace"
    class="vibe64-temporary-ai"
    :class="{ 'vibe64-temporary-ai--host': hostConversation?.selected }"
    :aria-label="hostConversation?.selected ? hostConversation.label : 'Temporary AI workspace'"
    tabindex="-1"
  >
    <Vibe64TemporaryAiTabs
      :tasks="temporary.tasks.value"
      :active-task-id="temporary.activeTaskId.value"
      :set-tab-button="setTaskTabButton"
      :session-id="props.sessionId"
      :repository-busy="props.repositoryBusy"
      :closing-task="closingTask"
      :stopping-task-id="stoppingTaskId"
      @select-main-chat="selectMainChat"
      @select-task="selectTask"
      @rename="openRename"
      @close="requestCloseTask"
      @new-task="openNewTask"
    />

    <v-dialog
      v-if="newTaskOpen" :model-value="newTaskOpen" aria-label="New temporary chat" max-width="480" :persistent="creatingTask"
      @update:model-value="value => { if (!value) cancelNewTask(); }"
    >
      <v-card title="New temporary chat">
        <v-card-text>
          <v-checkbox v-model="includeRecentChatContext" :disabled="creatingTask || Boolean(creatingTaskId)" label="Include recent chat context" hide-details />
          <p>Copy up to 40 recent visible messages from Main, including progress. Text only, limited to 64 KiB. Later messages stay separate.</p>
          <v-alert v-if="createTaskError" type="error" variant="tonal">{{ createTaskError }}</v-alert>
        </v-card-text>
        <v-card-actions>
          <v-btn :disabled="creatingTask" @click="cancelNewTask">Cancel</v-btn>
          <v-btn :loading="creatingTask" :disabled="creatingTask" @click="createTask">Create chat</v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <component
      :is="hostConversation.component" v-if="hostConversation?.selected && props.active"
      ref="hostComposer" class="vibe64-temporary-ai__host-content"
    />
    <template v-if="!hostConversation?.selected">
      <Vibe64TemporaryAiRecoveryRow
        :active-task="activeTask"
        :restore-error="temporary.restoreError.value"
        :recovery-verified="activeTaskRecoveryVerified"
        :recovery-checking="activeTaskRecoveryChecking"
        :input-disabled="Boolean(activeTask) && taskInputDisabled(activeTask)"
        :connection-unavailable="props.connectionUnavailable"
        :update-disabled="props.updateDisabled"
        :update-disabled-reason="props.updateDisabledReason"
        :can-review-update="props.canReviewUpdate"
        @retry-restore="temporary.restoreTasks()"
        @check-update="emit('check-update', $event)"
        @review-update="emit('review-update')"
      />
      <template v-if="activeTask">
        <Vibe64EphemeralConversationMessages
          :session-id="props.sessionId"
          :adapter="activeTask.adapter"
          :recovery-message="activeTask.recoveryMessage"
          :routing-request="routingRequest"
          :working="activeTask.nativeWorking"
          :scroll-key="activeTask.id"
          :empty-message="activeTask.recoveryNotice ? '' : 'Ask a focused question or investigate a problem without adding it to the main conversation.'"
          @resend="sendTask(activeTask.id, { retryMessageId: $event })"
          @cancel="temporary.cancelMessage(activeTask.id, $event)"
          @edit="temporary.editMessage(activeTask.id, $event)"
        >
          <template #message-text="{ message }">
            <p v-if="message.messageId === recoveryMessageId" ref="completionMessage">{{ updateCompletionText || message.text }}</p>
            <p v-else>{{ message.text }}</p>
            <v-btn
              v-if="message.messageId === recoveryMessageId && canReturnToMainChat"
              ref="returnToMainButton"
              :aria-busy="closingTask"
              class="vibe64-temporary-ai__return"
              color="primary"
              :disabled="props.repositoryBusy || closingTask"
              size="small"
              variant="tonal"
              @click="closeTask(activeTask.id, { returnToMainChat: true })"
            >
              Return to main chat
            </v-btn>
          </template>
          <template #hints>
            <p v-if="activeTask.recentChatContext && !activeTask.messages.length">
              Copied {{ activeTask.recentChatContext.messages.length }} messages from Main when this chat was created.
              <span v-if="activeTask.recentChatContext.truncated">Some text was omitted to fit the 64 KiB context limit.</span>
            </p>
            <div
              v-if="activeTaskError || actionErrors[activeTask.id] || activityLabel"
              class="vibe64-temporary-ai__feedback"
            >
              <div v-if="actionErrors[activeTask.id] && !taskToClose" class="vibe64-temporary-ai__error" role="alert">
                {{ actionErrors[activeTask.id] }}
              </div>
              <div
                v-if="activeTaskError"
                class="vibe64-temporary-ai__error"
                :class="{ 'vibe64-temporary-ai__error--recovered': activeTaskRecoveryVerified }"
                :role="activeTaskRecoveryVerified ? 'status' : 'alert'"
              >
                <template v-if="activeTaskRecoveryVerified">
                  Temporary AI did not report a clean finish: {{ activeTaskError }} The repair was independently verified.
                </template>
                <template v-else>{{ activeTaskError }}</template>
              </div>
              <AssistantComposerSupport
                v-if="activityLabel"
                class="vibe64-temporary-ai__activity"
                :activity="{ label: activityLabel }"
              />
            </div>
          </template>
          <template #composer>
            <p v-if="activeTask.draftSaveState === 'failed'" class="text-caption" role="status" aria-live="polite">
              Draft not saved; check the error and retry.
            </p>
            <Vibe64AutopilotPromptTextarea
              v-for="task in temporary.tasks.value"
              v-show="task.id === activeTask.id"
              :key="task.id"
              :saved-attachments="task.attachments"
              attachments-owned-by-conversation
              :ref="(element) => setTaskPrompt(task.id, element)"
              class="vibe64-temporary-ai__composer"
              :model-value="task.draft && (task.displayMessage || task.draft)"
              aria-label="Message temporary AI"
              density="compact"
              :attachments-enabled="Boolean(props.sessionId) && !taskInputDisabled(task)"
              :disabled="task.state === 'closing' || task.status === 'closing' || Boolean(taskAccessReason(task))"
              placeholder="Ask temporary AI…"
              :rows="2"
              :session-id="props.sessionId"
              tab-to-submit
              @attachments-change="temporary.updateAttachments(task.id, $event)"
              @blur="typingPresence.blur()"
              @input-activity="typingPresence.noteInputActivity()"
              @submit="sendTask(task.id)"
              @tab-to-submit="focusSendButton"
              @update:model-value="temporary.updateDraft(task.id, $event)"
            >
              <template #footer="{ attachmentState }">
                <div class="vibe64-temporary-ai__composer-actions">
                  <Vibe64ChatModeControls
                    v-if="task.id === activeTask.id" :session="modeSession" :goal="task.goal" temporary
                    :required-mode="task.recoveryOperation === 'update' ? 'fix' : ''"
                    :save-preferences="(preferences) => temporary.updateRouting(task.id, preferences)"
                    :active="task.busy" :disabled="props.repositoryBusy || task.status === 'closing'"
                    :can-configure="props.canConfigureRouting"
                    :purposes="task.purposes"
                    :loading="!task.purposes"
                    @custom="customTarget = $event; customOpen = true"
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
                  <v-btn
                    v-if="previewAttachmentState.captureAvailable"
                    aria-label="Attach preview screenshot"
                    :disabled="taskInputDisabled(task) || !attachmentState.canAddFiles || previewAttachmentState.captureBusy"
                    :aria-busy="previewAttachmentState.captureBusy ? 'true' : undefined"
                    :icon="mdiCameraOutline"
                    size="small"
                    title="Attach preview screenshot"
                    variant="text"
                    @click="previewAttachmentState.capture?.()"
                  />
                  <v-btn
                    v-if="previewAttachmentState.diagnosticsAvailable"
                    aria-label="Attach console and network diagnostics"
                    :disabled="taskInputDisabled(task) || !attachmentState.canAddFiles || previewAttachmentState.diagnosticsBusy"
                    :aria-busy="previewAttachmentState.diagnosticsBusy ? 'true' : undefined"
                    :icon="mdiConsoleNetworkOutline"
                    size="small"
                    title="Attach console and network diagnostics"
                    variant="text"
                    @click="previewAttachmentState.attachDiagnostics?.()"
                  />
                  <Vibe64AgentSettingsMenu
                    v-if="!task.routingMetadata?.assistant_routing"
                    :agent-settings="task.agentSettings"
                    :assistant-selection="task.assistantSelection || props.assistantSelection"
                    :disabled="props.repositoryBusy || task.status === 'closing'"
                    @update-setting="updateActiveAgentSetting"
                  />
                  <Vibe64ComposerDelivery
                    :ref="element => setTaskSendButton(task.id, element)"
                    :stop-visible="task.busy" :stop-enabled="Boolean(task.conversationId) && stoppingTaskId !== task.id"
                    :stopping="stoppingTaskId === task.id" :sending="task.delivery.state.sending"
                    :can-submit="!props.connectionUnavailable && stoppingTaskId !== task.id && !taskInputDisabled(task) && Boolean(task.draft.trim()) && attachmentState.canSubmit"
                    :submit-mode="task.busy ? 'steer' : 'send'"
                    :submit-aria-label="task.busy ? 'Steer assistant' : 'Send message'"
                    :submit-title="task.busy ? 'Send this guidance to the active assistant turn' : 'Send message'"
                    @submit="sendTask(task.id)" @stop="stopTask(task.id)"
                  />
                </div>
              </template>
            </Vibe64AutopilotPromptTextarea>
          </template>
        </Vibe64EphemeralConversationMessages>
      </template>
      <Vibe64SessionAssistantMenu
        v-model="customOpen" :target="customTarget" :session="modeSession"
        :can-configure="props.canConfigureRouting" :changes-disabled="props.repositoryBusy || activeTask?.status === 'closing'"
        :save-selection="(selection) => temporary.updateRouting(activeTask.id, { mode: 'custom', review: false, override: selection })"
      />
      <v-dialog
        v-if="renamingTask"
        aria-label="Rename chat"
        :model-value="true"
        max-width="28rem"
        :persistent="renamePending"
        @update:model-value="!$event && (renamingTaskId = '')"
      >
        <v-card rounded="xl">
          <form @submit.prevent="submitRename">
            <v-card-title class="pa-6 pb-2">
              <h2 class="text-title-large">Rename chat</h2>
            </v-card-title>
            <v-card-text class="px-6">
              <v-text-field
                v-model="renameValue"
                label="Chat name"
                variant="outlined"
                maxlength="80"
                autofocus
                :disabled="renamePending"
                :placeholder="`Temporary ${renamingTask.number || ''}`.trim()"
                hint="Leave empty to use the numbered name."
                persistent-hint
                :error-messages="renameError"
              />
            </v-card-text>
            <v-card-actions class="pa-6 pt-2">
              <v-spacer />
              <v-btn height="48" variant="text" :disabled="renamePending" @click="renamingTaskId = ''">Cancel</v-btn>
              <v-btn type="submit" height="48" color="primary" variant="flat" rounded="pill" :loading="renamePending">Rename</v-btn>
            </v-card-actions>
          </form>
        </v-card>
      </v-dialog>
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
    </template>
  </section>
</template>

<script setup>
import Vibe64ComposerDelivery from "./Vibe64ComposerDelivery.vue";
import Vibe64SessionAssistantMenu from "./Vibe64SessionAssistantMenu.vue";
import Vibe64ChatModeControls from "./Vibe64ChatModeControls.vue";
import Vibe64TemporaryAiRecoveryRow from "./Vibe64TemporaryAiRecoveryRow.vue";
import Vibe64TemporaryAiTabs from "./Vibe64TemporaryAiTabs.vue";
import { computed, inject, nextTick, ref, useId, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";
import {
  mdiCameraOutline,
  mdiConsoleNetworkOutline,
  mdiPaperclip,
} from "@mdi/js";

import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64EphemeralConversationMessages from "@/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue";
import { AssistantComposerSupport } from "@jskit-ai/assistant-core/client/conversation";
import {
  useVibe64TemporaryAi
} from "@/composables/useVibe64TemporaryAi.js";
import { useVibe64TemporaryAiColleagueView } from "@/composables/useVibe64TemporaryAiColleagueView.js";
import { useVibe64TemporaryAiNewTask } from "@/composables/useVibe64TemporaryAiNewTask.js";
import { useVibe64TemporaryAiRename } from "@/composables/useVibe64TemporaryAiRename.js";
import { useVibe64TemporaryAiStopAndClose } from "@/composables/useVibe64TemporaryAiStopAndClose.js";
import { useVibe64TemporaryAiTaskElements } from "@/composables/useVibe64TemporaryAiTaskElements.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { assistantRoutingFromMetadata, assistantRoutingRequestForDisplay } from "@local/vibe64-runtime/shared/assistantRouting";
import { useVibe64SessionTypingPresence } from "@/composables/useVibe64SessionTypingPresence.js";

import { VIBE64_HOST_CONVERSATION_KEY } from "@/lib/vibe64AssistantHost.js";

const emit = defineEmits(["select-main-chat", "task-finished", "check-update", "review-update"]);
const props = defineProps({
  // Opens one project file in this session's Dashboard → Files editor (a
  // Colleague "show me" guide); returns true only when that file opened.
  openFile: { type: Function, default: null },
  sendLessonMessage: { type: Function, default: null },
  active: Boolean,
  sessionSelected: Boolean,
  assistantReady: Boolean,
  canConfigureRouting: Boolean,
  connectionUnavailable: Boolean,
  projectSlug: { type: String, default: "" },
  previewAttachmentState: { type: Object, default: () => ({}) },
  repositoryBusy: Boolean,
  updateDisabled: Boolean,
  canReviewUpdate: Boolean,
  updateDisabledReason: { type: String, default: "" },
  workspaceSetupStatus: { type: String, default: "" },
  assistantSelection: {
    default: () => ({}),
    type: Object
  },
  sessionId: {
    default: "",
    type: String
  },
  // Main has visible messages that a new temporary chat could copy.
  mainHasMessages: {
    default: false,
    type: Boolean
  },
  sessionsApiPath: {
    default: "",
    type: [String, Object, Function]
  }
});

const hostConversation = inject(VIBE64_HOST_CONVERSATION_KEY, null);
const hostComposer = ref(null);
const selectionRevision = ref(0);
function selectMainChat() {
  selectionRevision.value += 1;
  hostConversation?.value?.close();
  emit("select-main-chat");
}
function selectTask(id) {
  selectionRevision.value += 1;
  hostConversation?.value?.close();
  return temporary.selectTask(id);
}
function openTask(options) {
  selectionRevision.value += 1;
  hostConversation?.value?.close();
  return temporary.openTask(options);
}
function closeWorkspace() {
  selectionRevision.value += 1;
  hostConversation?.value?.close();
  temporary.closeWorkspace();
}
const workspace = ref(null);
const completionMessage = ref(null);
const returnToMainButton = ref(null);
const resolvedSessionsApiPath = computed(() => readRefOrGetterValue(props.sessionsApiPath));
const temporaryAiFeedback = useUiFeedback({
  source: "vibe64.temporary-ai.feedback"
});
const temporary = useVibe64TemporaryAi({
  active: () => props.active && !hostConversation?.value?.selected,
  agentSettings: computed(() => ({
    providerId: props.assistantSelection.engineId,
    model: props.assistantSelection.modelId,
    thinking: props.assistantSelection.variantId
  })),
  assistantReady: () => props.assistantReady,
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
const {
  cancelNewTask,
  createTask,
  createTaskError,
  creatingTask,
  creatingTaskId,
  includeRecentChatContext,
  newTaskOpen,
  openNewTask
} = useVibe64TemporaryAiNewTask({ props, temporary, hostConversation, selectionRevision, selectMainChat });
const {
  openRename,
  renameError,
  renamePending,
  renameValue,
  renamingTask,
  renamingTaskId,
  submitRename
} = useVibe64TemporaryAiRename(temporary);
const customOpen = ref(false);
const customTarget = ref(null);
const activeTask = temporary.activeTask;
watch(() => activeTask.value?.id, () => { customOpen.value = false; });
const {
  focusSendButton,
  revealTaskTab,
  setTaskPrompt,
  setTaskSendButton,
  setTaskTabButton,
  taskPrompt
} = useVibe64TemporaryAiTaskElements({ workspace, activeTask });
const routingRequest = computed(() => assistantRoutingRequestForDisplay(activeTask.value?.routingMetadata));
const modeSession = computed(() => ({ sessionId: props.sessionId,
  assistantSelection: activeTask.value?.assistantSelection || props.assistantSelection,
  agentSession: { goal: activeTask.value?.goal || null },
  metadata: activeTask.value?.routingMetadata || {} }));
const activeTaskError = computed(() => {
  if (["failed", "uncertain"].includes(routingRequest.value?.status) &&
      routingRequest.value.error === activeTask.value?.error) return "";
  if (activeTask.value?.delivery.state.messages.some((message) => (
    message.status === "failed" && message.error === activeTask.value.error
  ))) return "";
  if (props.connectionUnavailable && activeTask.value?.errorCode === "vibe64_agent_write_mode_busy") {
    return "";
  }
  return activeTask.value?.error || taskAccessReason(activeTask.value);
});
const updateRepairVisible = computed(() => temporary.open.value &&
  activeTask.value?.recoveryOperation === "update" && activeTask.value.recoveryOutcome !== "succeeded");
const closeTitleId = useId();
const {
  actionErrors,
  closeTask,
  closeTaskId,
  closingTask,
  requestCloseTask,
  stopTask,
  stoppingTaskId,
  taskToClose
} = useVibe64TemporaryAiStopAndClose({ temporary, selectionRevision, emit });
const activeTaskRecoveryChecking = computed(() => activeTask.value?.recoveryOutcome === "checking");
const typingPresence = useVibe64SessionTypingPresence({
  active: computed(() => props.active && temporary.open.value && Boolean(activeTask.value?.conversationId) &&
    !hostConversation?.value?.selected && !taskInputDisabled(activeTask.value) && !closingTask.value),
  conversationId: computed(() => activeTask.value?.conversationId || ""),
  projectSlug: computed(() => props.projectSlug),
  sessionId: computed(() => props.sessionId),
  sessionsApiPath: resolvedSessionsApiPath
});
const activityLabel = computed(() => {
  if (activeTaskRecoveryChecking.value) return "Checking Update…";
  if (activeTask.value?.delivery.state.sending) return "Sending to assistant…";
  if (activeTask.value?.busy && activeTask.value.phase === "background") return "Reply ready · background task still running…";
  if (activeTask.value?.busy) return "AI is working…";
  return typingPresence.typingLabel.value;
});
const activeTaskRecoveryVerified = computed(() => (
  activeTask.value?.recoveryOutcome === "succeeded"
));
const recoveryMessageId = computed(() => activeTaskRecoveryVerified.value
  ? `recovery_${activeTask.value.runId || activeTask.value.id}`
  : "");
const updateCompletionText = computed(() => {
  if (activeTask.value?.recoveryOperation !== "update") return "";
  const status = props.workspaceSetupStatus;
  const heading = {
    running: "Session updated. Preparing workspace…",
    succeeded: "Session updated and workspace ready.",
    failed: "Session updated. Workspace preparation failed; review the setup issue above.",
    ambiguous: "Session updated. Workspace preparation needs a choice; review the setup issue above.",
    required: "Session updated. Workspace preparation is still required."
  }[status] || "Session updated.";
  return `${heading} Your changes were preserved. Nothing was pushed.`;
});
const canReturnToMainChat = computed(() => activeTaskRecoveryVerified.value && !activeTask.value.busy && (
  activeTask.value.recoveryOperation !== "update" ||
  ["succeeded", "unconfigured"].includes(props.workspaceSetupStatus)
));

function taskAccessReason(task) {
  if (!task) return "";
  if (task.busy) return task.canSteer === false
    ? "You cannot steer this turn's AI connection. You can send a new request when it finishes." : "";
  const mode = assistantRoutingFromMetadata(task.routingMetadata || {})?.mode;
  const decision = task.purposes?.[mode];
  return decision?.available === false ? decision.message || "This mode is unavailable. Choose another chat mode." : "";
}

function taskInputDisabled(task) {
  return props.repositoryBusy || task.state === "closing" || task.status === "closing" || task.recoveryOutcome === "checking" || Boolean(taskAccessReason(task));
}

async function sendTask(taskId = "", options = {}) {
  const currentPrompt = taskPrompt(taskId);
  if (props.connectionUnavailable || !taskId || currentPrompt?.attachmentsCanSubmit?.() === false) {
    return;
  }
  const task = temporary.tasks.value.find((task) => task.id === taskId);
  if (!task || taskInputDisabled(task)) return;
  typingPresence.submit();
  return temporary.send(taskId, { ...options, attachmentOwner: currentPrompt });
}

async function startTask(options = {}) {
  selectionRevision.value += 1;
  hostConversation?.value?.close();
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

async function persistTaskRecovery(taskId = "", outcome = {}) {
  return reportTaskRecovery(taskId, outcome) && await temporary.saveTask(taskId) === true;
}

function showWorkspace() {
  const revision = ++selectionRevision.value;
  hostConversation?.value?.close();
  if (!temporary.tasks.value.length) {
    temporary.open.value = true;
    void openFirstTask(revision);
    return null;
  }
  const task = temporary.showWorkspace();
  void revealTaskTab(temporary.activeTaskId.value);
  return task;
}

// The saved chats may still be loading, as just after a session opens. Only a
// list read as empty starts a chat; saved chats open instead, and a list that
// cannot be read shows its error.
async function openFirstTask(revision) {
  await temporary.restoreTasks();
  if (revision !== selectionRevision.value || temporary.restoreError.value) return;
  if (temporary.tasks.value.length) showWorkspace();
  else await openNewTask();
}

function updateActiveAgentSetting(parameterId = "", value = "") {
  if (activeTask.value?.id) {
    temporary.updateAgentSetting(activeTask.value.id, parameterId, value);
  }
}

watch(() => temporary.activeTaskId.value, (taskId) => {
  void revealTaskTab(taskId);
}, { flush: "post" });

watch([recoveryMessageId, canReturnToMainChat, () => props.active], async () => {
  if (!props.active || !recoveryMessageId.value) return;
  await nextTick();
  const target = returnToMainButton.value?.$el || completionMessage.value;
  target?.scrollIntoView?.({ block: "nearest" });
}, { flush: "post" });

useVibe64TemporaryAiColleagueView({ props, emit, temporary, hostConversation, selectionRevision });

defineExpose({
  get visible() { return temporary.open.value || Boolean(hostConversation?.value?.selected); },
  get composer() {
    if (hostConversation?.value?.selected) return hostComposer.value;
    return temporary.open.value ? taskPrompt(temporary.activeTaskId.value) : null;
  },
  closeWorkspace,
  hasUnreadMessages: temporary.hasUnreadMessages,
  openTask,
  reportTaskRecovery,
  persistTaskRecovery,
  selectTask,
  startTask,
  showWorkspace,
  updateRepairVisible,
  updateRepairTask: temporary.updateRepairTask
});
</script>

<style scoped>
.vibe64-temporary-ai__composer-actions {
  display: flex;
  align-items: center;
  gap: 0.25rem;
  min-width: 0;
  width: 100%;
}

.vibe64-temporary-ai.vibe64-temporary-ai--host {
  border-color: rgba(var(--v-theme-secondary), 0.65);
  grid-template-rows: auto minmax(0, 1fr);
}
.vibe64-temporary-ai__host-content {
  min-height: 0;
  min-width: 0;
}

.vibe64-temporary-ai {
  background: rgb(var(--v-theme-surface));
  border: 2px solid rgba(var(--v-theme-tertiary), 0.42);
  border-radius: 12px;
  bottom: 0.3rem;
  box-shadow: 0 14px 38px rgba(15, 23, 42, 0.22);
  display: grid;
  grid-row: 3 / -1;
  grid-template-columns: minmax(0, 1fr);
  grid-template-rows: auto auto minmax(0, 1fr);
  left: 0.3rem;
  min-height: 0;
  overflow: hidden;
  position: absolute;
  right: 0.3rem;
  top: 0;
  z-index: 12;
}

.vibe64-temporary-ai:focus-visible {
  outline: 2px solid rgb(var(--v-theme-primary));
  outline-offset: 2px;
}

.vibe64-temporary-ai__composer {
  flex: 0 0 auto;
}

.vibe64-temporary-ai__return {
  justify-self: start;
  margin-top: 0.4rem;
  scroll-margin-block: 0.55rem;
}

.vibe64-temporary-ai__error {
  color: rgba(var(--v-theme-on-surface), 0.66);
  font-size: 0.82rem;
}

.vibe64-temporary-ai__feedback {
  flex: 0 0 auto;
  max-height: min(12dvh, 6rem);
  min-width: 0;
  overflow-y: auto;
}

.vibe64-temporary-ai__error {
  color: rgb(var(--v-theme-error));
  padding: 0.3rem 0.55rem;
}

.vibe64-temporary-ai__error--recovered {
  color: rgba(var(--v-theme-on-surface), 0.66);
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
  .vibe64-temporary-ai__return {
    min-height: 3rem !important;
    min-width: 3rem !important;
  }
}
</style>
