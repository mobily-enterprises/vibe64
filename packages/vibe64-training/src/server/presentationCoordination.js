import { isDeepStrictEqual } from "node:util";

function publicCue(cue) {
  const { generation, name, parameters, operation, projectSlug, sessionId, ...value } = cue;
  return value;
}
// Original ephemeral browser command/cue coordination. Consumers retain maps,
// admission, native turn authority, focus grammar and every lifecycle call site.
function createTrainingPresentationCoordination({ changed }) {
  function begin(connection, command, identity) {
    connection.navigation = command;
    changed();
    return new Promise((resolve) => {
      const timer = setTimeout(() => {
        command.status = "failed";
        connection.acknowledge = null;
        changed();
        resolve({ ok: false, error: "The browser did not acknowledge navigation. Open Colleague in that browser and try again." });
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
    if (input.ok && expected) {
      const result = input.presentation;
      if (!result || result.attemptId !== expected.attemptId || result.visualId !== expected.visualId || !result.playerInstanceId ||
          (expected.operation === "open" && result.phase !== "ready") ||
          (expected.operation === "command" && (result.phase !== "completed" || result.commandId !== expected.commandId)) ||
          (expected.operation === "cue" && (result.phase !== "armed" ||
            ["cueId", "commandId", "navigationId", "conversationId", "turnId", "clientId"].some(key => result[key] !== expected[key]))) ||
          (expected.operation === "snapshot" && !result.snapshot) || JSON.stringify(result).length > 8192 ||
          input.focus?.projectSlug !== connection.navigation.projectSlug || input.focus?.sessionId !== connection.navigation.sessionId || input.focus?.pane !== "preview") {
        return { ok: false, error: "The browser has not confirmed this exact lesson presentation operation." };
      }
    }
    connection.acknowledge({ ok: input.ok, ...(input.error ? { error: input.error } : {}), ...(input.focus ? { focus: input.focus } : {}),
      ...(expected && input.presentation ? { presentation: input.presentation } : {}) });
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

export { publicCue, createTrainingPresentationCoordination };
