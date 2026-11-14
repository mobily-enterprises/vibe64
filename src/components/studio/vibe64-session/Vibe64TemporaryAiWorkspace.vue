<template>
  <section
    v-if="temporary.open.value"
    ref="workspace"
    class="vibe64-temporary-ai"
    aria-label="Temporary AI workspace"
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
      @close="task => closeTask(task.id)"
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

    <Vibe64TemporaryAiRecoveryRow
      :restore-error="temporary.restoreError.value"
      @retry-restore="temporary.restoreTasks()"
    />
    <template v-if="activeTask">
      <Vibe64EphemeralConversationMessages
        :session-id="props.sessionId"
        :adapter="activeTask.adapter"
        :routing-request="routingRequest"
        :working="activeTask.nativeWorking"
        :scroll-key="activeTask.id"
        empty-message="Ask a focused question or investigate a problem without adding it to the main conversation."
        @resend="sendTask(activeTask.id, { retryMessageId: $event })"
        @cancel="temporary.cancelMessage(activeTask.id, $event)"
        @edit="temporary.editMessage(activeTask.id, $event)"
      >
        <template #message-text="{ message }">
          <p>{{ message.text }}</p>
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
            <div v-if="actionErrors[activeTask.id]" class="vibe64-temporary-ai__error" role="alert">
              {{ actionErrors[activeTask.id] }}
            </div>
            <div v-if="activeTaskError" class="vibe64-temporary-ai__error" role="alert">
              {{ activeTaskError }}
            </div>
            <AssistantComposerSupport
              v-if="activityLabel"
              class="vibe64-temporary-ai__activity"
              :activity="{ label: activityLabel }"
            />
          </div>
        </template>
        <template #composer>
          <p v-if="activeTask.draftSaveState === 'failed'" class="text-body-small" role="status" aria-live="polite">
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
            :model-value="task.draft"
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
                  icon="$attachFile"
                  size="small"
                  title="Attach files"
                  type="button"
                  variant="text"
                  @click="taskPrompt(task.id)?.openFilePicker()"
                />
                <v-btn
                  v-if="previewAttachmentState.captureAvailable"
                  aria-label="Attach preview screenshot"
                  :disabled="taskInputDisabled(task) || !attachmentState.canAddFiles || previewAttachmentState.captureBusy"
                  :aria-busy="previewAttachmentState.captureBusy ? 'true' : undefined"
                  icon="$photoCamera"
                  size="small"
                  title="Attach preview screenshot"
                  variant="text"
                  @click="previewAttachmentState.capture()"
                />
                <v-btn
                  v-if="previewAttachmentState.diagnosticsAvailable"
                  aria-label="Attach console and network diagnostics"
                  :disabled="taskInputDisabled(task) || !attachmentState.canAddFiles || previewAttachmentState.diagnosticsBusy"
                  :aria-busy="previewAttachmentState.diagnosticsBusy ? 'true' : undefined"
                  icon="$lan"
                  size="small"
                  title="Attach console and network diagnostics"
                  variant="text"
                  @click="previewAttachmentState.attachDiagnostics()"
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
      :save-selection="(selection) => temporary.updateRouting(activeTask.id, { mode: 'custom', override: selection })"
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
            <v-btn variant="text" :disabled="renamePending" @click="renamingTaskId = ''">Cancel</v-btn>
            <v-btn type="submit" color="primary" variant="flat" rounded="pill" :loading="renamePending">Rename</v-btn>
          </v-card-actions>
        </form>
      </v-card>
    </v-dialog>
  </section>
</template>

<script setup>
import Vibe64ComposerDelivery from "./Vibe64ComposerDelivery.vue";
import Vibe64SessionAssistantMenu from "./Vibe64SessionAssistantMenu.vue";
import Vibe64ChatModeControls from "./Vibe64ChatModeControls.vue";
import Vibe64TemporaryAiRecoveryRow from "./Vibe64TemporaryAiRecoveryRow.vue";
import Vibe64TemporaryAiTabs from "./Vibe64TemporaryAiTabs.vue";
import { computed, ref, watch } from "vue";
import { useUiFeedback } from "@jskit-ai/http-web/client/composables/useUiFeedback";

import Vibe64AgentSettingsMenu from "@/components/studio/vibe64-session/Vibe64AgentSettingsMenu.vue";
import Vibe64AutopilotPromptTextarea from "@/components/studio/vibe64-session/Vibe64AutopilotPromptTextarea.vue";
import Vibe64EphemeralConversationMessages from "@/components/studio/vibe64-session/Vibe64EphemeralConversationMessages.vue";
import { AssistantComposerSupport } from "@jskit-ai/assistant-core/client/conversation";
import {
  useVibe64TemporaryAi
} from "@/composables/useVibe64TemporaryAi.js";
import { useVibe64TemporaryAiColleagueView } from "@/composables/useVibe64TemporaryAiColleagueView.js";
import { useVibe64TemporaryAiComposer } from "@/composables/useVibe64TemporaryAiComposer.js";
import { useVibe64TemporaryAiNewTask } from "@/composables/useVibe64TemporaryAiNewTask.js";
import { useVibe64TemporaryAiRename } from "@/composables/useVibe64TemporaryAiRename.js";
import { useVibe64TemporaryAiStopAndClose } from "@/composables/useVibe64TemporaryAiStopAndClose.js";
import { useVibe64TemporaryAiTaskElements } from "@/composables/useVibe64TemporaryAiTaskElements.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";

const emit = defineEmits(["select-main-chat"]);
const props = defineProps({
  // Opens one project file in this session's Dashboard → Files editor (a
  // Colleague "show me" guide); returns true only when that file opened.
  openFile: { type: /** @type {import("vue").PropType<(path: string) => boolean>} */ (Function), required: true },
  // Sends a lesson beat's prompt to this session's Main chat; true once it is sent.
  sendLessonMessage: { type: /** @type {import("vue").PropType<(text: string) => Promise<boolean>>} */ (Function), required: true },
  active: Boolean,
  sessionSelected: Boolean,
  assistantReady: Boolean,
  canConfigureRouting: Boolean,
  connectionUnavailable: Boolean,
  projectSlug: { type: String, default: "" },
  previewAttachmentState: {
    required: true,
    type: /** @type {import("vue").PropType<{
      attachDiagnostics: () => void,
      capture: () => void,
      captureAvailable: boolean,
      captureBusy: boolean,
      diagnosticsAvailable: boolean,
      diagnosticsBusy: boolean
    }>} */ (Object)
  },
  repositoryBusy: Boolean,
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

const selectionRevision = ref(0);
function selectMainChat() {
  selectionRevision.value += 1;
  emit("select-main-chat");
}
function selectTask(id) {
  selectionRevision.value += 1;
  return temporary.selectTask(id);
}
function openTask(options) {
  selectionRevision.value += 1;
  return temporary.openTask(options);
}
function closeWorkspace() {
  selectionRevision.value += 1;
  temporary.closeWorkspace();
}
const workspace = ref(null);
const resolvedSessionsApiPath = computed(() => readRefOrGetterValue(props.sessionsApiPath));
const temporaryAiFeedback = useUiFeedback({
  source: "vibe64.temporary-ai.feedback"
});
const temporary = useVibe64TemporaryAi({
  active: () => props.active,
  agentSettings: computed(() => ({
    providerId: props.assistantSelection.engineId,
    model: props.assistantSelection.modelId,
    thinking: props.assistantSelection.variantId
  })),
  assistantReady: () => props.assistantReady,
  operationBusy: () => props.repositoryBusy,
  onTaskFinished(task = {}) {
    if (props.active && temporary.open.value && temporary.activeTaskId.value === task.id) return;
    if (task.status === "completed") {
      if (task.outcomeKind !== "continue") temporaryAiFeedback.success(`${task.title} finished. Review the result before continuing.`);
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
} = useVibe64TemporaryAiNewTask({ props, temporary, selectionRevision, selectMainChat });
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
const {
  actionErrors,
  closeTask,
  closingTask,
  stopTask,
  stoppingTaskId
} = useVibe64TemporaryAiStopAndClose({ temporary, selectionRevision });
const {
  activeTaskError,
  activityLabel,
  modeSession,
  routingRequest,
  sendTask,
  taskAccessReason,
  taskInputDisabled,
  typingPresence
} = useVibe64TemporaryAiComposer({ props, temporary, closingTask, taskPrompt, sessionsApiPath: resolvedSessionsApiPath });

function showWorkspace() {
  const revision = ++selectionRevision.value;
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

useVibe64TemporaryAiColleagueView({ props, emit, temporary, selectionRevision });

defineExpose({
  get visible() { return temporary.open.value; },
  get composer() { return temporary.open.value ? taskPrompt(temporary.activeTaskId.value) : null; },
  closeWorkspace,
  hasUnreadMessages: temporary.hasUnreadMessages,
  openTask,
  selectTask,
  showWorkspace
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

.vibe64-temporary-ai {
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgb(var(--v-theme-outline-variant));
  border-radius: 12px;
  bottom: 0.3rem;
  box-shadow: 0 14px 38px rgba(var(--v-theme-shadow), 0.22);
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

@media (max-width: 720px) {
  .vibe64-temporary-ai {
    border: 0;
    border-radius: 0;
    inset: 0;
    z-index: 30;
  }
}

</style>
