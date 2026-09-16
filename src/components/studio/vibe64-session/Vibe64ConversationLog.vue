<template>
  <AssistantConversationElement :adapter="adapter">
    <template #attachments="{ items }">
      <Vibe64ConversationAttachments :items="items" :session-id="sessionId" />
    </template>
    <template #message-actions="{ message, turn }">
      <v-card v-if="message.integrationRequest" class="mt-3" variant="outlined">
        <v-card-text class="text-break">
          Configure integration: {{ message.integrationRequest.integrationId }}
        </v-card-text>
        <v-card-actions>
          <v-btn
            :disabled="turn.pending || !integrationRequestsEnabled"
            min-height="48"
            @click="emit('open-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup?.requestId, integrationId: message.integrationRequest.integrationId })"
          >
            Configure
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'pending' && integrationConnections[turn.integrationSetup.requestId]?.status !== 'configuration-only'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit(integrationConnections[turn.integrationSetup.requestId]?.status === 'pending' ? 'check-integration' : 'connect-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            {{ integrationConnections[turn.integrationSetup.requestId]?.status === 'pending' ? 'Check connection' : 'Connect' }}
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'completed' && turn.integrationSetup.continuation?.status !== 'accepted'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('resume-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            Check continuation
          </v-btn>
          <v-btn
            v-if="turn.integrationSetup?.outcome === 'pending'"
            :disabled="turn.pending || !integrationRequestsEnabled || Boolean(integrationActionPending)"
            :loading="integrationActionPending?.turnId === turn.turnId"
            min-height="48"
            @click="emit('skip-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
          >
            Skip
          </v-btn>
          <span v-if="turn.integrationSetup?.outcome === 'skipped'" role="status">Skipped</span>
          <span v-if="turn.integrationSetup?.outcome === 'completed'" role="status">Setup completed</span>
        </v-card-actions>
        <v-card-text v-if="turn.integrationSetup?.outcome === 'pending' && integrationConnections[turn.integrationSetup.requestId]" role="status">
          <template v-if="integrationConnections[turn.integrationSetup.requestId].status === 'pending'">
            <a :href="integrationConnections[turn.integrationSetup.requestId].authorizationUrl" target="_blank" rel="noopener noreferrer">Continue with provider</a>
            <v-btn
              :disabled="!integrationRequestsEnabled || Boolean(integrationActionPending)"
              min-height="48"
              @click="emit('cancel-integration', { sessionId, turnId: turn.turnId, requestId: turn.integrationSetup.requestId })"
            >
              Cancel connection
            </v-btn>
          </template>
          <template v-else-if="integrationConnections[turn.integrationSetup.requestId].status === 'configuration-only'">This integration uses public settings and has no account to connect. Choose Configure to edit them and prepare the application's implementation request. Skip dismisses this connection request; it does not verify tracking.</template>
          <template v-else-if="integrationConnections[turn.integrationSetup.requestId].status === 'unconfigured'">Choose Configure to complete the application's setup.</template>
          <template v-else>{{ integrationConnections[turn.integrationSetup.requestId].status }}</template>
        </v-card-text>
        <v-card-text v-if="turn.integrationSetup?.outcome === 'completed'" role="status">
          <template v-if="turn.integrationSetup.continuation?.status === 'accepted'">Assistant continuation accepted.</template>
          <template v-else-if="turn.integrationSetup.continuation?.status === 'sending'">Assistant delivery is not yet confirmed. Check continuation to inspect delivery without sending it again.</template>
          <template v-else>Assistant continuation is pending. Check continuation to resume.</template>
        </v-card-text>
        <v-card-text v-if="integrationActionError?.turnId === turn.turnId" role="alert">
          {{ integrationActionError.message }}
        </v-card-text>
      </v-card>
    </template>
    <template v-if="$slots.hints" #hints>
      <slot name="hints" />
    </template>
    <template v-if="$slots.composer" #composer>
      <slot name="composer" />
    </template>
  </AssistantConversationElement>
</template>
<script setup>
import { computed, watch } from "vue";
import { AssistantConversationElement } from "@jskit-ai/assistant-core/client/conversation";
import Vibe64ConversationAttachments from "./Vibe64ConversationAttachments.vue";
import { sourceEditorLinkTarget } from "@/lib/vibe64SourceEditorLinks.js";
import { parseIntegrationSetupRequest } from "@local/vibe64-runtime/shared";

const props = defineProps({
  working: { type: Boolean, default: undefined },
  integrationConnections: { default: () => ({}), type: Object },
  integrationActionPending: { default: null, type: Object },
  integrationActionError: { default: null, type: Object },
  integrationRequestsEnabled: { default: false, type: Boolean },
  sessionId: { default: "", type: String },
  assistantLabel: {
    default: "Codex",
    type: String
  },
  error: {
    default: "",
    type: String
  },
  followLatestKey: {
    default: 0,
    type: [Number, String]
  },
  hasMoreBefore: {
    default: false,
    type: Boolean
  },
  loading: {
    default: false,
    type: Boolean
  },
  loadingMore: {
    default: false,
    type: Boolean
  },
  loadMoreError: {
    default: "",
    type: String
  },
  reloadable: {
    default: false,
    type: Boolean
  },
  reloading: {
    default: false,
    type: Boolean
  },
  scrollKey: {
    default: "",
    type: [Number, String]
  },
  sourceRoot: {
    default: "",
    type: String
  },
  turns: {
    default: () => [],
    type: Array
  },
  variant: {
    default: "main",
    validator: (value) => ["main", "task"].includes(value),
    type: String
  },
  visible: {
    default: false,
    type: Boolean
  },
  welcomeMessage: {
    default: "",
    type: String
  }
});

const emit = defineEmits([
  "cancel-turn",
  "edit-turn",
  "load-more",
  "open-integration",
  "skip-integration",
  "resume-integration",
  "connect-integration",
  "check-integration",
  "cancel-integration",
  "open-source-file",
  "reload",
  "resend-turn"
]);

// Recover one visible request at a time through the app's read-only status operation.
// Keep consent URLs out of browser persistence; the application owns pending attempts.
let recoverySession = "";
const recoveredRequests = new Set();
watch(() => [props.sessionId, props.visible, props.integrationRequestsEnabled,
  props.integrationActionPending, props.turns], () => {
  const key = props.visible && props.integrationRequestsEnabled ? props.sessionId : "";
  if (key !== recoverySession) {
    recoverySession = key;
    recoveredRequests.clear();
  }
  if (!key || props.integrationActionPending) return;
  const turn = props.turns.find((entry) => !entry.pending && entry.integrationSetup?.outcome === "pending" &&
    !recoveredRequests.has(`${entry.turnId}/${entry.integrationSetup.requestId}`));
  if (!turn) return;
  recoveredRequests.add(`${turn.turnId}/${turn.integrationSetup.requestId}`);
  emit("check-integration", { sessionId: key, turnId: turn.turnId, requestId: turn.integrationSetup.requestId });
}, { immediate: true });
function presentationMessage(message) {
  if (!message) {
    return message;
  }
  const integrationRequest = parseIntegrationSetupRequest(message);
  return integrationRequest ? { ...message, text: integrationRequest.text, integrationRequest } : message;
}

const adapter = computed(() => ({
  conversation: {
    working: props.working,
    assistantLabel: props.assistantLabel,
    error: props.error,
    followLatestKey: props.followLatestKey,
    hasMoreBefore: props.hasMoreBefore,
    loading: props.loading,
    loadingMore: props.loadingMore,
    loadMoreError: props.loadMoreError,
    reloadable: props.reloadable,
    reloading: props.reloading,
    scrollKey: props.scrollKey,
    variant: props.variant,
    visible: props.visible,
    welcomeMessage: props.welcomeMessage,
    turns: props.turns.map((turn) => ({
      ...turn,
      assistant: presentationMessage(turn.assistant),
      messages: turn.messages?.map(presentationMessage)
    }))
  },
  actions: {
    loadMore: (value) => emit("load-more", value),
    reload: () => emit("reload"),
    resend: (id) => emit("resend-turn", id),
    cancel: (id) => emit("cancel-turn", id),
    edit: (id) => emit("edit-turn", id),
    openLink(payload) {
      const target = sourceEditorLinkTarget({ href: payload.href, sourceRoot: props.sourceRoot, text: payload.text });
      if (!target) return;
      payload.event?.preventDefault?.();
      emit("open-source-file", target);
    }
  }
}));
</script>
