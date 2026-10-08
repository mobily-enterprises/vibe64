import { projectConversationVoiceState } from "@jskit-ai/assistant-voice/client";
import { mainConversationId } from "@local/vibe64-sessions/shared/conversation";

export function projectVoiceState(runtime) {
  return projectConversationVoiceState({
    turns: runtime.conversationLog.turns || [],
    status: runtime.mounted.session.value?.agentSession?.turn?.active ? "working" : "ready"
  });
}

export function createProjectVoiceBinding(runtime, view = {}) {
  const identity = runtime.identity;
  const learning = identity.learningAttemptId !== undefined;
  if (learning && (identity.projectSlug || !identity.actorKey || !identity.learnerId ||
      identity.sessionsApiPath !== `/api/learning/${identity.learningAttemptId}/vibe64/sessions`)) {
    throw new TypeError("Use the exact saved learner and Learning conversation voice scope.");
  }
  let retained;
  return {
    preferenceTarget: "coding",
    defaults: { readAloud: true },
    id: learning
      ? JSON.stringify(["learning", identity.actorKey, identity.learnerId, identity.learningAttemptId, identity.sessionId])
      : JSON.stringify(["project", identity.actorKey, identity.projectSlug, identity.sessionId]),
    conversationId: mainConversationId(identity),
    socketUrl: learning
      ? `${identity.sessionsApiPath}/${encodeURIComponent(identity.sessionId)}/voice/ws`
      : `/api/app/${encodeURIComponent(identity.projectSlug)}/vibe64/sessions/${encodeURIComponent(identity.sessionId)}/voice/ws`,
    get label() { return `${learning ? "Lesson" : identity.projectSlug} · ${runtime.mounted.session.value?.sessionName || identity.sessionId}`; },
    get state() { return projectVoiceState(runtime); },
    get available() { return runtime.available.value; },
    get narration() {
      return {
        turns: runtime.conversationLog.turns || [],
        loading: runtime.conversationLog.loading === true,
        working: runtime.mounted.session.value?.agentSession?.turn?.active === true,
        eligible: runtime.available.value && runtime.access.canUseChat.value && view.eligible === true,
        vocalizeThinking: false,
        vocalizeInterimTurns: false,
        thinkingSounds: true
      };
    },
    get adapter() { return view.adapter || null; },
    get presentation() { return view.presentation || "dialog"; },
    get onTranscript() { return view.onTranscript; },
    captureContext: () => ({ ...identity }),
    retain() { retained = runtime.retain(); runtime = retained.runtime; },
    release() { retained?.release(); retained = null; },
    submitText(text, { messageId, context } = {}) {
      if (context?.actorKey !== identity.actorKey || context?.sessionId !== identity.sessionId || context?.projectSlug !== identity.projectSlug ||
          learning && (context?.learnerId !== identity.learnerId || context?.learningAttemptId !== identity.learningAttemptId ||
            context?.sessionsApiPath !== identity.sessionsApiPath)) {
        throw new Error("This recording belongs to another conversation.");
      }
      return runtime.send({ message: text, agentSettings: runtime.agentSettings.requestSettings.value }, { messageId });
    },
    cancelWork: () => runtime.interrupt()
  };
}
