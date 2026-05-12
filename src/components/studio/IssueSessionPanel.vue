<template>
  <v-sheet rounded="lg" class="studio-issue-sessions studio-screen__panel">
    <v-alert v-if="issueSessionsError" type="error" variant="tonal" class="mb-3">
      {{ issueSessionsError }}
    </v-alert>

    <div v-if="issueSessions.length || canCreateIssueSession" class="studio-issue-sessions__strip">
      <v-chip
        v-for="session in issueSessions"
        :key="session.sessionId"
        :color="session.sessionId === selectedSessionId ? 'primary' : 'default'"
        :variant="session.sessionId === selectedSessionId ? 'flat' : 'tonal'"
        class="studio-issue-sessions__tab studio-issue-sessions__tab-chip"
        size="large"
        @click="selectSession(session.sessionId)"
      >
        <span class="studio-issue-sessions__status-dot" :class="`studio-issue-sessions__status-dot--${session.status}`" />
        <span>{{ shortSessionId(session.sessionId) }}</span>
        <button
          v-if="canAbandonSessionFromChip(session)"
          aria-label="Abandon selected session"
          class="studio-issue-sessions__tab-close"
          type="button"
          @click.stop="requestAbandonSession(session)"
          @mousedown.stop
          @pointerdown.stop
        >
          <v-icon :icon="mdiClose" size="14" />
        </button>
      </v-chip>
      <v-chip
        v-if="canCreateIssueSession"
        color="primary"
        variant="tonal"
        :prepend-icon="mdiPlus"
        :disabled="issueSessionBusy"
        class="studio-issue-sessions__tab studio-issue-sessions__new-tab"
        :class="{ 'studio-issue-sessions__new-tab--busy': issueSessionBusy }"
        size="large"
        @click="createSession"
      >
        New Session
      </v-chip>
    </div>

    <v-sheet v-else-if="!issueSessionsLoading" rounded="lg" border class="studio-issue-sessions__empty">
      <p class="text-body-2 text-medium-emphasis mb-0">No sessions yet.</p>
    </v-sheet>

    <v-dialog v-model="abandonDialogOpen" max-width="30rem">
      <v-card>
        <v-card-title>Abandon session?</v-card-title>
        <v-card-text>
          This will abandon the selected session and close its Codex terminal.
        </v-card-text>
        <v-card-actions>
          <v-spacer />
          <v-btn variant="text" @click="cancelAbandonSession">Cancel</v-btn>
          <v-btn
            color="error"
            variant="flat"
            :loading="issueSessionBusy"
            @click="confirmAbandonSession"
          >
            Abandon
          </v-btn>
        </v-card-actions>
      </v-card>
    </v-dialog>

    <div v-if="selectedSession" class="studio-issue-sessions__workspace">
      <section class="studio-issue-sessions__main">
        <div class="studio-issue-sessions__timeline">
          <div
            v-for="step in orderedStepDefinitions"
            :key="step.id"
            class="studio-issue-sessions__step"
            :class="`studio-issue-sessions__step--${stepState(step)}`"
          >
            <div class="studio-issue-sessions__step-icon">
              <v-icon :icon="stepIcon(step)" size="18" />
            </div>
            <div class="studio-issue-sessions__step-copy">
              <div class="studio-issue-sessions__step-title">
                <span>{{ step.index + 1 }}. {{ step.label }}</span>
                <v-chip size="x-small" variant="tonal">{{ step.kind }}</v-chip>
              </div>

              <div v-if="step.id === selectedSession.currentStep" class="studio-issue-sessions__step-action">
                <v-textarea
                  v-if="selectedSession.prompt && !isCodexPromptInjection"
                  :model-value="selectedSession.prompt"
                  label="Prompt"
                  variant="outlined"
                  readonly
                  auto-grow
                  rows="7"
                  class="studio-issue-sessions__monospace"
                />

                <v-textarea
                  v-if="isCodexOutputStep && extractedCodexOutput"
                  :model-value="extractedCodexOutput"
                  label="Issue text from Codex"
                  variant="outlined"
                  readonly
                  auto-grow
                  rows="5"
                  class="studio-issue-sessions__monospace"
                />

                <p v-else-if="isCodexOutputStep" class="studio-issue-sessions__waiting text-caption mb-0">
                  Waiting for Codex issue text.
                </p>

                <v-textarea
                  v-else-if="isTextStep && selectedStepInput.multiline"
                  v-model="stepInputValues[selectedStepInput.name]"
                  :label="selectedStepInput.label"
                  :placeholder="selectedStepInput.placeholder || ''"
                  variant="outlined"
                  auto-grow
                  rows="4"
                />

                <v-text-field
                  v-else-if="isTextStep"
                  v-model="stepInputValues[selectedStepInput.name]"
                  :label="selectedStepInput.label"
                  :placeholder="selectedStepInput.placeholder || ''"
                  variant="outlined"
                />

                <div v-if="isChoiceStep" class="studio-issue-sessions__choice-row">
                  <v-btn
                    v-for="option in selectedStepInput.options || []"
                    :key="option.value"
                    color="primary"
                    :loading="issueSessionBusy"
                    variant="tonal"
                    @click="runChoiceStep(option.value)"
                  >
                    {{ option.label }}
                  </v-btn>
                </div>

                <div v-else class="studio-issue-sessions__action-buttons">
                  <v-btn
                    color="primary"
                    variant="flat"
                    :loading="issueSessionBusy"
                    :disabled="!canRunAction"
                    :prepend-icon="mdiPlay"
                    @click="runCurrentAction"
                  >
                    {{ currentActionButtonLabel }}
                  </v-btn>
                  <v-btn
                    v-if="selectedSession.prompt && !isCodexPromptInjection"
                    variant="tonal"
                    :prepend-icon="mdiContentCopy"
                    @click="copyText(selectedSession.prompt, 'Prompt')"
                  >
                    Copy Prompt
                  </v-btn>
                </div>

                <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-0">{{ copyStatus }}</p>
              </div>
            </div>
          </div>
        </div>

        <v-alert
          v-for="error in selectedSession.errors || []"
          :key="error.code"
          type="error"
          variant="tonal"
          class="mb-2"
        >
          <strong>{{ error.code }}</strong>: {{ error.message }}
          <template v-if="error.repairCommand">
            <br>
            <code>{{ error.repairCommand }}</code>
          </template>
        </v-alert>
      </section>

      <aside class="studio-issue-sessions__side">
        <v-alert
          v-if="selectedSessionTerminalBlocked"
          type="warning"
          variant="tonal"
          density="compact"
        >
          Three active Codex terminals are already open. Finish or abandon one before opening another.
        </v-alert>

        <div class="studio-issue-sessions__terminal-stack">
          <CodexSessionTerminal
            v-for="terminalSession in terminalSessions"
            v-show="terminalSession.sessionId === selectedSessionId"
            :key="terminalSession.sessionId"
            :session="terminalSession"
            :visible="terminalSession.sessionId === selectedSessionId"
            @output="recordCodexTerminalOutput(terminalSession.sessionId, $event)"
          />
        </div>
      </aside>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  mdiAlertCircle,
  mdiCheckCircle,
  mdiClose,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiContentCopy,
  mdiPlay,
  mdiPlus
} from "@mdi/js";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import { useIssueSessions } from "@/composables/useIssueSessions.js";
import { extractMarkedOutput } from "@/lib/codexOutput.js";

const copyStatus = ref("");
const codexTerminalOutputBySessionId = ref({});
const abandonDialogOpen = ref(false);
const abandonSessionId = ref("");
const terminalSessionById = ref({});

const {
  abandonSelectedSession,
  canCreateIssueSession,
  createSession,
  isChoiceStep,
  isTextStep,
  issueSessionBusy,
  issueSessions,
  issueSessionsError,
  issueSessionsLoading,
  loadIssueSessions,
  maxOpenIssueSessions,
  runSelectedStep,
  selectSession,
  selectedSession,
  selectedSessionId,
  selectedStepAction,
  selectedStepInput,
  stepDefinitions,
  stepInputValues
} = useIssueSessions();

const orderedStepDefinitions = computed(() => {
  return [...(stepDefinitions.value || [])].sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
});

const completedStepIds = computed(() => new Set(selectedSession.value?.completedSteps || []));

const isTerminalSession = computed(() => {
  return isClosedSession(selectedSession.value);
});

const openTerminalSessionCount = computed(() => {
  return Object.values(terminalSessionById.value).filter(isOpenSession).length;
});

const selectedTerminalIsOpen = computed(() => {
  return Boolean(selectedSessionId.value && terminalSessionById.value[selectedSessionId.value]);
});

const selectedSessionTerminalBlocked = computed(() => {
  return Boolean(
    selectedSession.value?.worktree &&
    isOpenSession(selectedSession.value) &&
    !selectedTerminalIsOpen.value &&
    openTerminalSessionCount.value >= maxOpenIssueSessions.value
  );
});

const isCodexPromptInjection = computed(() => {
  return selectedSession.value?.codex?.mode === "inject_prompt" && Boolean(selectedSession.value?.prompt);
});

const codexExpectedOutput = computed(() => {
  return selectedSession.value?.codex?.expectedOutput || null;
});

const isCodexOutputStep = computed(() => {
  return isCodexPromptInjection.value && Boolean(codexExpectedOutput.value?.field);
});

const extractedCodexOutput = computed(() => {
  return extractMarkedOutput(selectedCodexTerminalOutput.value, codexExpectedOutput.value?.extract);
});

const selectedCodexTerminalOutput = computed(() => {
  return codexTerminalOutputBySessionId.value[selectedSessionId.value] || "";
});

const terminalSessions = computed(() => {
  const listedSessionIds = (issueSessions.value || []).map((session) => session.sessionId);
  const orderedSessionIds = [
    ...listedSessionIds,
    ...Object.keys(terminalSessionById.value).filter((sessionId) => !listedSessionIds.includes(sessionId))
  ];
  return orderedSessionIds
    .map((sessionId) => terminalSessionById.value[sessionId])
    .filter((session) => session && !isAbandonedSession(session));
});

const canRunAction = computed(() => {
  if (!selectedStepAction.value || isTerminalSession.value || issueSessionBusy.value) {
    return false;
  }
  if (isCodexOutputStep.value) {
    return Boolean(extractedCodexOutput.value);
  }
  const input = selectedStepInput.value || {};
  if (input.required && input.name) {
    return Boolean(String(stepInputValues.value[input.name] || "").trim());
  }
  return true;
});

const currentActionButtonLabel = computed(() => {
  return isCodexOutputStep.value ? "Done" : selectedStepAction.value?.buttonLabel || "Run Step";
});

function shortSessionId(sessionId) {
  return String(sessionId || "").replace(/^\d{4}-/u, "");
}

function isAbandonedSession(session = {}) {
  return String(session?.status || "") === "abandoned";
}

function isClosedSession(session = {}) {
  return ["abandoned", "finished"].includes(String(session?.status || ""));
}

function isOpenSession(session = {}) {
  return !isClosedSession(session);
}

function canAbandonSessionFromChip(session = {}) {
  return session.sessionId === selectedSessionId.value && !isClosedSession(session);
}

function stepState(step) {
  if (completedStepIds.value.has(step.id)) {
    return "done";
  }
  if ((selectedSession.value?.errors || []).length && step.id === selectedSession.value?.currentStep) {
    return "blocked";
  }
  if (step.id === selectedSession.value?.currentStep) {
    return "current";
  }
  return "pending";
}

function stepIcon(step) {
  const state = stepState(step);
  if (state === "done") {
    return mdiCheckCircle;
  }
  if (state === "current") {
    return mdiCircleSlice8;
  }
  if (state === "blocked") {
    return mdiAlertCircle;
  }
  return mdiCircleOutline;
}

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    copyStatus.value = `${label} copied.`;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
  }
}

function runChoiceStep(value) {
  const inputName = selectedStepInput.value?.name;
  if (!inputName) {
    return;
  }
  void runSelectedStep({
    [inputName]: value
  });
}

function rememberTerminalSession(session = selectedSession.value) {
  const sessionId = session?.sessionId || "";
  if (!sessionId) {
    return;
  }
  if (isAbandonedSession(session)) {
    forgetTerminalSession(sessionId);
    return;
  }
  const terminalLimitReached = openTerminalSessionCount.value >= maxOpenIssueSessions.value;
  if (!terminalSessionById.value[sessionId] && isOpenSession(session) && terminalLimitReached) {
    return;
  }
  terminalSessionById.value = {
    ...terminalSessionById.value,
    [sessionId]: {
      ...(terminalSessionById.value[sessionId] || {}),
      ...session
    }
  };
}

function forgetTerminalSession(sessionId) {
  if (!sessionId) {
    return;
  }
  const {
    [sessionId]: _terminalSession,
    ...remainingTerminalSessions
  } = terminalSessionById.value;
  const {
    [sessionId]: _terminalOutput,
    ...remainingTerminalOutputs
  } = codexTerminalOutputBySessionId.value;
  terminalSessionById.value = remainingTerminalSessions;
  codexTerminalOutputBySessionId.value = remainingTerminalOutputs;
}

function pruneTerminalSessions() {
  const sessionIds = new Set((issueSessions.value || []).map((session) => session.sessionId));
  if (selectedSessionId.value && !isAbandonedSession(selectedSession.value)) {
    sessionIds.add(selectedSessionId.value);
  }
  terminalSessionById.value = Object.fromEntries(
    Object.entries(terminalSessionById.value)
      .filter(([sessionId, session]) => sessionIds.has(sessionId) && !isAbandonedSession(session))
  );
  codexTerminalOutputBySessionId.value = Object.fromEntries(
    Object.entries(codexTerminalOutputBySessionId.value).filter(([sessionId]) => sessionIds.has(sessionId))
  );
}

function recordCodexTerminalOutput(sessionId, output) {
  codexTerminalOutputBySessionId.value = {
    ...codexTerminalOutputBySessionId.value,
    [sessionId]: String(output || "")
  };
}

function hasNoInput(action) {
  return !action?.input || action.input.type === "none";
}

function shouldRunImmediateNextStep(response) {
  if (!response || response.ok === false) {
    return false;
  }
  if (response.status === "finished" || response.status === "abandoned") {
    return false;
  }
  return response.currentStepAction?.kind === "automatic" && hasNoInput(response.currentStepAction) && !response.codex;
}

async function runCodexOutputStep() {
  const field = String(codexExpectedOutput.value?.field || selectedStepInput.value?.name || "").trim();
  const output = extractedCodexOutput.value;
  if (!field || !output) {
    return;
  }

  const response = await runSelectedStep({
    [field]: output
  });
  if (shouldRunImmediateNextStep(response)) {
    await runSelectedStep();
  }
}

function requestAbandonSession(session = {}) {
  abandonSessionId.value = session.sessionId || "";
  abandonDialogOpen.value = Boolean(abandonSessionId.value);
}

function cancelAbandonSession() {
  abandonDialogOpen.value = false;
  abandonSessionId.value = "";
}

async function confirmAbandonSession() {
  const abandonedSessionId = abandonSessionId.value || selectedSessionId.value;
  if (!abandonedSessionId || abandonedSessionId !== selectedSessionId.value) {
    cancelAbandonSession();
    return;
  }
  const response = await abandonSelectedSession();
  if (response?.status === "abandoned") {
    forgetTerminalSession(abandonedSessionId);
  }
  cancelAbandonSession();
}

function runCurrentAction() {
  if (isCodexOutputStep.value) {
    void runCodexOutputStep();
    return;
  }
  void runSelectedStep();
}

watch(selectedSession, (session) => {
  rememberTerminalSession(session);
}, {
  immediate: true
});

watch(issueSessions, () => {
  pruneTerminalSessions();
});

onMounted(() => {
  void loadIssueSessions();
});

</script>

<style scoped>
.studio-screen__panel {
  padding: 0.75rem;
}

.studio-issue-sessions__action-title {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-issue-sessions__action-buttons,
.studio-issue-sessions__choice-row {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.5rem;
}

.studio-issue-sessions__strip {
  display: flex;
  gap: 0.5rem;
  margin-bottom: 0.75rem;
  overflow-x: auto;
  padding-bottom: 0.125rem;
}

.studio-issue-sessions__tab {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
}

.studio-issue-sessions__tab-chip {
  cursor: pointer;
  font-weight: 600;
}

.studio-issue-sessions__new-tab {
  border: 1px solid rgba(var(--v-theme-primary), 0.42);
  cursor: pointer;
  font-weight: 650;
}

.studio-issue-sessions__new-tab--busy {
  opacity: 0.72;
  pointer-events: none;
}

.studio-issue-sessions__tab-close {
  align-items: center;
  background: rgba(var(--v-theme-on-primary), 0.18);
  border: 1px solid rgba(var(--v-theme-on-primary), 0.44);
  border-radius: 999px;
  color: rgb(var(--v-theme-on-primary));
  cursor: pointer;
  display: inline-flex;
  height: 1.25rem;
  margin-inline-start: 0.45rem;
  place-content: center;
  width: 1.25rem;
}

.studio-issue-sessions__tab-close:hover,
.studio-issue-sessions__tab-close:focus-visible {
  background: rgba(var(--v-theme-on-primary), 0.32);
}

.studio-issue-sessions__status-dot {
  border-radius: 999px;
  display: inline-block;
  height: 0.55rem;
  margin-right: 0.45rem;
  width: 0.55rem;
}

.studio-issue-sessions__status-dot--finished {
  background: rgb(var(--v-theme-success));
}

.studio-issue-sessions__status-dot--blocked,
.studio-issue-sessions__status-dot--failed {
  background: rgb(var(--v-theme-error));
}

.studio-issue-sessions__status-dot--waiting_for_user {
  background: rgb(var(--v-theme-warning));
}

.studio-issue-sessions__status-dot--pending,
.studio-issue-sessions__status-dot--running {
  background: rgb(var(--v-theme-primary));
}

.studio-issue-sessions__status-dot--abandoned {
  background: rgb(var(--v-theme-on-surface-variant));
}

.studio-issue-sessions__empty {
  padding: 0.75rem;
}

.studio-issue-sessions__workspace {
  display: grid;
  gap: 1rem;
  grid-template-columns: minmax(20rem, 0.72fr) minmax(34rem, 1.28fr);
}

.studio-issue-sessions__main,
.studio-issue-sessions__side {
  min-width: 0;
}

.studio-issue-sessions__main,
.studio-issue-sessions__side {
  display: flex;
  flex-direction: column;
  gap: 0.75rem;
}

.studio-issue-sessions__terminal-stack {
  min-width: 0;
}

.studio-issue-sessions__timeline {
  border: 0;
  border-radius: 0;
  overflow: visible;
  padding: 0;
}

.studio-issue-sessions__step {
  align-items: flex-start;
  border-radius: 6px;
  display: grid;
  gap: 0.5rem;
  grid-template-columns: 1.5rem minmax(0, 1fr);
  padding: 0.45rem;
}

.studio-issue-sessions__step--current {
  background: rgba(var(--v-theme-primary), 0.1);
}

.studio-issue-sessions__step--done .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-success));
}

.studio-issue-sessions__step--current .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-primary));
}

.studio-issue-sessions__step--blocked .studio-issue-sessions__step-icon {
  color: rgb(var(--v-theme-error));
}

.studio-issue-sessions__step-title {
  align-items: center;
  display: flex;
  flex-wrap: wrap;
  gap: 0.4rem;
  line-height: 1.2;
}

.studio-issue-sessions__step-title span {
  font-size: 0.9rem;
  font-weight: 650;
}

.studio-issue-sessions__step-action {
  border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  display: grid;
  gap: 0.55rem;
  margin-top: 0.65rem;
  padding-top: 0.65rem;
}

.studio-issue-sessions__action-buttons,
.studio-issue-sessions__choice-row {
  margin-top: 0.15rem;
}

.studio-issue-sessions__waiting {
  color: rgb(var(--v-theme-on-surface-variant));
}

.studio-issue-sessions__monospace :deep(textarea) {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

@media (max-width: 860px) {
  .studio-issue-sessions__workspace {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .studio-issue-sessions__action-title {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
