// Original Preview operation dispatch and bounded browser receipt projection.
// The host retains and checks its actor/view/handle fences before and after await.
function executeTrainingPresentationOperation(presentation, { operation, ...input }) {
  return (operation === "cue" ? presentation.armCue(input) : presentation[operation](input));
}

function trainingPresentationReceipt(result) {
  const { ok, attemptId, visualId, playerInstanceId, phase, commandId, state, description, snapshot,
    cueId, conversationId, turnId, clientId, navigationId } = result;
  if (ok !== true) throw new Error("The lesson presentation did not confirm its operation.");
  return { attemptId, visualId, playerInstanceId,
    ...(phase ? { phase } : {}), ...(commandId ? { commandId } : {}), ...(state ? { state } : {}),
    ...(description ? { description } : {}), ...(snapshot ? { snapshot } : {}),
    ...(cueId ? { cueId, conversationId, turnId, clientId, navigationId } : {}) };
}

export { executeTrainingPresentationOperation, trainingPresentationReceipt };
