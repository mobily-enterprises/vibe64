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

                <template v-if="isCodexOutputStep && hasAnyEditableCodexOutput">
                  <template
                    v-for="output in codexEditableOutputs"
                    :key="codexOutputDraftKeyFor(output)"
                  >
                    <v-textarea
                      v-if="codexOutputIsMultiline(output)"
                      :model-value="codexOutputDraftValue(output)"
                      :label="codexOutputLabel(output)"
                      variant="outlined"
                      auto-grow
                      rows="7"
                      class="studio-issue-sessions__monospace"
                      @update:model-value="setCodexOutputDraft(output, $event)"
                    />
                    <v-text-field
                      v-else
                      :model-value="codexOutputDraftValue(output)"
                      :label="codexOutputLabel(output)"
                      variant="outlined"
                      @update:model-value="setCodexOutputDraft(output, $event)"
                    />
                  </template>
                </template>

                <p v-else-if="isCodexOutputStep" class="studio-issue-sessions__waiting text-caption mb-0">
                  {{ codexWaitingMessage }}
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
            @session-update="applyIssueSessionUpdate"
          />
        </div>

        <v-sheet rounded="lg" border class="studio-issue-sessions__facts">
          <div class="studio-issue-sessions__facts-header">
            <div>
              <h2 class="studio-issue-sessions__facts-title">Session Details</h2>
              <p class="text-caption text-medium-emphasis mb-0">
                Updates as JSKIT records worktree, Codex, GitHub, and review state.
              </p>
            </div>
            <v-chip
              :color="issueSessionStatusColor(selectedSession.status)"
              density="comfortable"
              size="small"
              variant="tonal"
            >
              {{ issueSessionStatusLabel(selectedSession.status) }}
            </v-chip>
          </div>

          <div class="studio-issue-sessions__facts-grid">
            <div
              v-for="fact in sessionFactItems"
              :key="fact.key"
              class="studio-issue-sessions__fact"
              :class="{
                'studio-issue-sessions__fact--expandable': fact.expandable,
                'studio-issue-sessions__fact--expanded': factIsExpanded(fact)
              }"
              :aria-expanded="fact.expandable ? String(factIsExpanded(fact)) : undefined"
              :role="fact.expandable ? 'button' : undefined"
              :tabindex="fact.expandable ? 0 : undefined"
              @click="toggleFact(fact)"
              @keydown.enter.prevent="toggleFact(fact)"
              @keydown.space.prevent="toggleFact(fact)"
            >
              <div class="studio-issue-sessions__fact-icon">
                <v-icon :icon="fact.icon" size="20" />
              </div>
              <div class="studio-issue-sessions__fact-copy">
                <div class="studio-issue-sessions__fact-label">{{ fact.label }}</div>
                <a
                  v-if="fact.href"
                  class="studio-issue-sessions__fact-value studio-issue-sessions__fact-link"
                  :href="fact.href"
                  target="_blank"
                  rel="noreferrer"
                  @click.stop
                >
                  {{ fact.value }}
                </a>
                <div v-else class="studio-issue-sessions__fact-value">{{ fact.value }}</div>
                <div v-if="fact.detail" class="studio-issue-sessions__fact-detail">{{ fact.detail }}</div>
              </div>
              <div v-if="fact.href || fact.copyValue || fact.expandable" class="studio-issue-sessions__fact-actions">
                <v-btn
                  v-if="fact.expandable"
                  :aria-label="factIsExpanded(fact) ? `Collapse ${fact.label}` : `Expand ${fact.label}`"
                  :icon="factIsExpanded(fact) ? mdiChevronUp : mdiChevronDown"
                  size="x-small"
                  variant="text"
                  @click.stop="toggleFact(fact)"
                />
                <v-btn
                  v-if="fact.href"
                  :href="fact.href"
                  target="_blank"
                  rel="noreferrer"
                  :icon="mdiOpenInNew"
                  size="x-small"
                  variant="text"
                  @click.stop
                />
                <v-btn
                  v-if="fact.copyValue"
                  :icon="mdiContentCopy"
                  size="x-small"
                  variant="text"
                  @click.stop="copyText(fact.copyValue, fact.label)"
                />
              </div>
              <div
                v-if="fact.expandable && factIsExpanded(fact)"
                class="studio-issue-sessions__fact-expanded"
              >
                <pre>{{ fact.expandedValue }}</pre>
              </div>
            </div>
          </div>
        </v-sheet>
      </aside>
    </div>
  </v-sheet>
</template>

<script setup>
import { computed, onMounted, ref, watch } from "vue";
import {
  mdiAlertCircle,
  mdiChevronDown,
  mdiChevronUp,
  mdiCheckCircle,
  mdiClose,
  mdiCircleOutline,
  mdiCircleSlice8,
  mdiContentCopy,
  mdiFolderOutline,
  mdiGithub,
  mdiIdentifier,
  mdiOpenInNew,
  mdiPlay,
  mdiPlus,
  mdiProgressCheck,
  mdiRobotOutline,
  mdiSourceBranch
} from "@mdi/js";
import CodexSessionTerminal from "@/components/studio/CodexSessionTerminal.vue";
import { useIssueSessions } from "@/composables/useIssueSessions.js";
import { extractMarkedOutput } from "@/lib/codexOutput.js";
import {
  canUseIssueSessionTerminal,
  isAbandonedIssueSession,
  isClosedIssueSession,
  isOpenIssueSession,
  issueSessionFacts,
  issueSessionStatusColor,
  issueSessionStatusLabel,
  shortIssueSessionId
} from "@/lib/issueSessionViewModel.js";

const copyStatus = ref("");
const codexTerminalOutputBySessionId = ref({});
const codexOutputDraftByKey = ref({});
const codexOutputSourceByKey = ref({});
const expandedFactKeys = ref({});
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
  patchIssueSession,
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
  return isClosedIssueSession(selectedSession.value);
});

const openTerminalSessionCount = computed(() => {
  return Object.values(terminalSessionById.value).filter(isOpenIssueSession).length;
});

const selectedTerminalIsOpen = computed(() => {
  return Boolean(selectedSessionId.value && terminalSessionById.value[selectedSessionId.value]);
});

const selectedSessionTerminalBlocked = computed(() => {
  return Boolean(
    canUseIssueSessionTerminal(selectedSession.value) &&
    !selectedTerminalIsOpen.value &&
    openTerminalSessionCount.value >= maxOpenIssueSessions.value
  );
});

const hasCodexPromptHandoff = computed(() => {
  return selectedSession.value?.codex?.mode === "inject_prompt";
});

const isCodexPromptInjection = computed(() => {
  return hasCodexPromptHandoff.value && Boolean(selectedSession.value?.prompt);
});

const codexExpectedOutput = computed(() => {
  return selectedSession.value?.codex?.expectedOutput || null;
});

const codexExpectedOutputs = computed(() => {
  const outputs = selectedSession.value?.codex?.expectedOutputs;
  if (Array.isArray(outputs) && outputs.length > 0) {
    return outputs.filter((output) => output?.field);
  }
  return codexExpectedOutput.value?.field ? [codexExpectedOutput.value] : [];
});

const isCodexOutputStep = computed(() => {
  return hasCodexPromptHandoff.value && codexEditableOutputs.value.length > 0;
});

const codexInputFieldsByName = computed(() => {
  const input = selectedStepInput.value || {};
  const fields = Array.isArray(input.fields) ? input.fields : [];
  return Object.fromEntries(fields.map((field) => [field.name, field]));
});

const codexEditableOutputs = computed(() => {
  return codexExpectedOutputs.value.map((output) => {
    const inputField = codexInputFieldsByName.value[output.field] || {};
    return {
      ...inputField,
      ...output,
      field: output.field,
      required: output.required !== false && inputField.required !== false
    };
  });
});

const hasAnyEditableCodexOutput = computed(() => {
  return codexEditableOutputs.value.some((output) => codexOutputDraftValue(output).trim());
});

const codexWaitingMessage = computed(() => {
  if (!selectedSession.value?.prompt && !hasAnyEditableCodexOutput.value) {
    return "Run this step to ask Codex for the required output.";
  }
  const labels = codexEditableOutputs.value
    .map((output) => String(output.label || output.field || "output").trim().toLowerCase())
    .filter(Boolean);
  return `Waiting for Codex ${labels.length ? labels.join(" and ") : "output"}.`;
});

const extractedCodexOutputEntries = computed(() => {
  return codexEditableOutputs.value.map((output) => ({
    key: codexOutputDraftKeyFor(output),
    value: extractMarkedOutput(selectedCodexTerminalOutput.value, output.extract, {
      formatHint: output.formatHint,
      singleLine: !codexOutputIsMultiline(output)
    })
  }));
});

function codexOutputDraftKeyFor(output = {}) {
  const sessionId = selectedSessionId.value || "";
  const field = String(output.field || "").trim();
  const extract = String(output.extract || "").trim();
  return sessionId && field ? `${sessionId}:${field}:${extract}` : "";
}

function codexOutputDraftValue(output = {}) {
  const key = codexOutputDraftKeyFor(output);
  return key ? codexOutputDraftByKey.value[key] || "" : "";
}

function setCodexOutputDraft(output = {}, value = "") {
  const key = codexOutputDraftKeyFor(output);
  if (!key) {
    return;
  }
  codexOutputDraftByKey.value = {
    ...codexOutputDraftByKey.value,
    [key]: String(value || "")
  };
}

const selectedCodexTerminalOutput = computed(() => {
  return codexTerminalOutputBySessionId.value[selectedSessionId.value] || "";
});

const terminalSessions = computed(() => {
  const listedSessionIds = (issueSessions.value || []).map((session) => session.sessionId);
  const orderedSessionIds = [...new Set([
    ...listedSessionIds,
    ...(
      selectedSessionId.value && !listedSessionIds.includes(selectedSessionId.value)
        ? [selectedSessionId.value]
        : []
    ),
    ...Object.keys(terminalSessionById.value).filter((sessionId) => !listedSessionIds.includes(sessionId))
  ])];
  return orderedSessionIds
    .map((sessionId) => {
      if (sessionId === selectedSessionId.value && selectedSession.value?.sessionId === sessionId) {
        return {
          ...(terminalSessionById.value[sessionId] || {}),
          ...selectedSession.value
        };
      }
      return terminalSessionById.value[sessionId];
    })
    .filter(canDisplayTerminalSession);
});

const canRunAction = computed(() => {
  if (!selectedStepAction.value || isTerminalSession.value || issueSessionBusy.value) {
    return false;
  }
  if (isCodexOutputStep.value) {
    if (!selectedSession.value?.prompt && !hasAnyEditableCodexOutput.value) {
      return true;
    }
    return codexEditableOutputs.value
      .filter((output) => output.required !== false)
      .every((output) => Boolean(codexOutputDraftValue(output).trim()));
  }
  const input = selectedStepInput.value || {};
  if (input.required && input.name) {
    return Boolean(String(stepInputValues.value[input.name] || "").trim());
  }
  return true;
});

const currentActionButtonLabel = computed(() => {
  if (isCodexOutputStep.value && codexEditableOutputs.value.some((output) => output.field === "issue")) {
    return "Create issue";
  }
  if (isCodexOutputStep.value) {
    return selectedStepAction.value?.buttonLabel || "Done";
  }
  return selectedStepAction.value?.buttonLabel || "Run Step";
});

const sessionFactItems = computed(() => {
  return issueSessionFacts(selectedSession.value || {}, orderedStepDefinitions.value)
    .map((fact) => ({
      ...fact,
      icon: sessionFactIcon(fact.icon)
    }));
});

function shortSessionId(sessionId) {
  return shortIssueSessionId(sessionId);
}

function sessionFactIcon(icon) {
  return {
    branch: mdiSourceBranch,
    codex: mdiRobotOutline,
    github: mdiGithub,
    session: mdiIdentifier,
    step: mdiProgressCheck,
    worktree: mdiFolderOutline
  }[icon] || mdiIdentifier;
}

function codexOutputLabel(output = {}) {
  const label = String(output.label || output.field || "Codex output").trim();
  return `${label} from Codex`;
}

function codexOutputIsMultiline(output = {}) {
  return output.multiline === true || output.formatHint === "markdown";
}

function factExpansionKey(fact = {}) {
  return selectedSessionId.value && fact.key ? `${selectedSessionId.value}:${fact.key}` : "";
}

function factIsExpanded(fact = {}) {
  const key = factExpansionKey(fact);
  return Boolean(key && expandedFactKeys.value[key]);
}

function toggleFact(fact = {}) {
  if (!fact.expandable) {
    return;
  }
  const key = factExpansionKey(fact);
  if (!key) {
    return;
  }
  const nextExpandedFactKeys = {
    ...expandedFactKeys.value
  };
  if (nextExpandedFactKeys[key]) {
    delete nextExpandedFactKeys[key];
  } else {
    nextExpandedFactKeys[key] = true;
  }
  expandedFactKeys.value = nextExpandedFactKeys;
}

function terminalLimitReachedFor(sessionId) {
  return !terminalSessionById.value[sessionId] && openTerminalSessionCount.value >= maxOpenIssueSessions.value;
}

function canDisplayTerminalSession(session = {}) {
  const sessionId = session?.sessionId || "";
  if (!sessionId || !canUseIssueSessionTerminal(session)) {
    return false;
  }
  return Boolean(terminalSessionById.value[sessionId]) ||
    (sessionId === selectedSessionId.value && !terminalLimitReachedFor(sessionId));
}

function canAbandonSessionFromChip(session = {}) {
  return session.sessionId === selectedSessionId.value && !isClosedIssueSession(session);
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
  }).then(rememberTerminalSession);
}

function rememberTerminalSession(session = selectedSession.value) {
  const sessionId = session?.sessionId || "";
  if (!sessionId) {
    return;
  }
  if (isAbandonedIssueSession(session)) {
    forgetTerminalSession(sessionId);
    return;
  }
  if (!canUseIssueSessionTerminal(session)) {
    return;
  }
  if (terminalLimitReachedFor(sessionId)) {
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
  if (selectedSessionId.value && !isAbandonedIssueSession(selectedSession.value)) {
    sessionIds.add(selectedSessionId.value);
  }
  terminalSessionById.value = Object.fromEntries(
    Object.entries(terminalSessionById.value)
      .filter(([sessionId, session]) => sessionIds.has(sessionId) && !isAbandonedIssueSession(session))
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

function applyIssueSessionUpdate(patch = {}) {
  const patchedSession = patchIssueSession(patch);
  rememberTerminalSession(patchedSession || {
    ...(terminalSessionById.value[patch?.sessionId] || {}),
    ...patch
  });
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
  const payload = Object.fromEntries(codexEditableOutputs.value
    .map((output) => [
      String(output.field || "").trim(),
      codexOutputDraftValue(output).trim()
    ])
    .filter(([field]) => Boolean(field)));
  if (!Object.keys(payload).length) {
    if (!selectedSession.value?.prompt) {
      rememberTerminalSession(await runSelectedStep());
    }
    return;
  }

  const response = await runSelectedStep(payload);
  rememberTerminalSession(response);
  if (shouldRunImmediateNextStep(response)) {
    rememberTerminalSession(await runSelectedStep());
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
  void runSelectedStep().then(rememberTerminalSession);
}

watch(selectedSession, (session) => {
  rememberTerminalSession(session);
}, {
  immediate: true
});

watch(issueSessions, () => {
  pruneTerminalSessions();
});

watch(extractedCodexOutputEntries, (entries) => {
  let nextDrafts = codexOutputDraftByKey.value;
  let nextSources = codexOutputSourceByKey.value;
  for (const entry of entries) {
    const key = entry.key;
    const nextOutput = String(entry.value || "");
    if (!key || !nextOutput) {
      continue;
    }
    const previousSource = nextSources[key] || "";
    const existingDraft = nextDrafts[key];
    if (existingDraft === undefined || existingDraft === previousSource) {
      nextDrafts = {
        ...nextDrafts,
        [key]: nextOutput
      };
    }
    nextSources = {
      ...nextSources,
      [key]: nextOutput
    };
  }
  codexOutputDraftByKey.value = nextDrafts;
  codexOutputSourceByKey.value = nextSources;
}, {
  immediate: true
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

.studio-issue-sessions__facts {
  display: grid;
  gap: 0.75rem;
  padding: 0.75rem;
}

.studio-issue-sessions__facts-header {
  align-items: flex-start;
  display: flex;
  gap: 0.75rem;
  justify-content: space-between;
  min-width: 0;
}

.studio-issue-sessions__facts-title {
  font-size: 0.98rem;
  font-weight: 700;
  letter-spacing: 0;
  line-height: 1.2;
  margin: 0;
}

.studio-issue-sessions__facts-grid {
  display: grid;
  gap: 0.55rem;
  grid-template-columns: repeat(2, minmax(0, 1fr));
}

.studio-issue-sessions__fact {
  align-items: flex-start;
  background: rgb(var(--v-theme-surface));
  border: 1px solid rgba(var(--v-border-color), 0.26);
  border-radius: 8px;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.06);
  display: grid;
  gap: 0.55rem;
  grid-template-columns: 1.7rem minmax(0, 1fr) auto;
  min-width: 0;
  padding: 0.62rem;
}

.studio-issue-sessions__fact--expandable {
  cursor: pointer;
  transition: background 140ms ease, border-color 140ms ease, box-shadow 140ms ease;
}

.studio-issue-sessions__fact--expandable:hover,
.studio-issue-sessions__fact--expandable:focus-visible {
  background: rgba(var(--v-theme-primary), 0.035);
  border-color: rgba(var(--v-theme-primary), 0.36);
  box-shadow: 0 2px 8px rgba(15, 23, 42, 0.08);
  outline: none;
}

.studio-issue-sessions__fact--expanded {
  border-color: rgba(var(--v-theme-primary), 0.48);
  grid-column: 1 / -1;
}

.studio-issue-sessions__fact-icon {
  align-items: center;
  background: rgba(var(--v-theme-primary), 0.12);
  border-radius: 999px;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  height: 1.7rem;
  justify-content: center;
  width: 1.7rem;
}

.studio-issue-sessions__fact-copy {
  min-width: 0;
}

.studio-issue-sessions__fact-label {
  color: rgba(var(--v-theme-on-surface), 0.68);
  font-size: 0.72rem;
  font-weight: 700;
  letter-spacing: 0.02em;
  line-height: 1.2;
  text-transform: uppercase;
}

.studio-issue-sessions__fact-value {
  color: rgb(var(--v-theme-on-surface));
  font-size: 0.88rem;
  font-weight: 650;
  line-height: 1.25;
  margin-top: 0.12rem;
  overflow-wrap: anywhere;
}

.studio-issue-sessions__fact-link {
  align-items: center;
  color: rgb(var(--v-theme-primary));
  display: inline-flex;
  text-decoration: none;
}

.studio-issue-sessions__fact-link:hover,
.studio-issue-sessions__fact-link:focus-visible {
  text-decoration: underline;
}

.studio-issue-sessions__fact-detail {
  color: rgba(var(--v-theme-on-surface), 0.62);
  font-size: 0.78rem;
  line-height: 1.25;
  margin-top: 0.18rem;
  overflow-wrap: anywhere;
}

.studio-issue-sessions__fact-actions {
  align-items: center;
  display: inline-flex;
  gap: 0.1rem;
  margin-top: -0.2rem;
}

.studio-issue-sessions__fact-expanded {
  border-top: 1px solid rgba(var(--v-border-color), 0.32);
  grid-column: 1 / -1;
  padding-top: 0.62rem;
}

.studio-issue-sessions__fact-expanded pre {
  background: rgba(var(--v-theme-surface-variant), 0.52);
  border-radius: 6px;
  color: rgb(var(--v-theme-on-surface));
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
  font-size: 0.82rem;
  line-height: 1.42;
  margin: 0;
  max-height: 20rem;
  overflow: auto;
  padding: 0.75rem;
  white-space: pre-wrap;
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

  .studio-issue-sessions__facts-grid {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 620px) {
  .studio-issue-sessions__action-title {
    align-items: stretch;
    flex-direction: column;
  }

  .studio-issue-sessions__facts-header {
    align-items: stretch;
    flex-direction: column;
  }
}
</style>
