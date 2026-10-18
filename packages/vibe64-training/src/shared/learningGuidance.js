// A Learning watch delivers its observation to the Main teacher as an
// application wake. The canonical conversation saves that wake's text as the
// turn's authored message, so the teacher's full instructions and evidence stay
// in history unchanged. Presentation shows the learner a short status line
// instead of the internal prompt, in the same way as other application-origin
// messages.
const LEARNING_GUIDANCE_MESSAGE_PREFIX = "learning-guidance-";
const GUIDANCE_HEADING = "A supervised Learning observation is available for this exact pinned lesson.";
const FACT_PREFIX = "Observed application fact: ";

function learningGuidanceText(task, evidence) {
  return [
    GUIDANCE_HEADING,
    `Current lesson outcome or criterion: ${task.criterion}`,
    `${FACT_PREFIX}${JSON.stringify({ evidence, progress: task.progress })}`,
    "Treat this as application-origin context, not as the learner's authored answer and not as assessment evidence.",
    "If the observation confirms meaningful progress, briefly connect it to the current criterion. If it reports a failure, explain only the supported failure and offer at most one useful hint. If it is insufficient, say so rather than inventing progress.",
    "Do not mark an assessment passed, answer a pending question for the learner, create a second goal, or start an idle follow-up loop."
  ].join("\n");
}

function paneLabel(pane) {
  const words = String(pane || "").trim().replace(/[-_]+/gu, " ");
  return words ? words[0].toUpperCase() + words.slice(1) : "";
}

function learningGuidanceSummary(evidence) {
  if (evidence?.outcome === "failed") return "Watching: that step did not finish.";
  const workspace = evidence?.workspace || {};
  if (workspace.learningView === "learning") return "Watching: you are in the Learning pane.";
  const pane = paneLabel(workspace.pane);
  if (!pane) return "Watching your practice task.";
  return `Watching: you are in ${pane}${workspace.ready === false ? " (still loading)" : ""}.`;
}

// Recognizes only a delivered guidance wake: its server-owned message ID and
// the exact heading this module writes. Returns null for every other message.
function learningGuidancePresentation(message) {
  if (message?.role !== "user" || !String(message.messageId || "").startsWith(LEARNING_GUIDANCE_MESSAGE_PREFIX)) return null;
  const lines = String(message.text || "").split("\n");
  if (lines[0] !== GUIDANCE_HEADING) return null;
  let evidence = null;
  const fact = lines.find(line => line.startsWith(FACT_PREFIX));
  try { evidence = fact ? JSON.parse(fact.slice(FACT_PREFIX.length))?.evidence ?? null : null; }
  catch { evidence = null; }
  return { text: learningGuidanceSummary(evidence) };
}

export { LEARNING_GUIDANCE_MESSAGE_PREFIX, learningGuidanceText, learningGuidanceSummary, learningGuidancePresentation };
