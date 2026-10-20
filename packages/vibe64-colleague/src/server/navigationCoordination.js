import { isDeepStrictEqual } from "node:util";

function publicCue(cue) {
  const { generation, name, parameters, operation, projectSlug, sessionId, ...value } = cue;
  return value;
}
function learningFocusMatches(command, focus) {
  if (command.learningMode === undefined) return true;
  if (focus?.learningMode !== command.learningMode) return false;
  if (command.learningMode === false) return !focus.learningView && !focus.learningContent && !focus.learningAttemptId;
  if (focus.learningView !== command.learningView ||
      command.learningContent && focus.learningContent !== command.learningContent ||
      command.learningAttemptId && focus.learningAttemptId !== command.learningAttemptId) return false;
  if (command.projectSlug && command.learningContent !== "picker" && focus.projectSlug !== command.projectSlug ||
      command.sessionId && focus.sessionId !== command.sessionId) return false;
  const pane = command.presentation ? command.pane || "preview"
    : command.learningView === "learning" ? "lessons" : command.pane || "preview";
  if (focus.pane !== pane) return false;
  return !command.databaseView || focus.databaseScreen === "workspace" && focus.databaseView === command.databaseView;
}
// The Learning environment (L) sits above the app. A command that opens or
// minimises it is confirmed only by the browser's reported L state; an
// attempt/step selection must be the one actually shown.
function learningPanelMatches(command, focus) {
  const learning = command.learning;
  if (!learning) return true;
  if ((focus?.learningOpen === true) !== learning.open) return false;
  if (!learning.open || !learning.attemptId) return true;
  return focus.learningSurface === "lesson" && focus.learningAttemptId === learning.attemptId &&
    (!learning.stepId || focus.learningStepId === learning.stepId);
}
// A guided "show me" names its own place; its pane and database view must be
// the ones the browser settled on, as Learning-mode guides always required.
function guidedPlaceMatches(command, focus) {
  if (!command.guide?.navigate || command.learningMode !== undefined || !command.pane) return true;
  return focus?.pane === command.pane &&
    (!command.databaseView || focus.databaseScreen === "workspace" && focus.databaseView === command.databaseView);
}
// Moved from vibe64-training's presentationCoordination.js (Learning v2, C4):
// Colleague owns navigation begin/ack/timeout and guide receipts. The cue and
// presentation parts stay until the teacher model is removed (phase 2).
// Consumers retain maps, admission, native turn authority, focus grammar and
// every lifecycle call site.
function createColleagueNavigationCoordination({ changed }) {
  function begin(connection, command, identity) {
    connection.navigation = command;
    changed();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        command.status = "failed";
        connection.acknowledge = null;
        changed();
        resolve({ ok: false, error: "The browser did not acknowledge navigation. Keep the initiating conversation open and check its current status before trying again." });
      }, command.presentation ? 45000 : 15000);
      connection.acknowledge = (result) => {
        clearTimeout(timer);
        command.status = result.ok ? "completed" : "failed";
        connection.acknowledge = null;
        if (result.focus) connection.focus = result.focus;
        if (result.ok && command.presentation?.operation === "cue") {
          connection.cue = { ...command.presentation, projectSlug: command.projectSlug, sessionId: command.sessionId,
            generation: identity.generation, playerInstanceId: result.presentation.playerInstanceId,
            outputId: "", canonicalFinal: false, phase: "armed" };
        }
        changed();
        resolve(result);
      };
    });
  }
  function acknowledge(connection, input, identity) {
    if (input.cue) {
      const expected = connection?.cue;
      const result = input.cue;
      if (!expected || expected.conversationId !== identity.conversationId || input.commandId !== expected.navigationId ||
          !["completed", "interrupted", "failed"].includes(result.phase) ||
          ["cueId", "commandId", "navigationId", "clientId", "conversationId", "turnId", "attemptId", "visualId", "playerInstanceId", "outputId"]
            .some(key => result[key] !== expected[key]) || result.canonicalFinal !== expected.canonicalFinal ||
          JSON.stringify(result).length > 8192 ||
          result.phase === "completed" && (!expected.canonicalFinal || result.visualPhase !== "completed" ||
            !["completed", "off"].includes(result.audioPhase)) ||
          ["interrupted", "failed"].includes(expected.phase) && result.phase === "completed") {
        return { ok: false, error: "This cue receipt does not match the initiating browser's actual selected explanation." };
      }
      if (expected.receipt && ["completed", "interrupted", "failed"].includes(expected.phase)) {
        return { ok: isDeepStrictEqual(expected.receipt, result) };
      }
      expected.phase = result.phase;
      expected.receipt = structuredClone(result);
      changed();
      return { ok: true };
    }
    if (!connection || connection.navigation?.id !== input.commandId || !connection.acknowledge) {
      return { ok: false, error: "This navigation command is no longer pending." };
    }
    const expected = connection.navigation.presentation;
    if (input.ok && !learningFocusMatches(connection.navigation, input.focus)) {
      return { ok: false, error: "The browser has not confirmed this exact Learning mode, view and lesson selection." };
    }
    if (input.ok && !learningPanelMatches(connection.navigation, input.focus)) {
      return { ok: false, error: "The browser has not confirmed this exact Learning state, lesson and step." };
    }
    if (input.ok && !guidedPlaceMatches(connection.navigation, input.focus)) {
      return { ok: false, error: "The browser has not confirmed the guided place it opened." };
    }
    // A guide receipt reports only what the overlay actually drew.
    const guide = connection.navigation.guide;
    const guideReceipt = guide && input.guide ? { shown: input.guide.shown === true,
      ...(input.guide.reason ? { reason: input.guide.reason } : {}), ...(input.guide.step ? { step: input.guide.step } : {}) } : null;
    if (input.ok && guide && (typeof input.guide?.shown !== "boolean" || guideReceipt.shown && (!guide.highlight || !guideReceipt.step) ||
        !guideReceipt.shown && !guideReceipt.reason)) {
      return { ok: false, error: "The browser has not confirmed whether this guide highlight was drawn." };
    }
    if (input.ok && expected) {
      const result = input.presentation;
      if (!result || result.attemptId !== expected.attemptId || result.visualId !== expected.visualId || !result.playerInstanceId ||
          (expected.operation === "open" && result.phase !== "ready") ||
          (expected.operation === "command" && (result.phase !== "completed" || result.commandId !== expected.commandId)) ||
          (expected.operation === "cue" && (result.phase !== "armed" ||
            ["cueId", "commandId", "navigationId", "conversationId", "turnId", "clientId"].some(key => result[key] !== expected[key]))) ||
          (expected.operation === "snapshot" && !result.snapshot) || JSON.stringify(result).length > 8192 ||
          input.focus?.projectSlug !== connection.navigation.projectSlug || input.focus?.sessionId !== connection.navigation.sessionId ||
          input.focus?.pane !== (connection.navigation.pane || "preview")) {
        return { ok: false, error: "The browser has not confirmed this exact lesson presentation operation." };
      }
    }
    connection.acknowledge({ ok: input.ok, ...(input.error ? { error: input.error } : {}), ...(input.focus ? { focus: input.focus } : {}),
      ...(expected && input.presentation ? { presentation: input.presentation } : {}), ...(guideReceipt ? { guide: guideReceipt } : {}) });
    return { ok: true };
  }
  function admitCue(connection, input, identity) {
    if (!identity.interactive) {
      return { ok: false, error: "Arm a lesson cue only inside its admitted interactive explanation turn." };
    }
    if (connection.cue?.cueId === input.presentation.cueId) {
      const cue = connection.cue;
      if (cue.turnId !== identity.turnId || cue.conversationId !== identity.conversationId ||
          ["attemptId", "visualId", "commandId", "name"].some(key => cue[key] !== input.presentation[key]) ||
          !isDeepStrictEqual(cue.parameters, input.presentation.parameters)) {
        return { ok: false, error: "Reuse a cue identity only for its exact original turn and declared transition." };
      }
      return { ok: true, focus: connection.focus, presentation: publicCue(cue) };
    }
    if (connection.cue && !["completed", "interrupted", "failed"].includes(connection.cue.phase)) {
      return { ok: false, error: "The previous lesson cue has not finished. Read its actual receipt before continuing." };
    }
    return null;
  }
  function readCue(connection, input, identity) {
    const cue = connection?.cue;
    if (!cue || cue.conversationId !== identity.conversationId || cue.cueId !== input.cueId ||
        cue.attemptId !== input.attemptId || cue.visualId !== input.visualId) {
      return { ok: false, error: "The current browser has no matching live lesson cue. Open and explain it again explicitly." };
    }
    return { ok: true, presentation: publicCue(cue) };
  }
  function bindOutput(connection, event, generation) {
    const cue = connection?.cue;
    if (cue?.phase === "armed" && cue.generation === generation && event.role === "assistant" && event.status === "complete") {
      cue.outputId = event.outputId || event.messageId;
      cue.canonicalFinal = true;
      cue.phase = "bound";
    }
  }
  function failCue(connection, generation) {
    const cue = connection?.cue;
    if (cue?.generation === generation && !["completed", "interrupted", "failed"].includes(cue.phase)) {
      cue.phase = "failed";
    }
  }
  function retireForFocus(connection, focus) {
    if (connection.cue && (connection.cue.projectSlug !== focus?.projectSlug || connection.cue.sessionId !== focus?.sessionId)) {
      connection.cue.phase = "interrupted";
      changed();
    }
  }
  function retireCue(connection) {
    if (connection.cue) connection.cue.phase = "interrupted";
  }
  function allowsQuestion(connection, conversationId) {
    const cue = connection.cue;
    return !(cue && (cue.phase !== "completed" || cue.conversationId !== conversationId || cue.clientId !== connection.clientId));
  }
  function outputCue(connections, event) {
    return [...connections].map(connection => connection.cue).find(cue =>
      cue?.turnId === event.turnId && cue.outputId === (event.outputId || event.messageId));
  }
  return { begin, acknowledge, admitCue, readCue, bindOutput, failCue, retireForFocus, retireCue, allowsQuestion, outputCue };
}

export { publicCue, createColleagueNavigationCoordination };
