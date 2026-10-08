import { nextTick, onScopeDispose, ref, watch } from "vue";

// Original Online settling observation. It never opens or changes a view.
export function useTrainingWorkspaceObservation({ actor, layout: layoutRef, view: viewRef, focus, selection }) {
  // Observe settled native selections without opening or changing any view.
  const gestureHostActive = ref(true);
  onScopeDispose(() => { gestureHostActive.value = false; });
  async function settleWorkspace(target, isCurrent) {
    const expectedActor = actor.value;
    const current = () => gestureHostActive.value && Boolean(expectedActor) && actor.value === expectedActor && isCurrent();
    const matches = () => {
      const layout = layoutRef.value;
      const view = viewRef.value;
      const binding = view?.learningBinding;
      const sourceMatches = binding ? binding.noExercise === false && binding.viewerActorKey === actor.value &&
        binding.sourceProjectSlug === target.projectSlug && binding.sessionId === view.sessionId &&
        layout?.learningAttemptId === binding.learningAttemptId && layout?.learnerId === binding.learnerId
        : selection.projectSlug.value === target.projectSlug;
      if (!layout?.ready || layout.projectSlug !== target.projectSlug || !sourceMatches ||
          !view?.ready || selection.restoring.value || !view.sessionId ||
          (target.sessionId && view.sessionId !== target.sessionId) ||
          !(layout.chatVisible || layout.projectVisible)) return false;
      if (["session-select", "chat-show"].includes(target.control)) {
        return layout.chatVisible && !view.hostConversationSelected && !view.temporarySelected && !view.conversationId;
      }
      return target.control !== "preview-select" || (layout.projectVisible && focus.value.pane === "preview");
    };
    await nextTick();
    if (!current()) throw new Error("The lesson or signed-in person changed before the workspace observation.");
    if (!matches()) await new Promise((resolve, reject) => {
      const timer = setTimeout(() => finish(new Error("The selected exercise session or view did not become ready. Repeat the lesson step when it is available.")), 12000);
      const stop = watch([current, matches, selection.error], ([valid, ready, error]) => {
        if (!valid) finish(new Error("The lesson or signed-in person changed before the workspace observation."));
        else if (error) finish(new Error(error));
        else if (ready) finish();
      });
      function finish(error) {
        clearTimeout(timer);
        stop();
        if (error) reject(error);
        else resolve();
      }
    });
    if (!current() || !matches()) throw new Error("The exercise selection changed before the workspace observation.");
    const layout = layoutRef.value;
    const view = viewRef.value;
    return {
      projectSlug: target.projectSlug, sessionId: view.sessionId,
      mainChatVisible: Boolean(layout.chatVisible && !view.hostConversationSelected && !view.temporarySelected && !view.conversationId),
      projectVisible: Boolean(layout.projectVisible), pane: focus.value.pane, ready: true
    };
  }
  return settleWorkspace;
}
