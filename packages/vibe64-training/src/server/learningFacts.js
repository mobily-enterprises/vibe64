import { learningVocabulary } from "../shared/learningVocabulary.js";

// Fact readers: what a `fact` check asks. Each answers for one learner (and
// the attempt's practice project slug, when it has one) with
// { holds, reason? }; its owner decides how, reading through ordinary actions
// with the check's own action `context` so the learner's access applies. Public Training registers its
// built-in readers; a host registers its own (for example a deployment that
// is live) by composition. Registering a reader also registers its name in
// the learning vocabulary, which is what makes a step that checks it
// available here.
const readers = new Map();

function registerLearningFact({ id, read } = {}) {
  if (typeof read !== "function") throw new TypeError(`Fact ${id} needs its reader.`);
  // A provider set up again (one per server process; tests build several) replaces its reader.
  learningVocabulary.register({ facts: [id] });
  readers.set(id, read);
}

// One bounded answer; a reader that fails or is missing answers "not yet".
async function readLearningFact(id, { actor, projectSlug = "", context = {} } = {}) {
  const read = readers.get(id);
  if (!read) return { holds: false, reason: "This installation cannot check this yet." };
  try {
    const value = await read({ actor, projectSlug, context });
    const reason = typeof value?.reason === "string" ? value.reason.trim().slice(0, 256) : "";
    return { holds: value?.holds === true, ...(reason ? { reason } : {}) };
  } catch (cause) {
    return { holds: false, reason: String(cause?.message || "The check could not be read. Try again.").slice(0, 256) };
  }
}

// Built in: the learner has an AI Colleague can use for them (connected and
// routed), as AI setup leaves it.
function aiReadyFact({ terminals }) {
  return {
    id: "ai-ready",
    async read({ actor }) {
      if (typeof terminals?.resolveAssistantPurpose !== "function") return { holds: false, reason: "AI setup is unavailable here." };
      const decision = await terminals.resolveAssistantPurpose({ purpose: "colleague" }, { vibe64User: actor });
      return decision?.available === true ? { holds: true }
        : { holds: false, reason: "Your AI isn't set up yet. Finish AI setup, then check again." };
    }
  };
}

export { aiReadyFact, readLearningFact, registerLearningFact };
