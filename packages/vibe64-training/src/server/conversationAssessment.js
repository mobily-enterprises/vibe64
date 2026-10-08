import { authenticatedVibe64User } from "@local/vibe64-core/server/actionContext";

// Moved from Colleague's admitted evaluation. Consumers retain their actual
// actor/turn/cue/observation lifetime; Training shares this one Helper/domain cut.
async function evaluateAdmittedTrainingAssessment(kind, input, context, {
  assessment, state, helper, requireCurrent, signal
}) {
  await requireCurrent();
  const checkedHelper = { async runHelper(...args) {
    const text = await helper.runHelper(...args);
    await requireCurrent();
    return text;
  } };
  const evaluate = kind === "practical" ? assessment.evaluatePractical : assessment.evaluateAnswer;
  const result = await evaluate.call(assessment, { ...input, actor: authenticatedVibe64User(context) }, {
    state, context, helper: checkedHelper, requireCurrent, signal
  });
  await requireCurrent();
  return result;
}

export { evaluateAdmittedTrainingAssessment };
