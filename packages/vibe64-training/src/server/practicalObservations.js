import { randomUUID } from "node:crypto";
import { isDeepStrictEqual } from "node:util";
import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";

// The original transaction and bounded context projection moved from Colleague.
// The consumer retains its admission tail, connection and actual lifetime fence;
// its existing authorization owner rechecks current access after awaited reads.
function createTrainingPracticalObservations({ actions, failure }) {
  function requireResult(result) {
    if (result?.ok === false) throw failure(result.error || "The assistant operation failed.", result.code);
    return result;
  }
  async function observe(input, { connection, context, requireCurrent, authorizeCurrent, targetInput }) {
    if ((input.control === "exercise-response") !== Boolean(input.exercise)) {
      throw failure("Only an exercise-response gesture carries the exact exercise identities.", "ACTION_VALIDATION_FAILED", 400);
    }
    requireCurrent();
    await authorizeCurrent();
    if (typeof context.trainingPractical?.capturePractical !== "function") {
      throw failure("Native lesson observations are unavailable in this host.");
    }
    const actor = authenticatedVibe64User(context);
    const captured = await context.trainingPractical.capturePractical({ actor, reference: input.reference });
    if (!input.workspace.ready || !isDeepStrictEqual(captured.target,
        { projectSlug: input.workspace.projectSlug, sessionId: input.workspace.sessionId })) {
      throw failure("Use the ready exercise project and session reserved for this exact lesson.");
    }
    requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: targetInput || captured.target, context }));
    // Access may await a host read. Recheck the issued question before
    // accepting a step; an old gesture cannot enter a replacement question.
    const requireCurrentQuestion = async () => {
      const current = await context.trainingPractical.capturePractical({ actor, reference: input.reference });
      if (!isDeepStrictEqual(current.target, captured.target) || !isDeepStrictEqual(current.assessment, captured.assessment) ||
          !isDeepStrictEqual(current.snapshot.question, captured.snapshot.question)) {
        throw failure("The practical question changed. Repeat its steps.");
      }
      await authorizeCurrent();
      requireCurrent();
    };
    await requireCurrentQuestion();
    let practical = connection.trainingPractical;
    if (!practical || !isDeepStrictEqual(practical.reference, input.reference)) {
      practical = { reference: structuredClone(input.reference), steps: [], observation: null };
    }
    const previous = practical.steps.find(step => step.gestureId === input.gestureId);
    if (previous) {
      if (!isDeepStrictEqual(previous.payload, input)) throw failure("This gesture identity already retained another observation.");
      return structuredClone(previous.response);
    }
    if (practical.observation) throw failure("This practical task already has its observation. Retry the original gesture receipt.");
    const { assessment, snapshot: question } = captured;
    const index = practical.steps.length;
    const workspaceControl = ["project-select", "session-select", "preview-select", "chat-show"].includes(input.control);
    let valid = false;
    if (assessment.id === "workspace-navigation") {
      valid = (index === 1 ? ["session-select", "chat-show"].includes(input.control)
        : input.control === ["project-select", "session-select", "preview-select"][index]) &&
        (index !== 1 || input.workspace.mainChatVisible) &&
        (index !== 2 || input.workspace.projectVisible && input.workspace.pane === "preview");
    } else if (assessment.id === "return-to-colleague") {
      if (index === 0) {
        valid = input.control === "colleague-minimize" && input.workspace.colleagueVisible === false;
      } else if (index === 1) {
        const visible = input.control === "session-select" || input.control === "chat-show"
          ? input.workspace.mainChatVisible
          : input.workspace.projectVisible && (input.control !== "preview-select" || input.workspace.pane === "preview");
        valid = workspaceControl && input.workspace.colleagueVisible === false && visible;
      } else {
        valid = input.control === "colleague-restore" && input.workspace.colleagueVisible === true;
      }
    } else if (assessment.id === "try-the-application") {
      valid = index === 0 && input.control === "exercise-response" && input.workspace.projectVisible && input.workspace.pane === "preview";
    }
    if (!valid) throw failure("Repeat this question's practical steps in their original order and visible workspace.");
    const completed = index === 2 || assessment.id === "try-the-application";
    const response = { ok: true, gestureId: input.gestureId, assessmentId: assessment.id,
      phase: completed ? "completed" : "collecting", acceptedSteps: index + 1 };
    if (completed) {
      const observationId = randomUUID();
      if (assessment.id === "try-the-application") {
        if (typeof context.trainingChecks?.runOrientationCheck !== "function") {
          throw failure("The installed exercise response check is unavailable in this host.");
        }
        const outputs = requireResult(await actions.execute({ actionId: "vibe64.terminals.outputs.read",
          input: targetInput || captured.target, context }));
        const terminalId = outputs?.activeTerminal?.id;
        if (!terminalId) throw failure("Use the exact ready App run for this exercise before repeating the interaction.");
        const checked = await context.trainingChecks.runOrientationCheck({ actor, signal: context.signal,
          attemptId: question.attemptId, sessionId: captured.target.sessionId, terminalId, observationId,
          instanceId: input.exercise.instanceId, interactionId: input.exercise.interactionId, requestId: input.exercise.requestId });
        if (checked?.checkResult?.check !== assessment.evidence.check || checked.checkResult.observationId !== observationId ||
            !["passed", "not-yet-passed"].includes(checked.checkResult.outcome)) {
          throw failure("The declared check did not confirm this exact native observation.");
        }
        await requireCurrentQuestion();
        practical.checkResult = structuredClone(checked.checkResult);
      }
      practical.observation = { kind: "observation", observationId, observedAt: new Date().toISOString(),
        learnerId: question.learnerId, attemptId: question.attemptId, questionId: question.question.id,
        ...captured.target, producer: assessment.evidence.producer, operation: assessment.evidence.operation,
        operationId: input.gestureId, assistance: question.question.assistance,
        origin: ["demonstration", "substantial"].includes(question.question.assistance) ? "teacher" : "learner",
        text: assessment.id === "try-the-application" ? "Pressed the App's native button and displayed its identified server response in visible Preview." :
          assessment.id === "workspace-navigation" ? "Selected the reserved exercise project, its Main session and its visible Preview using native controls." :
          "Minimized Colleague, used a native workspace control in the same exercise and restored the same Colleague conversation." };
      response.observationId = observationId;
    }
    practical.steps.push({ gestureId: input.gestureId, payload: structuredClone(input), response });
    connection.trainingPractical = practical;
    return structuredClone(response);
  }
  async function read({ connection, context, authorizationContext = context, requireCurrent, targetInput }) {
    const result = {};
    const practical = connection?.trainingPractical;
    if (!practical?.steps.length) return result;
    try { requireCurrent(); } catch { return result; }
    const facts = structuredClone({ reference: practical.reference, steps: practical.steps,
      observation: practical.observation, checkResult: practical.checkResult });
    try {
      const captured = await context.trainingPractical?.capturePractical({ actor: authenticatedVibe64User(context), reference: facts.reference });
      const lastWorkspace = facts.steps.at(-1).payload.workspace;
      if (!captured || captured.assessment.id !== facts.reference.assessmentId ||
          !isDeepStrictEqual(captured.target, { projectSlug: lastWorkspace.projectSlug, sessionId: lastWorkspace.sessionId }) ||
          (facts.observation && (captured.assessment.id !== facts.observation.operation ||
          captured.assessment.evidence.producer !== facts.observation.producer ||
          !isDeepStrictEqual(captured.target, { projectSlug: facts.observation.projectSlug, sessionId: facts.observation.sessionId }) ||
          captured.snapshot.question.assistance !== facts.observation.assistance))) return result;
      requireResult(await actions.execute({ actionId: "vibe64.sessions.inspect", input: targetInput || captured.target, context: authorizationContext }));
      requireCurrent();
      if (connection.trainingPractical !== practical ||
          !isDeepStrictEqual({ reference: practical.reference, steps: practical.steps, observation: practical.observation, checkResult: practical.checkResult }, facts)) return result;
      if (!facts.observation) {
        result.trainingPracticalProgress = { reference: facts.reference, assessmentId: captured.assessment.id,
          phase: "collecting", acceptedSteps: facts.steps.length, lastControl: facts.steps.at(-1).payload.control };
        return result;
      }
      const observation = facts.observation;
      result.trainingPractical = { reference: facts.reference, observationId: observation.observationId,
        assessmentId: captured.assessment.id, producer: observation.producer, operation: observation.operation,
        observedAt: observation.observedAt, assistance: observation.origin === "teacher" ? "demonstration" : observation.assistance,
        origin: observation.origin,
        ...(facts.checkResult ? { checkOutcome: facts.checkResult.outcome } : {}) };
    } catch { /* Unavailable or unauthorized practical facts never change ordinary chat context. */ }
    return result;
  }
  return Object.freeze({ observe, read });
}

export { createTrainingPracticalObservations };
