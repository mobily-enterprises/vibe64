import { projectConversationVoiceState } from "@jskit-ai/assistant-voice/client";

export function projectVoiceState(runtime) {
  return projectConversationVoiceState({
    turns: runtime.conversationLog.turns || [],
    status: runtime.mounted.session.value?.agentSession?.turn?.active ? "working" : "ready"
  });
}

export function createProjectVoiceBinding(runtime) {
  const identity = runtime.identity;
  let retained;
  return {
    id: JSON.stringify(["project", identity.actorKey, identity.projectSlug, identity.sessionId]),
    socketUrl: `/api/app/${encodeURIComponent(identity.projectSlug)}/vibe64/sessions/${encodeURIComponent(identity.sessionId)}/voice/ws`,
    get label() { return `${identity.projectSlug} · ${runtime.mounted.session.value?.sessionName || identity.sessionId}`; },
    get state() { return projectVoiceState(runtime); },
    get available() { return runtime.available.value; },
    captureContext: () => ({ ...identity }),
    retain() { retained = runtime.retain(); runtime = retained.runtime; },
    release() { retained?.release(); retained = null; },
    submitText(text, { messageId, context } = {}) {
      if (context?.actorKey !== identity.actorKey || context?.sessionId !== identity.sessionId || context?.projectSlug !== identity.projectSlug) {
        throw new Error("This recording belongs to another conversation.");
      }
      return runtime.send({ message: text, agentSettings: runtime.agentSettings.requestSettings.value }, { messageId });
    },
    cancelWork: () => runtime.interrupt()
  };
}
