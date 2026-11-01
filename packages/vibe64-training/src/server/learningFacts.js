import { learningVocabulary } from "../shared/learningVocabulary.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/** @typedef {import("./types.js").LearningFact} LearningFact */

/**
 * The fact readers a `fact` check asks. Each answers for one learner (and the attempt's practice project slug, when
 * it has one) with { holds, reason? }; its owner decides how, reading through ordinary actions with the check's own
 * action `context` so the learner's access applies. Training passes its built-in readers plus the ones a host provides
 * (the optional vibe64.training.learning-facts token). Each reader's name also goes into the learning vocabulary,
 * which is what makes a step that checks it available here; a later reader of the same name replaces an earlier one.
 * @param {ReadonlyArray<LearningFact>} facts
 */
function createLearningFacts(facts) {
  const readers = new Map(facts.map(({ id, read }) => [id, read]));
  learningVocabulary.register({ facts: [...readers.keys()] });

  /**
   * One bounded answer; a reader that fails or is missing answers "not yet".
   * @param {string} id
   * @param {{ actor: object, projectSlug?: string, context?: object }} options
   */
  async function read(id, options) {
    const { actor, projectSlug = "", context = {} } = options;
    const reader = readers.get(id);
    if (!reader) return { holds: false, reason: "This installation cannot check this yet." };
    try {
      const value = await reader({ actor, projectSlug, context });
      const reason = typeof value?.reason === "string" ? value.reason.trim().slice(0, 256) : "";
      return { holds: value?.holds === true, ...(reason ? { reason } : {}) };
    } catch (cause) {
      return { holds: false, reason: String(cause?.message || "The check could not be read. Try again.").slice(0, 256) };
    }
  }

  return Object.freeze({ read });
}

/**
 * Built in: the learner has an AI Colleague can use for them (connected and
 * routed), as AI setup leaves it.
 * @param {object} dependencies
 * @param {TerminalsService} dependencies.terminals
 */
function aiReadyFact({ terminals }) {
  return {
    id: "ai-ready",
    async read({ actor }) {
      const decision = await terminals.resolveAssistantPurpose({ purpose: "colleague" }, { vibe64User: actor });
      return decision?.available === true ? { holds: true }
        : { holds: false, reason: "Your AI isn't set up yet. Finish AI setup, then check again." };
    }
  };
}

export { aiReadyFact, createLearningFacts };
