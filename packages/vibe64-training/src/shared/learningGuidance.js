// A retired Learning watch delivered its observation to the Main teacher as an
// application wake, saved as that turn's authored message. The teacher model
// is gone (Learning v2), but saved conversations keep those wakes: presentation
// still shows the learner a short status line instead of the internal prompt,
// in the same way as other application-origin messages.
const LEARNING_GUIDANCE_MESSAGE_PREFIX = "learning-guidance-";
const GUIDANCE_HEADING = "A supervised Learning observation is available for this exact pinned lesson.";
const FACT_PREFIX = "Observed application fact: ";

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

export { learningGuidancePresentation };
