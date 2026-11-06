<template>
  <header ref="sessionHeader" class="studio-autopilot__session-header">
    <Vibe64SessionToolbar
      v-if="sessionToolbarVisible"
      :active="props.active"
      :archive="props.sessionArchive"
      compact
      :create-visible="props.sessionToolbar.createSessionVisible === true"
      :create-teleport-target="props.createSessionTeleportTarget"
      :max-visible-sessions="3"
      :selected-session-id="sessionId"
      :selection-archived="sessionArchiveDisabled"
      :show-repository-problem="showRepositoryProblem"
      :toolbar="props.sessionToolbar"
    />

    <v-tooltip
      v-if="saveWorkHeaderVisible"
      :model-value="saveWorkChecking"
      location="bottom"
      :open-on-click="false"
      :open-on-focus="false"
      :open-on-hover="false"
    >
      <template #activator="{ props: checkingProps }">
        <v-btn
          v-bind="checkingProps"
          :aria-busy="saveWorkSending || saveWorkChecking ? 'true' : undefined"
          :aria-label="saveWorkChecking ? 'Checking repository status' : saveWorkCheckAvailable ? 'Check for updates' : saveWorkHeaderAriaLabel"
          class="studio-autopilot__save-work"
          :class="{ 'studio-autopilot__save-work--check': saveWorkCheckAvailable }"
          data-vibe64-guide="save"
          :color="saveWorkRequiresUpdate ? 'warning' : (saveWorkUnsaved ? 'error' : undefined)"
          :disabled="saveWorkChecking || (saveWorkDisabled && !saveWorkCheckAvailable)"
          height="var(--session-action-size, 36px)"
          icon
          :title="saveWorkHeaderHint"
          type="button"
          variant="text"
          width="var(--session-action-size, 36px)"
          @click="requestSessionSaveWork"
        >
          <v-icon v-if="saveWorkRequiresUpdate" icon="$commit" />
          <span v-else-if="props.workState?.destination?.mode === 'github'" class="studio-autopilot__save-symbol" aria-hidden="true">
            <v-icon icon="$save" size="18" class="studio-autopilot__save-symbol-disk" />
            <v-icon icon="$commit" size="16" class="studio-autopilot__save-symbol-commit" />
          </span>
          <v-icon v-else icon="$save" />
        </v-btn>
      </template>
      <span role="status">Checking…</span>
    </v-tooltip>
    <v-chip
      v-if="mainChatApprovals.isOwner && mainChatApprovals.waitingCount"
      class="studio-autopilot__approvals-chip studio-autopilot__header-fixed"
      color="secondary"
      variant="tonal"
      size="small"
      prepend-icon="$schedule"
      :aria-label="`${mainChatApprovals.waitingCount} ${mainChatApprovals.waitingCount === 1 ? 'message' : 'messages'} waiting for your approval`"
      @click="revealApprovals"
    >
      {{ mainChatApprovals.waitingCount }} waiting
    </v-chip>
    <!-- After Save, actions keep the header in priority order; the lowest move into Session actions first. -->
    <div class="studio-autopilot__header-actions">
      <v-badge
        v-if="headerActions.inline.includes('temporary-ai')"
        color="primary" dot :model-value="temporaryAiHasUnreadMessages" offset-x="4" offset-y="4"
      >
        <v-btn
          :aria-label="temporaryAiHasUnreadMessages ? 'Open temporary AI: unread messages' : 'Open temporary AI'"
          class="studio-autopilot__header-action"
          data-vibe64-temporary-ai-action
          data-vibe64-header-action="temporary-ai"
          :disabled="!sessionId || props.sessionSelectionArchived"
          height="var(--session-action-size, 36px)"
          icon="$dominoMask"
          :title="temporaryAiHasUnreadMessages ? 'New messages in Temporary AI' : 'Open a temporary AI conversation'"
          type="button"
          variant="text"
          width="var(--session-action-size, 36px)"
          @click="openTemporaryAi"
        />
      </v-badge>
      <v-badge
        v-if="headerActions.inline.includes('renew')"
        :color="sessionRenewalActionPresentation.color || 'primary'"
        dot
        :model-value="sessionRenewalActionPresentation.attention === true"
        offset-x="4"
        offset-y="4"
      >
        <v-btn
          :aria-label="sessionRenewalActionPresentation.label"
          class="studio-autopilot__header-action"
          data-vibe64-session-renew-action
          data-vibe64-header-action="renew"
          height="var(--session-action-size, 36px)"
          icon="$autorenew"
          :title="sessionRenewalActionPresentation.reason"
          type="button"
          variant="text"
          width="var(--session-action-size, 36px)"
          @click="requestSessionRenewal($event.currentTarget)"
        />
      </v-badge>
      <Vibe64SessionPin
        v-if="headerActions.inline.includes('pin')"
        data-vibe64-header-action="pin"
        :key="`${readRefOrGetterValue(props.sessionsApiPath)}:${sessionId}`"
        :session="props.session"
        :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
        :refresh="props.refreshSessionData"
      />
      <v-btn
        v-if="headerActions.inline.includes('pull-request')"
        data-vibe64-header-action="pull-request"
        class="studio-autopilot__header-action"
        icon="$callMerge" height="var(--session-action-size, 36px)" width="var(--session-action-size, 36px)" variant="text"
        :aria-label="sessionPullRequest?.number ? 'View pull request' : 'Create pull request'"
        :title="sessionPullRequest?.number ? `View pull request #${sessionPullRequest.number}` : 'Create pull request'"
        :to="sessionPullRequestTarget" :disabled="!sessionPullRequest?.number && sourceOperationsSuspended"
        @click="!sessionPullRequest?.number && (createPullRequestOpen = true)"
      />
      <v-btn
        v-if="headerActions.inline.includes('prepare-workspace')"
        aria-label="Prepare workspace"
        class="studio-autopilot__header-action"
        data-vibe64-prepare-workspace
        data-vibe64-header-action="prepare-workspace"
        :disabled="workspaceSetupRetryDisabled"
        height="var(--session-action-size, 36px)"
        icon="$build"
        title="Prepare workspace: run all declared setup steps again"
        type="button"
        variant="text"
        width="var(--session-action-size, 36px)"
        @click="retryWorkspaceSetup"
      />
      <v-menu
        v-if="sessionActionsMenuVisible"
        location="bottom end"
      >
        <template #activator="{ props: menuProps }">
          <v-badge
            :color="(sessionRenewalActionPresentation.attention && sessionRenewalActionPresentation.color) || 'primary'"
            dot
            :model-value="sessionActionsAttention"
            offset-x="4"
            offset-y="4"
          >
            <v-btn
              ref="sessionActionsTrigger"
              v-bind="menuProps"
              :aria-label="sessionActionsLabel"
              class="studio-autopilot__header-action"
              data-vibe64-session-actions
              height="var(--session-action-size, 36px)"
              icon="$moreVert"
              title="Session actions"
              type="button"
              variant="text"
              width="var(--session-action-size, 36px)"
            />
          </v-badge>
        </template>
        <v-list aria-label="Session actions" density="compact" min-width="17rem">
          <v-list-item
            v-if="headerActions.overflow.includes('temporary-ai')"
            class="studio-autopilot__session-action-item"
            data-vibe64-temporary-ai-action
            :disabled="!sessionId || props.sessionSelectionArchived"
            :subtitle="temporaryAiHasUnreadMessages ? 'New messages in Temporary AI' : 'Open a separate short-lived conversation'"
            title="Temporary AI"
            @click="openTemporaryAi"
          >
            <template #prepend>
              <v-badge color="primary" dot :model-value="temporaryAiHasUnreadMessages">
                <v-icon icon="$dominoMask" />
              </v-badge>
            </template>
          </v-list-item>
          <v-list-item
            v-if="headerActions.overflow.includes('renew')"
            class="studio-autopilot__session-action-item"
            data-vibe64-session-renew-action
            prepend-icon="$autorenew"
            :subtitle="sessionRenewalActionPresentation.reason"
            :title="sessionRenewalActionPresentation.label"
            @click="requestSessionRenewal(sessionActionsTrigger?.$el)"
          />
          <Vibe64SessionPin
            v-if="headerActions.overflow.includes('pin')"
            :key="`${readRefOrGetterValue(props.sessionsApiPath)}:${sessionId}:menu`"
            list-item
            :session="props.session"
            :sessions-api-path="readRefOrGetterValue(props.sessionsApiPath)"
            :refresh="props.refreshSessionData"
          />
          <v-list-item
            v-if="headerActions.overflow.includes('pull-request')" min-height="48"
            prepend-icon="$callMerge" :title="sessionPullRequest?.number ? 'View pull request' : 'Create pull request'"
            :subtitle="sessionPullRequest?.number ? `PR #${sessionPullRequest.number}` : 'Propose this work for merging'"
            :to="sessionPullRequestTarget" :disabled="!sessionPullRequest?.number && sourceOperationsSuspended"
            @click="!sessionPullRequest?.number && (createPullRequestOpen = true)"
          />
          <v-list-item
            v-if="headerActions.overflow.includes('prepare-workspace')"
            data-vibe64-prepare-workspace
            min-height="48"
            :disabled="workspaceSetupRetryDisabled"
            prepend-icon="$build"
            subtitle="Run all declared setup steps again"
            title="Prepare workspace"
            @click="retryWorkspaceSetup"
          />
        </v-list>
      </v-menu>
    </div>
  </header>
</template>

<script setup>
import { computed, nextTick, ref, watch } from "vue";
import Vibe64SessionPin from "./Vibe64SessionPin.vue";
import Vibe64SessionToolbar from "@/components/studio/vibe64-session/Vibe64SessionToolbar.vue";
import { splitVibe64SessionHeaderActions, vibe64SessionNameStripWidth } from "@/lib/vibe64SessionToolbarVisibility.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { vibe64SessionSaveTarget } from "@/lib/vibe64SessionSaveTarget.js";

// The session header: the session names, Save, this session's actions and
// Session actions, which holds whatever does not fit.
const { view } = defineProps({
  // The Autopilot view's state and actions. It is never replaced, so its
  // members are read once.
  view: { type: Object, required: true }
});
// chat-attention: a dismissed Save or Update notice is shown again in the chat.
const emit = defineEmits(["chat-attention"]);
/** @type {import("@/composables/useVibe64AutopilotView.js").Vibe64AutopilotViewParts} */
const {
  createPullRequestOpen, githubProject,
  mainChatApprovals, props, repositoryOperationActive, requestSaveWork, requestSessionRenewal,
  retryWorkspaceSetup, revealApprovals, saveWorkActivityLabel, saveWorkDisabled,
  saveWorkError, saveWorkHeaderAriaLabel, saveWorkHeaderVisible, saveWorkOperationActive,
  saveWorkRequiresUpdate, saveWorkSending, saveWorkTitle, saveWorkUnsaved, sessionId, sessionPullRequest,
  sessionPullRequestTarget, sessionToolbarVisible, showSaveWorkActivity, sourceOperationsSuspended,
  temporaryAiWorkspace, workspaceSetupActionVisible, workspaceSetupRetryDisabled, workspaceSetupRetrying,
  workspaceSetupRunning
} = view;
const sessionRenewalActionPresentation = computed(() => (
  props.sessionRenewal?.actionPresentation ||
  props.sessionRenewal?.advisoryPresentation || {
    attention: false,
    color: undefined,
    label: "Renew session",
    reason: "Renew this session with a reviewed handover."
  }
));
const sessionActionsTrigger = ref(null);
const temporaryAiHasUnreadMessages = computed(() => temporaryAiWorkspace.value?.hasUnreadMessages === true);
// Session names get the header's room first, then Save, then these actions in
// priority order; whatever does not fit moves into Session actions.
const sessionHeader = ref(null);
const headerActionRoom = ref(Infinity);
const SESSION_NAME_MAX_WIDTH = 240; // the compact chip's max-width
function measureHeaderActionRoom() {
  const header = sessionHeader.value;
  if (!header) return;
  const style = getComputedStyle(header);
  const names = vibe64SessionNameStripWidth(header.querySelector(".studio-ai-sessions__tabs")?.children, SESSION_NAME_MAX_WIDTH);
  const fixed = [...header.querySelectorAll(".studio-autopilot__save-work, .studio-autopilot__header-fixed")]
    .reduce((total, element) => total + element.offsetWidth + 2, 0);
  const actionSize = (parseFloat(style.getPropertyValue("--session-action-size")) || 36) + 2;
  const room = header.clientWidth - parseFloat(style.paddingLeft) - parseFloat(style.paddingRight) - names - fixed - 8;
  headerActionRoom.value = Math.floor(room / actionSize);
}
watch(sessionHeader, (header, _previous, onCleanup) => {
  if (!header || typeof ResizeObserver === "undefined") return;
  const observer = new ResizeObserver(() => measureHeaderActionRoom());
  observer.observe(header);
  const toolbar = header.querySelector(".studio-ai-sessions__tabs");
  if (toolbar) observer.observe(toolbar);
  onCleanup(() => observer.disconnect());
});
const headerActionsAvailable = computed(() => [
  "temporary-ai",
  props.sessionRenewal?.visible && "renew",
  props.session?.sourceReady && !props.sessionSelectionArchived && "pin",
  githubProject.value && "pull-request",
  workspaceSetupActionVisible.value && "prepare-workspace"
].filter(Boolean));
const headerActions = computed(() => {
  const available = headerActionsAvailable.value;
  const room = headerActionRoom.value;
  // Everything fits without the menu, or one slot goes to Session actions.
  const slots = room >= available.length ? room : room - 1;
  return splitVibe64SessionHeaderActions(available, slots);
});
const sessionActionsMenuVisible = computed(() => headerActions.value.overflow.length > 0);
const sessionActionsAttention = computed(() =>
  (headerActions.value.overflow.includes("renew") && sessionRenewalActionPresentation.value.attention === true) ||
  (headerActions.value.overflow.includes("temporary-ai") && temporaryAiHasUnreadMessages.value));
const sessionActionsLabel = computed(() => [
  "Session actions",
  headerActions.value.overflow.includes("renew") && sessionRenewalActionPresentation.value.attention ? sessionRenewalActionPresentation.value.label : "",
  headerActions.value.overflow.includes("temporary-ai") && temporaryAiHasUnreadMessages.value ? "Unread temporary AI messages" : ""
].filter(Boolean).join(": "));
const sessionArchiveDisabled = computed(() => Boolean(
  props.sessionSelectionArchived ||
  props.sessionArchive?.command?.isRunning ||
  workspaceSetupRunning.value ||
  workspaceSetupRetrying.value
));

// The tab's info brings back a dismissed Save or Update notice in chat.
function showRepositoryProblem() {
  showSaveWorkActivity();
  emit("chat-attention");
}

function openTemporaryAi() {
  if (!sessionId.value || props.sessionSelectionArchived) {
    return false;
  }
  temporaryAiWorkspace.value?.showWorkspace();
  return true;
}

const saveWorkChecking = ref(false);
const saveWorkCheckAvailable = computed(() => Boolean(
  saveWorkDisabled.value && !saveWorkRequiresUpdate.value &&
  !saveWorkSending.value && !repositoryOperationActive.value &&
  !sourceOperationsSuspended.value && !props.sessionSelectionArchived
));
const saveWorkHeaderHint = computed(() => {
  const checkStatus = saveWorkChecking.value ? "Checking for updates…"
    : saveWorkCheckAvailable.value ? `${saveWorkTitle.value}. Click to check for updates.`
      : saveWorkTitle.value;
  // The failure that makes the repository need help, as its notice titles it.
  const status = saveWorkError.value && !saveWorkSending.value && !saveWorkOperationActive.value
    ? `${saveWorkActivityLabel.value} needs attention: ${saveWorkError.value}\n${checkStatus}`
    : checkStatus;
  // Where Save goes, said as the session tab's info says it.
  const destination = props.workState?.destination;
  const target = vibe64SessionSaveTarget(destination, props.projectContext);
  if (!target) return status;
  if (saveWorkRequiresUpdate.value || saveWorkDisabled.value || saveWorkChecking.value) {
    return `${status}\nSaves to ${target.text}`;
  }
  const action = destination.mode === "local_source" ? "Local commit"
    : destination.mode === "github" ? "Commit & push" : "Project version";
  return `${action} to ${target.text}\n${status}`;
});

async function requestSessionSaveWork() {
  if (saveWorkChecking.value) return;
  if (saveWorkCheckAvailable.value) {
    saveWorkChecking.value = true;
    try {
      await props.sessionToolbar.refreshRepositoryState(sessionId.value);
    } finally {
      saveWorkChecking.value = false;
    }
    return;
  }
  return requestSaveWork();
}

// Session names, Save and the available actions change the header's room.
watch(() => [
  (props.sessionToolbar?.sessions || []).map((session) => session?.sessionName || session?.sessionId).join("\n"),
  headerActionsAvailable.value.join(),
  saveWorkHeaderVisible.value,
  mainChatApprovals.waitingCount
].join("|"), () => nextTick(measureHeaderActionRoom));
</script>

<style scoped>
.studio-autopilot__session-header {
  align-items: center;
  border-bottom: 1px solid rgb(var(--v-theme-outline-variant));
  box-sizing: border-box;
  display: flex;
  gap: 0;
  grid-row: 1;
  justify-content: space-between;
  min-height: 3rem;
  min-width: 0;
  overflow: hidden;
  padding: 0.4rem 0.25rem;
  width: 100%;
}

.studio-autopilot__session-header :deep(.studio-ai-sessions__toolbar) {
  flex: 1 1 auto;
  margin-inline-end: 0.35rem;
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__session-header :deep(.studio-ai-sessions__tabs) {
  min-width: 0;
  overflow: hidden;
}

.studio-autopilot__header-actions {
  align-items: center;
  display: flex;
  flex: 0 0 auto;
  gap: 0.125rem;
  margin-inline-start: auto;
}

/* Light, compact address-bar style: thin icons, no filled discs. */
.studio-autopilot__header-action,
.studio-autopilot__save-work {
  border-radius: 8px;
}

/* Save keeps its unsaved (error) or update (warning) colour. */
.studio-autopilot__header-action,
.studio-autopilot__save-work:not(.text-error):not(.text-warning) {
  color: rgba(var(--v-theme-on-surface), 0.66);
}

.studio-autopilot__header-action :deep(.v-icon),
.studio-autopilot__save-work :deep(.v-btn__content > .v-icon) {
  font-size: 18px;
  height: 18px;
  width: 18px;
}

.studio-autopilot__header-action:hover,
.studio-autopilot__save-work:not(.text-error):not(.text-warning):hover {
  color: rgba(var(--v-theme-on-surface), 0.9);
}

.studio-autopilot__save-work.text-error,
.studio-autopilot__save-work.text-warning {
  background: color-mix(in srgb, currentColor 9%, transparent);
}

.studio-autopilot__header-action :deep(.v-btn__overlay),
.studio-autopilot__save-work :deep(.v-btn__overlay) {
  border-radius: inherit;
}

@media (pointer: coarse) {
  .studio-autopilot__session-header {
    --session-action-size: 44px;
  }
}

.studio-autopilot__session-action-item {
  min-height: 3rem;
}

.studio-autopilot__approvals-chip {
  align-self: center;
  flex-shrink: 0;
}

.studio-autopilot__save-work {
  flex: 0 0 auto;
}

.studio-autopilot__save-work--check {
  opacity: var(--v-disabled-opacity);
}

.studio-autopilot__save-symbol {
  position: relative;
  width: 24px;
  height: 22px;
}

.studio-autopilot__save-symbol-disk,
.studio-autopilot__save-symbol-commit {
  position: absolute;
  opacity: 0.72;
}

.studio-autopilot__save-symbol-disk { left: 0; bottom: 0; }
.studio-autopilot__save-symbol-commit { right: 0; top: 0; }
</style>
