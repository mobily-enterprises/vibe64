<template>
  <v-sheet rounded="lg" border class="studio-issue-sessions studio-screen__panel">
    <div class="d-flex flex-column flex-md-row ga-3 align-md-center justify-space-between mb-3">
      <div>
        <h2 class="text-subtitle-1 mb-1">Issue Sessions</h2>
        <p class="text-body-2 text-medium-emphasis mb-0">
          File-backed sessions from <code>.jskit/sessions/</code>. JSKIT owns the steps; Studio displays and advances them.
        </p>
      </div>
      <div class="d-flex ga-2 flex-wrap">
        <v-btn
          color="primary"
          variant="flat"
          :loading="issueSessionBusy"
          :prepend-icon="mdiPlus"
          @click="createSession"
        >
          New Session
        </v-btn>
        <v-btn
          variant="tonal"
          :loading="issueSessionsLoading"
          :prepend-icon="mdiRefresh"
          @click="loadIssueSessions"
        >
          Refresh
        </v-btn>
      </div>
    </div>

    <v-alert v-if="issueSessionsError" type="error" variant="tonal" class="mb-3">
      {{ issueSessionsError }}
    </v-alert>

    <div v-if="issueSessions.length" class="studio-issue-sessions__strip mb-3">
      <v-btn
        v-for="session in issueSessions"
        :key="session.sessionId"
        :color="session.sessionId === selectedSessionId ? 'primary' : 'default'"
        :variant="session.sessionId === selectedSessionId ? 'flat' : 'tonal'"
        class="studio-issue-sessions__tab"
        @click="selectSession(session.sessionId)"
      >
        <span class="studio-issue-sessions__status-dot" :class="`studio-issue-sessions__status-dot--${session.status}`" />
        <span>{{ session.sessionId }}</span>
      </v-btn>
    </div>

    <p v-else-if="!issueSessionsLoading" class="text-body-2 text-medium-emphasis mb-0">
      No issue sessions yet.
    </p>

    <div v-if="selectedSession" class="studio-issue-sessions__workspace">
      <div class="studio-issue-sessions__main">
        <div class="d-flex align-center justify-space-between ga-3 flex-wrap mb-3">
          <div>
            <h3 class="text-subtitle-1 mb-1">{{ selectedSession.sessionId }}</h3>
            <p class="text-caption text-medium-emphasis mb-0">{{ selectedSession.currentStep || "done" }}</p>
          </div>
          <div class="d-flex ga-2 flex-wrap">
            <v-chip size="small" variant="tonal">{{ selectedSession.status }}</v-chip>
            <v-btn
              color="error"
              variant="tonal"
              size="small"
              :loading="issueSessionBusy"
              :disabled="selectedSession.status === 'finished' || selectedSession.status === 'abandoned'"
              @click="abandonSelectedSession"
            >
              Abandon
            </v-btn>
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

        <v-textarea
          v-if="selectedSession.currentStep === '03_issue_prompt_rendered'"
          v-model="issuePromptInput"
          label="Short user request"
          variant="outlined"
          auto-grow
          rows="3"
          class="mb-3"
        />

        <v-textarea
          v-if="selectedSession.currentStep === '04_issue_drafted'"
          v-model="issueTextInput"
          label="Approved issue text"
          variant="outlined"
          auto-grow
          rows="6"
          class="mb-3"
        />

        <div class="d-flex ga-2 flex-wrap mb-3">
          <v-btn
            v-if="isUserCheckStep"
            color="success"
            variant="flat"
            :loading="issueSessionBusy"
            @click="runSelectedStep({ userCheck: 'passed' })"
          >
            User Check Passed
          </v-btn>
          <v-btn
            v-if="isUserCheckStep"
            color="error"
            variant="tonal"
            :loading="issueSessionBusy"
            @click="runSelectedStep({ userCheck: 'failed' })"
          >
            User Check Failed
          </v-btn>
          <v-btn
            v-if="!isUserCheckStep"
            color="primary"
            variant="flat"
            :loading="issueSessionBusy"
            :disabled="selectedSession.status === 'finished' || selectedSession.status === 'abandoned'"
            :prepend-icon="mdiPlay"
            @click="runSelectedStep()"
          >
            Run Next Step
          </v-btn>
          <v-btn
            v-if="selectedSession.prompt"
            variant="tonal"
            :prepend-icon="mdiContentCopy"
            @click="copyText(selectedSession.prompt, 'Prompt')"
          >
            Copy Prompt
          </v-btn>
        </div>

        <p v-if="copyStatus" class="text-caption text-medium-emphasis mb-2">{{ copyStatus }}</p>

        <v-textarea
          v-if="selectedSession.prompt"
          :model-value="selectedSession.prompt"
          label="Prompt"
          variant="outlined"
          readonly
          auto-grow
          rows="8"
          class="studio-issue-sessions__monospace"
        />
      </div>

      <aside class="studio-issue-sessions__side">
        <div class="studio-issue-sessions__field">
          <span>Issue</span>
          <a v-if="selectedSession.issueUrl" :href="selectedSession.issueUrl" target="_blank" rel="noreferrer">
            {{ selectedSession.issueUrl }}
          </a>
          <p v-else>not created</p>
        </div>
        <div class="studio-issue-sessions__field">
          <span>PR</span>
          <a v-if="selectedSession.prUrl" :href="selectedSession.prUrl" target="_blank" rel="noreferrer">
            {{ selectedSession.prUrl }}
          </a>
          <p v-else>not created</p>
        </div>
        <div class="studio-issue-sessions__field">
          <span>Worktree</span>
          <p>{{ selectedSession.worktree || "not created" }}</p>
        </div>
        <div class="studio-issue-sessions__field">
          <span>Next</span>
          <code>{{ selectedSession.nextCommand || "none" }}</code>
        </div>

        <h4 class="text-subtitle-2 mb-2">Receipts</h4>
        <v-list v-if="selectedSession.receipts?.length" density="compact" class="studio-issue-sessions__list">
          <v-list-item
            v-for="receipt in selectedSession.receipts"
            :key="receipt.stepId"
            :title="receipt.stepId"
            :subtitle="receipt.receipt"
          />
        </v-list>
        <p v-else class="text-body-2 text-medium-emphasis mb-3">No receipts yet.</p>

        <v-expansion-panels v-if="selectedSession.issueText || selectedSession.transcriptLog" variant="accordion">
          <v-expansion-panel v-if="selectedSession.issueText" title="Issue text">
            <v-expansion-panel-text>
              <pre class="studio-issue-sessions__pre">{{ selectedSession.issueText }}</pre>
            </v-expansion-panel-text>
          </v-expansion-panel>
          <v-expansion-panel v-if="selectedSession.transcriptLog" title="Transcript">
            <v-expansion-panel-text>
              <pre class="studio-issue-sessions__pre">{{ selectedSession.transcriptLog }}</pre>
            </v-expansion-panel-text>
          </v-expansion-panel>
        </v-expansion-panels>
      </aside>
    </div>
  </v-sheet>
</template>

<script setup>
import { onMounted, ref } from "vue";
import {
  mdiContentCopy,
  mdiPlay,
  mdiPlus,
  mdiRefresh
} from "@mdi/js";
import { useIssueSessions } from "@/composables/useIssueSessions.js";

const copyStatus = ref("");

const {
  abandonSelectedSession,
  createSession,
  isUserCheckStep,
  issuePromptInput,
  issueSessionBusy,
  issueSessions,
  issueSessionsError,
  issueSessionsLoading,
  issueTextInput,
  loadIssueSessions,
  runSelectedStep,
  selectSession,
  selectedSession,
  selectedSessionId
} = useIssueSessions();

async function copyText(value, label) {
  try {
    await navigator.clipboard.writeText(String(value || ""));
    copyStatus.value = `${label} copied.`;
  } catch (copyError) {
    copyStatus.value = String(copyError?.message || copyError || "Copy failed.");
  }
}

onMounted(() => {
  void loadIssueSessions();
});
</script>

<style scoped>
.studio-screen__panel {
  padding: 0.75rem;
}

.studio-issue-sessions__strip {
  display: flex;
  gap: 0.5rem;
  overflow-x: auto;
  padding-bottom: 0.125rem;
}

.studio-issue-sessions__tab {
  flex: 0 0 auto;
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

.studio-issue-sessions__workspace {
  display: grid;
  gap: 0.75rem;
  grid-template-columns: minmax(0, 1fr) minmax(18rem, 0.42fr);
}

.studio-issue-sessions__main,
.studio-issue-sessions__side {
  min-width: 0;
}

.studio-issue-sessions__side {
  border-left: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
  padding-left: 0.75rem;
}

.studio-issue-sessions__field {
  margin-bottom: 0.75rem;
  min-width: 0;
}

.studio-issue-sessions__field > span {
  color: rgb(var(--v-theme-on-surface-variant));
  display: block;
  font-size: 0.75rem;
  margin-bottom: 0.125rem;
}

.studio-issue-sessions__field p,
.studio-issue-sessions__field code,
.studio-issue-sessions__field a,
.studio-issue-sessions__list :deep(.v-list-item-title),
.studio-issue-sessions__list :deep(.v-list-item-subtitle) {
  overflow-wrap: anywhere;
}

.studio-issue-sessions__monospace :deep(textarea),
.studio-issue-sessions__pre {
  font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", monospace;
}

.studio-issue-sessions__pre {
  font-size: 0.8125rem;
  margin: 0;
  overflow-x: auto;
  white-space: pre-wrap;
}

.studio-issue-sessions__list {
  background: transparent;
  padding-block: 0;
}

@media (max-width: 520px) {
  .studio-issue-sessions__workspace {
    grid-template-columns: 1fr;
  }

  .studio-issue-sessions__side {
    border-left: 0;
    border-top: 1px solid rgba(var(--v-border-color), var(--v-border-opacity));
    padding-left: 0;
    padding-top: 0.75rem;
  }
}
</style>
