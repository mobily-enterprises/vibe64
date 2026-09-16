import { computed, ref } from "vue";
import { useAssistantSuggestions } from "@jskit-ai/assistant-core/client/conversation-suggestions";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import {
  normalizedPromptHintDraft,
  normalizedPromptHintSuggestion,
  normalizedPromptHintSuggestions
} from "@local/vibe64-runtime/shared";
import {
  vibe64SessionPromptHintsCancelPath,
  vibe64SessionPromptHintsPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  vibe64BrowserTabOriginId
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";

const PROMPT_HINT_DEBOUNCE_MS = 750;
const PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT = 8;
let promptHintOperationSequence = 0;

function normalizedPromptHintText(value = "") {
  return String(value || "").trim();
}

function promptHintOperationId() {
  promptHintOperationSequence += 1;
  return `hint:${Date.now().toString(36)}:${promptHintOperationSequence.toString(36)}`;
}

function promptHintConversationFingerprint(turns = []) {
  const recentTurns = (Array.isArray(turns) ? turns : [])
    .slice(-PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT);
  return JSON.stringify(recentTurns.map((turn = {}) => ({
    assistant: normalizedPromptHintText(turn?.assistant?.text),
    turnId: normalizedPromptHintText(turn?.turnId),
    user: normalizedPromptHintText(turn?.user?.text)
  })));
}

function useVibe64PromptHints({
  active = true,
  blankConversation = false,
  canRequest = true,
  conversationKey = "",
  draft = "",
  existingProject = false,
  onSelect = () => false,
  policy = {},
  sessionId = "",
  sessionsApiPath = ""
} = {}, {
  debounceMs = PROMPT_HINT_DEBOUNCE_MS,
  request = (path, options) => getHttpWebClient().request(path, options)
} = {}) {
  const originId = vibe64BrowserTabOriginId();
  const responseStatus = ref("idle");
  const currentSessionId = computed(() => normalizedPromptHintText(readRefOrGetterValue(sessionId)));
  const currentSessionsApiPath = computed(() => normalizedPromptHintText(readRefOrGetterValue(sessionsApiPath)));
  const currentPolicy = computed(() => readRefOrGetterValue(policy) || {});
  const controller = useAssistantSuggestions({
    active: computed(() => Boolean(
      readRefOrGetterValue(active) !== false && readRefOrGetterValue(canRequest) !== false &&
      currentPolicy.value.enabled !== false && currentPolicy.value.ready === true &&
      currentSessionId.value && currentSessionsApiPath.value
    )),
    requestKey: computed(() => [
      currentSessionId.value, currentSessionsApiPath.value, readRefOrGetterValue(conversationKey),
      currentPolicy.value.revision, currentPolicy.value.version,
      readRefOrGetterValue(blankConversation), readRefOrGetterValue(existingProject)
    ]),
    draft: computed(() => normalizedPromptHintDraft(readRefOrGetterValue(draft))),
    debounceMs,
    onSelect,
    async generate({ draft: requestDraft, signal }) {
      const targetSession = currentSessionId.value;
      const targetPath = currentSessionsApiPath.value;
      const operationId = promptHintOperationId();
      const cancel = () => {
        void request(vibe64SessionPromptHintsCancelPath(targetPath, targetSession), {
          method: "POST", body: { operationId, originId }
        }).catch(() => null);
      };
      signal.addEventListener("abort", cancel, { once: true });
      try {
        const response = await request(vibe64SessionPromptHintsPath(targetPath, targetSession), {
          method: "POST", body: { draft: requestDraft, operationId, originId }, signal
        });
        if (signal.aborted) return [];
        responseStatus.value = response?.status;
        return ["ready", "static"].includes(response?.status) ? normalizedPromptHintSuggestions(response.suggestions) : [];
      } finally {
        signal.removeEventListener("abort", cancel);
      }
    }
  });
  return {
    blurComposer: controller.blur,
    composerFocused: controller.composerFocused,
    dismissPromptHints: controller.dismiss,
    focusComposer: controller.focus,
    loading: controller.loading,
    preview: controller.preview,
    previewPromptHint: suggestion => controller.previewSuggestion(normalizedPromptHintSuggestion(suggestion)),
    selectPromptHint: suggestion => controller.select(normalizedPromptHintSuggestion(suggestion)),
    status: computed(() => controller.loading.value ? "loading" : controller.items.value.length === 3 ? responseStatus.value : "idle"),
    suggestions: controller.items,
    visible: controller.visible
  };
}

export {
  PROMPT_HINT_DEBOUNCE_MS,
  PROMPT_HINT_RECENT_VISIBLE_TURN_LIMIT,
  normalizedPromptHintSuggestions,
  promptHintConversationFingerprint,
  useVibe64PromptHints
};
