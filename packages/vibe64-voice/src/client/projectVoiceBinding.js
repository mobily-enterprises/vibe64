/** Project history is authoritative; only user and assistant output is spoken. */
export function projectVoiceState(runtime) {
  const messages = [];
  let streamingReply = null;
  for (const turn of runtime.conversationLog.turns || []) {
    if (turn.user) messages.push({ ...turn.user, role: "user", id: turn.user.messageId || `${turn.turnId}:user` });
    if (turn.assistant?.text) {
      const reply = { ...turn.assistant, role: "assistant", id: `${turn.turnId}:assistant` };
      if (turn.pending || ["starting", "inProgress"].includes(reply.status)) streamingReply = reply;
      else messages.push(reply);
    }
  }
  return { messages, streamingReply, status: runtime.mounted.session.value?.agentSession?.turn?.active ? "working" : "ready" };
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
