import { onScopeDispose, watch } from "vue";

// Moved original Colleague collector: the browser records genuine person
// effects only. The original server observer owns evidence and grading.
export function useTrainingLearnerGestures({ scope, workspace, drawer, observe, failure }) {
  const { actorKey, product, clientId } = scope;
  const { bodyVisible, xs } = drawer;
  let mounted = true;
  let polling = null;
  const nativeTickets = new Map();
  // Only Main separates teacher from drawer identity. Retain one pending
  // return question's actual body; missing reads/mode collapse never reseed it.
  let drawerReference = "", drawerOwner = null, drawerConversation = "", drawerRetired = false, drawerNotice = false;
  function sameDrawer(reference) {
    return !scope.preserveDrawer || reference?.assessmentId !== "return-to-colleague" ||
      (!drawerRetired && drawer.owner.value === drawerOwner && drawer.conversationId.value === drawerConversation);
  }
  const nativeControls = ["project-select", "session-select", "preview-select", "chat-show", "colleague-minimize", "colleague-restore"];
  function questionReference() {
    const question = product.value.trainingQuestion;
    return question ? Object.freeze(Object.fromEntries(["attemptId", "questionId", "assessmentId", "issuedRevision", "topicHash", "lessonHash"]
      .map(key => [key, question[key]]))) : null;
  }
  function nativeQuestion() {
    const question = product.value.trainingQuestion;
    if (!question || !["workspace-navigation", "return-to-colleague", "try-the-application"].includes(question.assessmentId)) return null;
    return questionReference();
  }
  function pollingTask() {
    const binding = scope.learningBinding;
    if (!mounted || (scope.current && !scope.current()) || !binding?.learningAttemptId ||
        !binding.sessionId || !product.value.conversationId) return null;
    const reference = product.value.trainingQuestion;
    return Object.freeze({ attemptId: binding.learningAttemptId,
      projectSlug: binding.noExercise === false ? binding.sourceProjectSlug : "",
      sessionId: binding.sessionId, conversationId: product.value.conversationId,
      learningClientId: clientId,
      ...(reference ? { topicHash: reference.topicHash, lessonHash: reference.lessonHash,
        reference: Object.freeze({ ...reference }) } : {}) });
  }
  function pollingCurrent(ticket) {
    const current = pollingTask();
    return Boolean(ticket.polling && polling?.watchId === ticket.polling.watchId && current &&
      current.attemptId === ticket.polling.attemptId && current.sessionId === ticket.polling.sessionId);
  }
  async function reportPolling(ticket, settled, outcome, failureCode) {
    if (!ticket.polling || !pollingCurrent(ticket)) return;
    await polling.observe({ watchId: ticket.polling.watchId, learningClientId: clientId,
      eventId: ticket.gestureId, outcome, control: ticket.control,
      ...(failureCode ? { failure: failureCode } : {}),
      workspace: {
        projectSlug: settled?.projectSlug || workspace.focus.projectSlug || "",
        sessionId: settled?.sessionId || workspace.focus.sessionId || "",
        pane: settled?.pane || workspace.focus.pane || "",
        ready: settled?.ready === true,
        learningView: workspace.focus.learningView || "workspace"
      } });
  }
  function nativeScopeCurrent(ticket) {
    return mounted && (!scope.current || scope.current()) && nativeTickets.has(ticket) && actorKey.value === ticket.actorKey &&
      product.value.conversationId === ticket.conversationId &&
      (!ticket.reference || JSON.stringify(nativeQuestion()) === JSON.stringify(ticket.reference)) &&
      (!ticket.polling || pollingCurrent(ticket)) && sameDrawer(ticket.reference);
  }
  function beginNativeGesture(event, control, target = {}) {
    const reference = nativeQuestion();
    const pollingTarget = polling && pollingTask();
    if (!mounted || (scope.current && !scope.current()) || !event?.isTrusted || event.type !== "click" || !nativeControls.includes(control) ||
        (!reference && !pollingTarget) || reference?.assessmentId === "try-the-application" || !actorKey.value || !product.value.conversationId || !workspace.settle || nativeTickets.size >= 8 ||
        (control === "colleague-minimize" && !bodyVisible.value) || (control === "colleague-restore" && bodyVisible.value)) return null;
    if (reference && reference.assessmentId !== "return-to-colleague" &&
        ["colleague-minimize", "colleague-restore"].includes(control)) return null;
    if (scope.preserveDrawer && reference?.assessmentId === "return-to-colleague") {
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
      reference, gestureId: crypto.randomUUID(), control, target: Object.freeze({ projectSlug, sessionId }),
      ...(pollingTarget ? { polling: Object.freeze({ watchId: polling.watchId,
        attemptId: pollingTarget.attemptId, sessionId: pollingTarget.sessionId }) } : {}) });
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
      let result = true;
      if (ticket.reference) {
        result = await observe( { method: "POST", body: {
          clientId, conversationId: ticket.conversationId, gestureId: ticket.gestureId, control: ticket.control,
          reference: ticket.reference, workspace: { ...settled, colleagueVisible: bodyVisible.value }
        } });
      }
      if (!nativeScopeCurrent(ticket)) return false;
      if (ticket.polling && pollingCurrent(ticket)) {
        try { await reportPolling(ticket, settled, "confirmed"); }
        catch (error) { failure(new Error(`The learning watch did not record this step. ${error.message}`)); }
      }
      return result;
    } catch (error) {
      if (nativeScopeCurrent(ticket)) {
        if (ticket.polling && pollingCurrent(ticket)) {
          try { await reportPolling(ticket, workspace.focus, "failed", "workspace-settle-failed"); }
          catch (pollingError) { failure(new Error(`The learning watch did not record this failure. ${pollingError.message}`)); }
        }
        failure(new Error(`The lesson observation was not confirmed. Repeat this step; your workspace action was not undone. ${error.message}`));
      }
      return false;
    } finally {
      nativeTickets.delete(ticket);
    }
  }
  function beginExercise(frame, currentFrame) {
    const reference = nativeQuestion();
    const pollingTarget = polling && pollingTask();
    if (!mounted || (scope.current && !scope.current()) || reference?.assessmentId !== "try-the-application" || !actorKey.value || !product.value.conversationId ||
        !workspace.settle || nativeTickets.size >= 8 || !currentFrame() ||
        frame.projectSlug !== workspace.focus.projectSlug || frame.sessionId !== workspace.focus.sessionId ||
        workspace.focus.pane !== "preview" || (xs.value && bodyVisible.value)) return null;
    const ticket = Object.freeze({ actorKey: actorKey.value, conversationId: product.value.conversationId,
      reference, gestureId: crypto.randomUUID(), control: "exercise-response", currentFrame,
      target: Object.freeze({ projectSlug: frame.projectSlug, sessionId: frame.sessionId }),
      exercise: Object.freeze({ instanceId: frame.instanceId, interactionId: frame.interactionId,
        playerInstanceId: frame.playerInstanceId, frameRequestId: frame.frameRequestId }),
      ...(pollingTarget ? { polling: Object.freeze({ watchId: polling.watchId,
        attemptId: pollingTarget.attemptId, sessionId: pollingTarget.sessionId }) } : {}) });
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
      if (ticket.polling && pollingCurrent(ticket)) {
        try { await reportPolling(ticket, settled, "confirmed"); }
        catch (error) { failure(new Error(`The learning watch did not record this step. ${error.message}`)); }
      }
      return exerciseCurrent(ticket) ? result : false;
    } catch (error) {
      if (exerciseCurrent(ticket)) {
        if (ticket.polling && pollingCurrent(ticket)) {
          try { await reportPolling(ticket, workspace.focus, "failed", "exercise-observation-failed"); }
          catch (pollingError) { failure(new Error(`The learning watch did not record this failure. ${pollingError.message}`)); }
        }
        failure(new Error(`The application observation was not confirmed. Press Ask the server again when Preview is ready. ${error.message}`));
      }
      return false;
    } finally {
      nativeTickets.delete(ticket);
    }
  }
  // The lesson Code tab's "Check my code" press. Code questions are declared by
  // content, so the server decides whether the delivered question is one and
  // runs its check; the browser only reports this person's genuine press.
  async function submitCode(event) {
    const reference = questionReference();
    if (!event?.isTrusted || event.type !== "click") throw new Error("Press Check my code yourself to submit your code.");
    if (!mounted || (scope.current && !scope.current()) || !actorKey.value || !product.value.conversationId) {
      throw new Error("This lesson's Learning conversation is not open here. Open it, then press Check my code again.");
    }
    if (!workspace.settle) throw new Error("This lesson has no practice project to check.");
    if (nativeTickets.size >= 8) throw new Error("Earlier presses are still being handled. Wait a moment, then press Check my code again.");
    // The question is saved server state; after a restart or reload it is
    // absent here only until the lesson conversation has re-read it.
    if (!reference && product.value.loaded === false) {
      throw new Error("This lesson's Learning conversation is still loading its saved question. Wait until its messages show, then press Check my code again.");
    }
    if (!reference) throw new Error("There is no open lesson question yet. Ask your teacher for a code question, then press Check my code.");
    const ticket = Object.freeze({ actorKey: actorKey.value, conversationId: product.value.conversationId,
      reference, gestureId: crypto.randomUUID(), control: "code-submit",
      target: Object.freeze({ projectSlug: workspace.focus.projectSlug, sessionId: workspace.focus.sessionId }) });
    nativeTickets.set(ticket, true);
    const current = () => mounted && (!scope.current || scope.current()) && nativeTickets.has(ticket) &&
      actorKey.value === ticket.actorKey && product.value.conversationId === ticket.conversationId &&
      JSON.stringify(questionReference()) === JSON.stringify(reference);
    try {
      const settled = await workspace.settle({ control: ticket.control, ...ticket.target }, current);
      if (!current()) throw new Error("The lesson question changed. Press Check my code again.");
      return await observe({ method: "POST", body: {
        clientId, conversationId: ticket.conversationId, gestureId: ticket.gestureId, control: ticket.control,
        reference, workspace: { ...settled, colleagueVisible: bodyVisible.value }
      } });
    } finally {
      nativeTickets.delete(ticket);
    }
  }
  // A failed in-app request from the visible bound Preview while a watch is
  // active. Hint-only context: a path outside the lesson's declared routes is
  // reduced to "other" here, before it leaves the browser.
  async function reportAppRequest(frame, request) {
    const watched = polling;
    const task = watched && pollingTask();
    const visible = () => mounted && (!scope.current || scope.current()) && polling === watched && Boolean(pollingTask()) &&
      workspace.focus.pane === "preview" && workspace.focus.projectSlug === frame.projectSlug &&
      workspace.focus.sessionId === frame.sessionId && !(xs.value && bodyVisible.value);
    if (!task?.projectSlug || frame.projectSlug !== task.projectSlug || frame.sessionId !== task.sessionId ||
        !actorKey.value || !workspace.settle || !visible()) return false;
    const path = (watched.appRoutes || []).some(route => route.method === request.method &&
      route.path === request.pathTemplate) ? request.pathTemplate : "other";
    try {
      const settled = await workspace.settle({ control: "app-request", projectSlug: frame.projectSlug, sessionId: frame.sessionId }, visible);
      if (!visible()) return false;
      await watched.observe({ watchId: watched.watchId, learningClientId: clientId, eventId: crypto.randomUUID(),
        outcome: "failed", control: "app-request", failure: request.failure,
        request: { method: request.method, path, status: request.status },
        workspace: { projectSlug: settled.projectSlug, sessionId: settled.sessionId, pane: settled.pane,
          ready: settled.ready === true, learningView: workspace.focus.learningView || "workspace" } });
      return true;
    } catch (error) {
      if (visible()) failure(new Error(`The learning watch did not record this app step. ${error.message}`));
      return false;
    }
  }
  const nativeGestureOwner = { begin: beginNativeGesture, finish: finishNativeGesture, beginExercise, finishExercise, submitCode,
    pollingTask, reportAppRequest,
    setPollingWatch(value) { polling = value?.watchId && typeof value.observe === "function" ? value : null; },
    clearPollingWatch(watchId) { if (!watchId || polling?.watchId === watchId) polling = null; },
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
  // Main builds this owner inside its retained conversation scope, which can
  // outlive the component whose setup first created it; the owner ends with
  // its own scope, not with whichever component happened to be mounting.
  onScopeDispose(() => { nativeTickets.clear(); mounted = false; });
  return nativeGestureOwner;
}
