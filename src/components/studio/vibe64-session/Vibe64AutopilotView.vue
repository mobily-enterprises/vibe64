<template>
  <section
    class="studio-autopilot"
    :class="{ 'studio-autopilot--chat-collapsed': chatCollapsed }"
  >
    <Teleport
      v-if="sessionGithubActorHeaderVisible"
      :to="props.githubActorTeleportTarget"
    >
      <div
        class="studio-home-shell-session-github-actor"
        :class="{ 'studio-home-shell-session-github-actor--inactive': !sessionGithubActor.active }"
        role="status"
        :title="sessionGithubActor.title"
      >
        <v-icon :icon="mdiGithub" size="14" />
        <span>{{ sessionGithubActor.displayLabel }}</span>
      </div>
    </Teleport>
    <!-- Only the selected session's recording indicator is in the header. -->
    <Teleport v-if="props.active && props.usageRecordingTeleportTarget && sessionId" :to="props.usageRecordingTeleportTarget" defer>
      <Vibe64UsageRecordingIndicator :session-id="sessionId" @open-usage="openUsage" />
    </Teleport>
    <Vibe64CreatePullRequestDialog v-if="githubProject" v-model="createPullRequestOpen" :dashboard-context="dashboardContext" />
    <Vibe64AiTaskHost :view="view">
      <section
        ref="mainChat"
        class="studio-autopilot__chat-panel"
        aria-label="Session chat"
        tabindex="-1"
      >
        <Vibe64AutopilotSessionHeader :view="view" />

        <Vibe64AutopilotActivity :view="view" />

        <Vibe64AutopilotChat :view="view" />
      </section>

      <Vibe64AutopilotProjectPanel :view="view">
        <template #dashboard="dashboardSlotProps">
          <slot name="dashboard" v-bind="dashboardSlotProps" />
        </template>
        <template #ai-terminal="terminalSlotProps">
          <slot name="ai-terminal" v-bind="terminalSlotProps" />
        </template>
      </Vibe64AutopilotProjectPanel>

      <Vibe64AutopilotDialogs :view="view" />
    </Vibe64AiTaskHost>
  </section>
</template>

<script setup>
import { vibe64ProviderPresentation } from "@local/vibe64-runtime/shared";
import { computed, inject, nextTick, onBeforeUnmount, reactive, ref, shallowRef, watch, watchEffect } from "vue";
import { VIBE64_ASSISTANT_HOST_KEY } from "@/lib/vibe64AssistantHost.js";
import { NO_RESOURCE_RECOVERY_CONTROL, VIBE64_RESOURCE_RECOVERY_KEY } from "@/lib/vibe64ResourceRecovery.js";
import { useRealtimeEvent } from "@jskit-ai/realtime/client/composables/useRealtimeEvent";
import { mdiGithub } from "@mdi/js";
import { vibe64SessionPullRequest } from "@/lib/vibe64SessionViewModel.js";
import Vibe64CreatePullRequestDialog from "@/components/studio/vibe64-session/Vibe64CreatePullRequestDialog.vue";
import { Vibe64UsageRecordingIndicator } from "@local/vibe64-usage-recording/client";
import { useModelRouting } from "@local/vibe64-accounts/client";
import { useVibe64StarredFiles } from "@/composables/useVibe64StarredFiles.js";
import Vibe64AiTaskHost from "./Vibe64AiTaskHost.vue";
import Vibe64AutopilotActivity from "./Vibe64AutopilotActivity.vue";
import Vibe64AutopilotChat from "./Vibe64AutopilotChat.vue";
import Vibe64AutopilotDialogs from "./Vibe64AutopilotDialogs.vue";
import Vibe64AutopilotProjectPanel from "./Vibe64AutopilotProjectPanel.vue";
import Vibe64AutopilotSessionHeader from "./Vibe64AutopilotSessionHeader.vue";
import { useVibe64MainChatApprovals } from "@/composables/useVibe64MainChatApprovals.js";
import { useVibe64ProjectSlug } from "@/composables/useVibe64ProjectScope.js";
import { useDisplay } from "vuetify";
import { useVibe64Learning } from "@/composables/useVibe64Learning.js";
import { readRefOrGetterValue } from "@/lib/vueRefOrGetterValue.js";
import { githubProjectAvailable } from "@/lib/vibe64GithubProject.js";
import { projectAppPath } from "@/lib/vibe64ProjectScope.js";
import { useVibe64AutopilotView } from "@/composables/useVibe64AutopilotView.js";
import { vibe64AutopilotViewEmits, vibe64AutopilotViewProps } from "@/lib/vibe64AutopilotViewProps.js";
import {
  VIBE64_SESSION_CHANGED_EVENT
} from "@/lib/vibe64SessionRequestConfig.js";

const emit = defineEmits(vibe64AutopilotViewEmits);
const props = defineProps(vibe64AutopilotViewProps);
const learning = useVibe64Learning();
const lessonShown = computed(() => learning.lessonShown);
/** @type {import("vue").Component} */
const providedRecoveryControl = inject(VIBE64_RESOURCE_RECOVERY_KEY, NO_RESOURCE_RECOVERY_CONTROL);
const resourceRecoveryControl = providedRecoveryControl === NO_RESOURCE_RECOVERY_CONTROL ? null : providedRecoveryControl;
// Usage in the Architecture tool, opened from the recording indicator
// ({ recordingId }) or from a pick in Preview ({ entryId, mode }).
const usageOpenRequest = ref(null);
watch(() => props.session?.sessionId, () => {
  usageOpenRequest.value = null;
});
const sourceOperationsSuspended = computed(() => (
  props.sessionRenewal?.sourceOperationsSuspended === true
));
const composerInput = ref(null);
const mainChat = ref(null);
const approvalsPanel = ref(null);
const { xs: phoneLayout } = useDisplay();
const temporaryAiWorkspace = ref(null);
// The AI task chat's composer while that chat is shown, which preview attachments go to.
const aiTaskComposer = shallowRef(null);
const testApproval = ref(null);
function updateTestApproval(value) {
  if (value.sessionId === props.session?.sessionId) testApproval.value = value.approval;
}
watch(() => props.session?.sessionId, () => { testApproval.value = null; });
const selectedAssistantSessionId = computed(() => String(
  props.session?.sessionId || ""
).trim());
const openCodeProgressLabel = ref("");
const openCodeProviderLabel = computed(() => vibe64ProviderPresentation(props.session?.assistantSelection).label || "OpenCode");

function visibleOpenCodeProgressLabel(progress = {}) {
  if (String(progress.tool || "").trim()) {
    return `${openCodeProviderLabel.value} is using a tool…`;
  }
  if (
    String(progress.partType || "").trim() === "reasoning" ||
    String(progress.type || "").includes("reasoning")
  ) {
    return `${openCodeProviderLabel.value} is reasoning…`;
  }
  if (String(progress.text || "").trim()) {
    return `${openCodeProviderLabel.value} is writing…`;
  }
  return `${openCodeProviderLabel.value} is working…`;
}

useRealtimeEvent({
  enabled: computed(() => Boolean(
    props.active &&
    !props.sessionSelectionArchived &&
    selectedAssistantSessionId.value &&
    props.session?.assistantSelection?.engineId === "opencode"
  )),
  event: VIBE64_SESSION_CHANGED_EVENT,
  matches: ({ payload = {} } = {}) => Boolean(
    String(payload.sessionId || payload.entityId || "").trim() === selectedAssistantSessionId.value &&
    (
      payload.assistantProgress ||
      [
        "opencode-server-message-delivered",
        "opencode-server-turn-active",
        "opencode-server-turn-idle"
      ].includes(payload.reason)
    )
  ),
  onEvent: ({ payload = {} } = {}) => {
    openCodeProgressLabel.value = payload.reason === "opencode-server-turn-idle"
      ? ""
      : visibleOpenCodeProgressLabel(payload.assistantProgress || {});
  }
});

watch([
  selectedAssistantSessionId,
  () => props.session?.assistantSelection?.engineId
], () => {
  openCodeProgressLabel.value = "";
}, { immediate: true });
// Only whether this person manages AI: the light main-chat read, shared with
// Start an AI session. Models makes the full read when it opens.
const { resource: modelRoutingResource } = useModelRouting({
  view: "main",
  enabled: computed(() => !props.sessionSelectionArchived && Boolean(selectedAssistantSessionId.value))
});
const assistantCanConfigureRouting = computed(() => modelRoutingResource.data.value?.canConfigure === true);
const assistantAccessError = computed(() => props.conversationRuntime.access.accessError.value);
const assistantCanUseAiState = computed(() => props.conversationRuntime.access.canUseChat.value);
const assistantCanRouteChat = computed(() => props.conversationRuntime.access.canRouteChat.value);
const assistantCanUseNative = computed(() => props.conversationRuntime.access.canUseNative.value);
const assistantPurposes = computed(() => props.conversationRuntime.access.purposes.value);
const assistantAccessScopeKey = computed(() => props.conversationRuntime.access.scopeKey.value);
const assistantAccessLoading = computed(() => props.conversationRuntime.access.initialAccessLoading.value);
// A team member's main-chat restriction is the approval queue, which the composer hint explains.
const assistantRestrictionMessage = computed(() => mainChatApprovals.memberMode ? ""
  : props.conversationRuntime.access.restrictionMessage.value);
const assistantCanUsePurpose = purpose => props.conversationRuntime.access.canUsePurpose(purpose);
const reloadAssistantAccess = () => props.conversationRuntime.access.reload();

// A team member's main-chat messages go to the owner for approval.
const mainChatApprovals = reactive(useVibe64MainChatApprovals({
  active: () => props.active && !props.sessionSelectionArchived,
  projectSlug: useVibe64ProjectSlug(),
  sessionId: selectedAssistantSessionId,
  sessionsApiPath: () => readRefOrGetterValue(props.sessionsApiPath),
  onReview(reviewedSessionId) {
    if (reviewedSessionId && reviewedSessionId !== selectedAssistantSessionId.value) {
      props.sessionToolbar?.selectSession?.(reviewedSessionId);
    }
    void nextTick(revealApprovals);
  }
}));

const autopilotView = useVibe64AutopilotView(props, emit, {
  assistantAccessLoading,
  assistantCanUseAi: assistantCanUseAiState,
  assistantCanRouteChat,
  assistantCanUseFix: computed(() => assistantCanUsePurpose("fix")),
  assistantCanUseNative,
  assistantProgressLabel: openCodeProgressLabel,
  mainChatApprovals,
  onAttachmentsAccepted: (attachmentIds) => composerInput.value?.clearAttachments?.({ attachmentIds })
});
const {
  agentActive, assistantDirectAllowed, assistantDraftAvailable, assistantFixAllowed, chatCollapsed,
  dashboardSessionContext, openSourceEditorFile, prefillComposer, projectSlug,
  selectSessionTool, sessionGithubActor, sessionGithubActorHeaderVisible, sessionId, sourceEditorOpenRequest
} = autopilotView;
function openUsage({ entryId = "", mode = "recording", recordingId = "" } = {}) {
  if (!selectSessionTool("system")) return;
  usageOpenRequest.value = {
    view: "usage",
    mode,
    ...(recordingId ? { recordingId } : {}),
    ...(entryId ? { entryId } : {}),
    nonce: (usageOpenRequest.value?.nonce || 0) + 1
  };
}
const fileBookmarks = useVibe64StarredFiles({
  projectSlug,
  sessionId,
  sessionsApiPath: () => props.sessionsApiPath
});
function revealApprovals() {
  if (phoneLayout.value) {
    approvalsPanel.value?.open();
    return;
  }
  mainChat.value?.querySelector(".vibe64-approvals")?.scrollIntoView({ block: "nearest", behavior: "smooth" });
}
watch(agentActive, (active) => {
  if (!active) {
    openCodeProgressLabel.value = "";
  }
}, { flush: "sync", immediate: true });

const createPullRequestOpen = ref(false);
const sessionPullRequest = computed(() => vibe64SessionPullRequest(props.session));
const sessionPullRequestTarget = computed(() => sessionPullRequest.value?.number ? {
  path: projectAppPath(projectSlug.value, '/dashboard/pull-requests'),
  query: { pr: String(sessionPullRequest.value.number) }
} : undefined);
const githubProject = computed(() => githubProjectAvailable(props.projectContext));
const assistantFixRestrictionMessage = computed(() => assistantPurposes.value.fix?.message || "Fix it with AI is unavailable. Review Models.");
const dashboardContext = computed(() => ({
  ...(dashboardSessionContext.value || {}),
  assistantDirectAllowed: assistantDirectAllowed.value,
  assistantDraftAvailable: assistantDraftAvailable.value,
  assistantFixAllowed: assistantFixAllowed.value,
  assistantFixRestrictionMessage: assistantFixRestrictionMessage.value,
  assistantRestrictionMessage: assistantRestrictionMessage.value,
  requestAssistantDraft: (text) => prefillComposer(text, { append: true }),
  requestUpdateWork: props.updateSessionWork,
  sourceOperationsSuspended: sourceOperationsSuspended.value
}));

function requestSessionRenewal(returnFocusTarget = null) {
  props.sessionRenewal?.request?.({
    returnFocusTarget: returnFocusTarget?.$el || returnFocusTarget
  });
  return true;
}

// A Learning environment "Show me" for one file opens it in this session's
// ordinary Dashboard -> Files editor, as a source link does.
function openWorkingFile(path) {
  if (typeof path !== "string" || !path) return false;
  openSourceEditorFile({ path, presentation: "code" });
  return sourceEditorOpenRequest.value?.path === path;
}

// The view's parts share the view composable's state and actions and the
// chat-wide state this component owns.
const view = {
  ...autopilotView,
  aiTaskComposer, approvalsPanel, assistantAccessError, assistantAccessLoading, assistantAccessScopeKey,
  assistantCanConfigureRouting, assistantCanUsePurpose, assistantFixRestrictionMessage, assistantPurposes,
  assistantRestrictionMessage, composerInput, createPullRequestOpen, dashboardContext, emit, fileBookmarks,
  githubProject, lessonShown, mainChat, mainChatApprovals, openUsage, openWorkingFile, phoneLayout, props,
  reloadAssistantAccess, requestSessionRenewal, resourceRecoveryControl, revealApprovals,
  selectedAssistantSessionId, sessionPullRequest, sessionPullRequestTarget, sourceOperationsSuspended,
  temporaryAiWorkspace, testApproval, updateTestApproval, usageOpenRequest
};

/**
 * The selected app layer is shared with host-owned companions; retained sessions cannot claim it.
 * @type {import("@/lib/vibe64AssistantHost.js").ShellSlot<typeof assistantLayer>}
 */
const assistantHost = inject(VIBE64_ASSISTANT_HOST_KEY);
const assistantLayerSelected = computed(() => props.active && !props.sessionSelectionArchived && !temporaryAiWorkspace.value?.visible);
const assistantLayer = reactive({
  get sessionId() { return sessionId.value; },

});
watchEffect(() => {
  if (assistantLayerSelected.value) {
    assistantHost.value = assistantLayer;
  } else if (assistantHost.value === assistantLayer) {
    assistantHost.value = null;
  }
}, { flush: "sync" });
onBeforeUnmount(() => {
  if (assistantHost.value === assistantLayer) {
    assistantHost.value = null;
  }
});

</script>

<style scoped>
.studio-autopilot {
  background: rgb(var(--v-theme-background));
  display: grid;
  grid-template-columns: minmax(20rem, 38%) minmax(0, 1fr);
  height: 100%;
  min-height: 0;
  min-width: 0;
  overflow: hidden;
}

.studio-home-shell-session-github-actor {
  align-items: center;
  color: rgba(var(--v-theme-on-surface), 0.72);
  display: inline-flex;
  font-size: 0.72rem;
  font-weight: 650;
  gap: 0.24rem;
  line-height: 1;
  max-width: 100%;
  min-width: 0;
  padding: 0 0.36rem;
  white-space: nowrap;
}

.studio-home-shell-session-github-actor span {
  min-width: 0;
  overflow: hidden;
  text-overflow: ellipsis;
}

.studio-home-shell-session-github-actor--inactive {
  color: rgba(var(--v-theme-on-surface), 0.46);
}

.studio-autopilot--chat-collapsed {
  grid-template-columns: 0 minmax(0, 1fr);
}

.studio-autopilot__chat-panel {
  background: rgb(var(--v-theme-surface));
  border-right: 1px solid rgba(var(--v-theme-outline), 0.14);
  container-name: studio-chat-pane;
  container-type: inline-size;
  display: grid;
  grid-template-rows: auto auto minmax(0, 1fr);
  min-height: 0;
  min-width: 0;
  overflow: hidden;
  position: relative;
}

.studio-autopilot--chat-collapsed .studio-autopilot__chat-panel {
  visibility: hidden;
}

@media (min-width: 981px) {
  .studio-autopilot {
    gap: var(--studio-home-project-gap, 0.75rem);
    grid-template-columns:
      var(--studio-home-chat-column-width, 32rem)
      minmax(0, 1fr);
  }

  .studio-autopilot--chat-collapsed {
    gap: 0;
    grid-template-columns: 0 minmax(0, 1fr);
  }
}

@media (max-width: 980px) {
  .studio-autopilot:not(.studio-autopilot--chat-collapsed) {
    grid-template-columns: minmax(0, 1fr) 0;
  }

  .studio-autopilot:not(.studio-autopilot--chat-collapsed) .studio-autopilot__project-panel {
    visibility: hidden;
  }
}
</style>
