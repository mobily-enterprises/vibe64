/**
 * The finishing steps' defaults, the Chat settings switches that choose them,
 * and what each step's automatic start says. Turning the UI pass on by default
 * changes only its value here.
 */
const ASSISTANT_FINISHING_DEFAULTS = Object.freeze({ review: true, deslop: true, uiPass: false, autoSave: true });
const ASSISTANT_FINISHING_STEPS = Object.freeze([
  { id: "review", name: "Review", setting: "Automatically review changes", genesisTask: "review" },
  { id: "deslop", name: "Deslop", setting: "Automatically deslop changes", genesisTask: "deslop" },
  { id: "uiPass", name: "UI pass", setting: "Automatically UI pass changes", genesisTask: "ui-pass" },
  { id: "autoSave", name: "Save", setting: "Automatically save changes" }
].map(Object.freeze));
// Temporary chats and Fix it with AI run no finishing step.
const ASSISTANT_NO_FINISHING = Object.freeze(Object.fromEntries(ASSISTANT_FINISHING_STEPS.map(({ id }) => [id, false])));

/**
 * The parts of a request's finishing turn, in order: review, Deslop, UI pass.
 * Save follows that turn. A request admitted before each chat chose its
 * finishing steps was Auto's, whose review was mandatory.
 */
function assistantFinishingParts(request) {
  const finishing = request && Object.hasOwn(request, "finishing") ? request.finishing || {}
    : { review: true, deslop: request?.deslop === true };
  return ASSISTANT_FINISHING_STEPS.filter(({ id }) => id !== "autoSave" && finishing[id] === true).map(({ id }) => id);
}

/**
 * The system notice a finishing step writes when the chat's setting starts it.
 * @param {string} step review, deslop, uiPass or autoSave
 * @param {string} key the follow-up or turn it belongs to
 */
function assistantFinishingNotice(step, key) {
  const { name, setting } = ASSISTANT_FINISHING_STEPS.find(({ id }) => id === step);
  return { messageId: `assistant-finishing:${step}:${key}`, text: `${name} started automatically (Chat settings: ${setting})` };
}

/**
 * The finishing turn's instructions: the enabled parts in order, done by one
 * agent in one turn. Only Senior completes an involved plan.
 * @param {{ review?: boolean, deslop?: boolean, uiPass?: boolean }} finishing
 * @param {{ completesPlan?: boolean }} [options]
 */
function assistantFinishingMessage(finishing, options = {}) {
  const { completesPlan = true } = options;
  const parts = assistantFinishingParts({ finishing });
  if (!parts.length) return "";
  const { review, deslop, uiPass } = finishing;
  const names = parts.map(id => id === "review" ? "review" : ASSISTANT_FINISHING_STEPS.find(step => step.id === id).name);
  const heading = names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names[0];
  return [
    `Automatic ${heading}:`,
    ...(review ? [
      "Check the preceding implementation against my request, accepted steering and any plan explicitly involved in that work. Inspect the implementation and evidence, fix in-scope issues, and run relevant checks. Read every page of BOTH Plan and Progress before reviewing, including the complete technical implementation plan; checklist marks do not establish completion. Leave unrelated plans unchanged. Do not ask for permission merely to review or complete verified work."
    ] : []),
    ...(deslop ? [review
      ? "Then perform Deslop on the coding changes and your review fixes, following the project's Deslop guidance. Keep that cleanup behavior-preserving and preserve unrelated work and staging."
      : "Perform Deslop on the preceding coding changes, following the project's Deslop guidance. Keep that cleanup behavior-preserving and preserve unrelated work and staging."
    ] : []),
    ...(uiPass ? [review || deslop
      ? "Then run the UI pass on the screens those changes touched, following the project's UI pass guidance. Keep each screen's behavior and preserve unrelated work and staging."
      : "Run the UI pass on the screens the preceding coding changes touched, following the project's UI pass guidance. Keep each screen's behavior and preserve unrelated work and staging."
    ] : []),
    ...(deslop || uiPass ? [
      "Perform every part yourself in this turn; do not delegate cleanup or start a separate Deslop or UI pass turn. Run relevant checks after cleanup."
    ] : []),
    completesPlan
      ? `Only after ${review ? "review, any enabled Deslop and UI pass" : "every part"} and their checks are finished: Explicitly complete an involved plan when every requirement is verified; otherwise leave Plan active and record specific gaps and verification evidence in its paired Progress document. Report findings, fixes, actual checks and anything unverified.`
      : "Only after every part and its checks are finished: record specific gaps and verification evidence in an involved plan's paired Progress document and leave that plan active for Senior to complete. Report findings, fixes, actual checks and anything unverified."
  ].join(" ");
}

/**
 * Earlier requests whose changes no finishing turn has covered yet, oldest
 * first and bounded: a stopped, waiting or unfinished request's changes fold
 * into the next finishing turn. Finished work (its finishing turn, or a
 * handoff with every part off) covered them all; work its agent reported
 * complete without changing files passes them on.
 */
function assistantUnreviewedRequests(previous) {
  if (!previous) return [];
  const complete = previous.workflow && previous.status === "complete";
  // Only an outcome reported for the request's own last turn counts.
  const reported = previous.outcome && previous.outcome.turnId === previous.turnId ? previous.outcome.decision : "";
  if (complete && (previous.stage === "review" || reported === "handoff")) return [];
  const unchanged = complete && reported === "complete";
  return [
    ...(Array.isArray(previous.unreviewed) ? previous.unreviewed : []),
    ...(previous.workflow && !unchanged ? [{ messageId: previous.messageId, message: String(previous.input?.message || "").slice(0, 500) }] : [])
  ].slice(-10);
}

export {
  ASSISTANT_FINISHING_DEFAULTS,
  ASSISTANT_FINISHING_STEPS,
  ASSISTANT_NO_FINISHING,
  assistantFinishingMessage,
  assistantFinishingNotice,
  assistantFinishingParts,
  assistantUnreviewedRequests
};
