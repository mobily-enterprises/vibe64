import { onBeforeUnmount, watch } from "vue";

// Moved original Colleague collector: the browser records genuine person
// effects only. The original server observer owns evidence and grading.
export function useTrainingLearnerGestures({ scope, workspace, drawer, observe, failure }) {
  const { actorKey, product, clientId } = scope;
  const { bodyVisible, xs } = drawer;
  let mounted = true;
  const nativeTickets = new Map();
  // Only Main separates teacher from drawer identity. Retain one pending
  // return question's actual body; missing reads/mode collapse never reseed it.
  let drawerReference = "", drawerOwner = null, drawerConversation = "", drawerRetired = false, drawerNotice = false;
  function sameDrawer(reference) {
    return !scope.preserveDrawer || reference?.assessmentId !== "return-to-colleague" ||
      (!drawerRetired && drawer.owner.value === drawerOwner && drawer.conversationId.value === drawerConversation);
  }
  const nativeControls = ["project-select", "session-select", "preview-select", "chat-show", "colleague-minimize", "colleague-restore"];
  function nativeQuestion() {
    const question = product.value.trainingQuestion;
    if (!question || !["workspace-navigation", "return-to-colleague", "try-the-application"].includes(question.assessmentId)) return null;
    return Object.freeze(Object.fromEntries(["attemptId", "questionId", "assessmentId", "issuedRevision", "topicHash", "lessonHash"]
      .map(key => [key, question[key]])));
  }
  function nativeScopeCurrent(ticket) {
    return mounted && (!scope.current || scope.current()) && nativeTickets.has(ticket) && actorKey.value === ticket.actorKey &&
      product.value.conversationId === ticket.conversationId && JSON.stringify(nativeQuestion()) === JSON.stringify(ticket.reference) && sameDrawer(ticket.reference);
  }
  function beginNativeGesture(event, control, target = {}) {
    const reference = nativeQuestion();
    if (!mounted || (scope.current && !scope.current()) || !event?.isTrusted || event.type !== "click" || !nativeControls.includes(control) ||
        !reference || reference.assessmentId === "try-the-application" || !actorKey.value || !product.value.conversationId || !workspace.settle || nativeTickets.size >= 8 ||
        (control === "colleague-minimize" && !bodyVisible.value) || (control === "colleague-restore" && bodyVisible.value)) return null;
    if (reference.assessmentId !== "return-to-colleague" &&
        ["colleague-minimize", "colleague-restore"].includes(control)) return null;
    if (scope.preserveDrawer && reference.assessmentId === "return-to-colleague") {
      if (!drawer.owner.value || !drawer.conversationId.value) return null;
      const signature = JSON.stringify(reference);
      if (!drawerReference) {
        drawerReference = signature; drawerOwner = drawer.owner.value; drawerConversation = drawer.conversationId.value;
      }
      if (!sameDrawer(reference)) {
        if (!drawerNotice) { drawerNotice = true; failure(new Error("Colleague changed during this practical question. Ask Main to repeat the question before trying these steps again.")); }
        return null;
      }
    }
    const projectSlug = target.projectSlug || workspace.focus.projectSlug;
    const sessionId = target.sessionId || (!target.projectSlug || target.projectSlug === workspace.focus.projectSlug ? workspace.focus.sessionId : "");
    const ticket = Object.freeze({ actorKey: actorKey.value, conversationId: product.value.conversationId,
      reference, gestureId: crypto.randomUUID(), control, target: Object.freeze({ projectSlug, sessionId }) });
    nativeTickets.set(ticket, true);
    return ticket;
  }
  async function finishNativeGesture(ticket) {
    if (!nativeScopeCurrent(ticket)) return false;
    try {
      const settled = await workspace.settle({ control: ticket.control, ...ticket.target }, () => nativeScopeCurrent(ticket));
      if (!nativeScopeCurrent(ticket)) return false;
      if (ticket.control === "colleague-minimize" && bodyVisible.value) return false;
      if (ticket.control === "colleague-restore" && !bodyVisible.value) return false;
      const result = await observe( { method: "POST", body: {
        clientId, conversationId: ticket.conversationId, gestureId: ticket.gestureId, control: ticket.control,
        reference: ticket.reference, workspace: { ...settled, colleagueVisible: bodyVisible.value }
      } });
      if (!nativeScopeCurrent(ticket)) return false;
      return result;
    } catch (error) {
      if (nativeScopeCurrent(ticket)) {
        failure(new Error(`The lesson observation was not confirmed. Repeat this step; your workspace action was not undone. ${error.message}`));
      }
      return false;
    } finally {
      nativeTickets.delete(ticket);
    }
  }
  function beginExercise(frame, currentFrame) {
    const reference = nativeQuestion();
    if (!mounted || (scope.current && !scope.current()) || reference?.assessmentId !== "try-the-application" || !actorKey.value || !product.value.conversationId ||
        !workspace.settle || nativeTickets.size >= 8 || !currentFrame() ||
        frame.projectSlug !== workspace.focus.projectSlug || frame.sessionId !== workspace.focus.sessionId ||
        workspace.focus.pane !== "preview" || (xs.value && bodyVisible.value)) return null;
    const ticket = Object.freeze({ actorKey: actorKey.value, conversationId: product.value.conversationId,
      reference, gestureId: crypto.randomUUID(), control: "exercise-response", currentFrame,
      target: Object.freeze({ projectSlug: frame.projectSlug, sessionId: frame.sessionId }),
      exercise: Object.freeze({ instanceId: frame.instanceId, interactionId: frame.interactionId,
        playerInstanceId: frame.playerInstanceId, frameRequestId: frame.frameRequestId }) });
    nativeTickets.set(ticket, true);
    return ticket;
  }
  function exerciseCurrent(ticket) {
    return nativeScopeCurrent(ticket) && ticket.currentFrame() && workspace.focus.pane === "preview" &&
      workspace.focus.projectSlug === ticket.target.projectSlug && workspace.focus.sessionId === ticket.target.sessionId &&
      !(xs.value && bodyVisible.value);
  }
  async function finishExercise(ticket, response = null) {
    try {
      // An omitted response retires an unfinished interaction without sending an observation.
      if (!response || !exerciseCurrent(ticket)) return false;
      const settled = await workspace.settle({ control: ticket.control, ...ticket.target }, () => exerciseCurrent(ticket));
      if (!exerciseCurrent(ticket)) return false;
      const result = await observe( { method: "POST", body: {
        clientId, conversationId: ticket.conversationId, gestureId: ticket.gestureId, control: ticket.control,
        reference: ticket.reference, workspace: { ...settled, colleagueVisible: bodyVisible.value },
        exercise: { ...ticket.exercise, requestId: response.requestId }
      } });
      return exerciseCurrent(ticket) ? result : false;
    } catch (error) {
      if (exerciseCurrent(ticket)) {
        failure(new Error(`The application observation was not confirmed. Press Ask the server again when Preview is ready. ${error.message}`));
      }
      return false;
    } finally {
      nativeTickets.delete(ticket);
    }
  }
  const nativeGestureOwner = { begin: beginNativeGesture, finish: finishNativeGesture, beginExercise, finishExercise,
    discard(ticket) { nativeTickets.delete(ticket); }, clear() { nativeTickets.clear(); },
    matchesLearning(binding) {
      return Boolean(scope.learningBinding && binding && mounted && scope.current?.() &&
        ["actorKey", "viewerActorKey", "learnerId", "learningAttemptId", "sessionId", "sourceProjectSlug", "noExercise"]
          .every(key => binding[key] === scope.learningBinding[key]));
    } };
  watch(() => [actorKey.value, product.value.conversationId, JSON.stringify(nativeQuestion())], () => nativeTickets.clear(), { flush: "sync" });
  watch(() => [workspace.focus.projectSlug, workspace.focus.sessionId, workspace.focus.pane, xs.value, bodyVisible.value], () => {
    for (const ticket of nativeTickets.keys()) {
      if (ticket.control === "exercise-response" && !exerciseCurrent(ticket)) nativeTickets.delete(ticket);
    }
  }, { flush: "sync" });
  if (scope.preserveDrawer) {
    watch(() => [drawer.owner.value, drawer.conversationId.value], () => {
      if (drawerReference && (drawer.owner.value !== drawerOwner || drawer.conversationId.value !== drawerConversation)) {
        drawerRetired = true;
        nativeTickets.clear();
      }
    }, { flush: "sync" });
    watch(() => nativeQuestion(), reference => {
      if (reference && drawerReference && JSON.stringify(reference) !== drawerReference) {
        drawerReference = ""; drawerOwner = null; drawerConversation = ""; drawerRetired = false; drawerNotice = false;
      }
    }, { flush: "sync" });
  }
  onBeforeUnmount(() => { nativeTickets.clear(); mounted = false; });
  return nativeGestureOwner;
}
