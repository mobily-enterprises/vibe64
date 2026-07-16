import { onScopeDispose, reactive, watch } from "vue";
import { getUsersWebHttpClient } from "@jskit-ai/users-web/client/lib/httpClient";
import {
  createComposerSubmissionId
} from "@/lib/vibe64ComposerSubmissionState.js";
import {
  vibe64RealtimeOriginPayload
} from "@/lib/vibe64BrowserTabOrigin.js";
import {
  vibe64SessionPath
} from "@/lib/vibe64SessionRequestConfig.js";
import {
  readRefOrGetterValue
} from "@/lib/vueRefOrGetterValue.js";
import {
  sourceSafetyDisplayPrompt,
  sourceSafetyPrompt
} from "@/lib/vibe64SessionSourceSafety.js";

const SESSION_SOURCE_SAFETY_POLL_MS = 5_000;
const SOURCE_SAFETY_PROMPT_SENT_MS = 4_000;
const SOURCE_SAFETY_CHECK_ERROR = "Session source safety could not be checked.";
const SOURCE_SAFETY_PROMPT_ERROR = "The save-work prompt could not be sent.";

function emptySessionSourceSafety(sessionId = "") {
  return {
    available: false,
    error: "",
    initialized: false,
    loading: false,
    promptError: "",
    promptSent: false,
    prompting: false,
    sessionId: String(sessionId || "").trim(),
    unsafe: false
  };
}

function sourceSafetySessionIds(sessions = []) {
  return [...new Set((Array.isArray(sessions) ? sessions : [])
    .map((session) => String(session?.sessionId || "").trim())
    .filter(Boolean))];
}

function useVibe64SessionSourceSafety({
  pollIntervalMs = SESSION_SOURCE_SAFETY_POLL_MS,
  sessions = () => [],
  sessionsApiPath = ""
} = {}) {
  const states = reactive({});
  const refreshes = new Map();
  const promptSentTimers = new Map();
  let submissionSequence = 0;

  function currentSessionIds() {
    return sourceSafetySessionIds(readRefOrGetterValue(sessions) || []);
  }

  function currentSessionsApiPath() {
    return String(readRefOrGetterValue(sessionsApiPath) || "").trim();
  }

  function ensureState(sessionId = "") {
    const normalizedSessionId = String(sessionId || "").trim();
    if (!normalizedSessionId) {
      return null;
    }
    if (!states[normalizedSessionId]) {
      const state = reactive(emptySessionSourceSafety(normalizedSessionId));
      state.refresh = () => refreshSession(normalizedSessionId);
      state.prompt = () => promptSession(normalizedSessionId);
      states[normalizedSessionId] = state;
    }
    return states[normalizedSessionId];
  }

  function statusForSession(sessionId = "") {
    return ensureState(sessionId);
  }

  function clearPromptSentTimer(sessionId = "") {
    const timer = promptSentTimers.get(sessionId);
    if (timer) {
      globalThis.clearTimeout(timer);
      promptSentTimers.delete(sessionId);
    }
  }

  function pruneStates(sessionIds = []) {
    const retainedIds = new Set(sessionIds);
    for (const sessionId of Object.keys(states)) {
      if (retainedIds.has(sessionId)) {
        continue;
      }
      clearPromptSentTimer(sessionId);
      delete states[sessionId];
    }
  }

  async function refreshSession(sessionId = "") {
    const state = ensureState(sessionId);
    const apiPath = currentSessionsApiPath();
    if (!state || !apiPath) {
      return null;
    }
    if (refreshes.has(state.sessionId)) {
      return refreshes.get(state.sessionId);
    }
    state.loading = true;
    state.error = "";
    const request = (async () => {
      try {
        const response = await getUsersWebHttpClient().request(
          vibe64SessionPath(apiPath, state.sessionId, "/source-safety"),
          {
            method: "GET"
          }
        );
        if (!response || response.ok === false) {
          throw new Error(response?.error || SOURCE_SAFETY_CHECK_ERROR);
        }
        Object.assign(state, response, {
          error: "",
          initialized: true,
          sessionId: state.sessionId
        });
      } catch (error) {
        state.error = String(error?.message || error || SOURCE_SAFETY_CHECK_ERROR);
        state.initialized = true;
      } finally {
        state.loading = false;
        refreshes.delete(state.sessionId);
      }
      return state;
    })();
    refreshes.set(state.sessionId, request);
    return request;
  }

  async function refreshAll() {
    const sessionIds = currentSessionIds();
    pruneStates(sessionIds);
    return Promise.all(sessionIds.map((sessionId) => refreshSession(sessionId)));
  }

  async function promptSession(sessionId = "") {
    const state = ensureState(sessionId);
    const apiPath = currentSessionsApiPath();
    if (!state || !apiPath || !state.unsafe || state.prompting || state.promptSent) {
      return false;
    }
    submissionSequence += 1;
    const prompt = sourceSafetyPrompt(state);
    const displayPrompt = sourceSafetyDisplayPrompt(state);
    state.promptError = "";
    state.prompting = true;
    clearPromptSentTimer(sessionId);
    try {
      const response = await getUsersWebHttpClient().request(
        vibe64SessionPath(apiPath, sessionId, "/agent-message"),
        {
          body: vibe64RealtimeOriginPayload({
            composerSubmissionId: createComposerSubmissionId({
              sequence: submissionSequence
            }),
            displayFields: {
              conversationRequest: displayPrompt
            },
            fields: {
              conversationRequest: prompt
            },
            message: prompt
          }),
          method: "POST"
        }
      );
      if (!response || response.ok === false) {
        throw new Error(response?.error || SOURCE_SAFETY_PROMPT_ERROR);
      }
      state.promptSent = true;
      promptSentTimers.set(sessionId, globalThis.setTimeout(() => {
        promptSentTimers.delete(sessionId);
        if (states[sessionId]) {
          states[sessionId].promptSent = false;
        }
      }, SOURCE_SAFETY_PROMPT_SENT_MS));
      return true;
    } catch (error) {
      state.promptError = String(error?.message || error || SOURCE_SAFETY_PROMPT_ERROR);
      return false;
    } finally {
      state.prompting = false;
    }
  }

  watch(() => [
    currentSessionsApiPath(),
    ...currentSessionIds()
  ].join("|"), () => {
    void refreshAll();
  }, {
    immediate: true
  });

  const pollInterval = Math.max(0, Number(pollIntervalMs) || 0);
  const pollTimer = pollInterval > 0
    ? globalThis.setInterval(() => void refreshAll(), pollInterval)
    : 0;

  onScopeDispose(() => {
    if (pollTimer) {
      globalThis.clearInterval(pollTimer);
    }
    for (const sessionId of promptSentTimers.keys()) {
      clearPromptSentTimer(sessionId);
    }
  });

  return {
    promptSession,
    statusForSession
  };
}

export {
  useVibe64SessionSourceSafety
};
