import { assistantRoutingRequestCanBeReplaced, assistantRoutingStatusLabel } from "./assistantRouting.js";
import { WHOLE_CHECKS_QUESTION, assistantAsksWholeChecks, assistantRunsWholeChecks } from "./assistantWholeChecks.js";

const ASSISTANT_RESUME_LABELS = Object.freeze({
  planning: "Continue planning",
  implementation: "Continue implementation",
  review: "Continue review",
  pass: "Continue the passes"
});
// When a workflow action held by other work becomes available: during the assistant's turn, while the person's
// message is sent, or while their spoken message is taken.
const ASSISTANT_RESUME_WAITS = Object.freeze({
  turn: "available when this answer ends",
  message: "available once your message is sent",
  voice: "available once your spoken message is sent"
});
// What the pressed action's button shows while it is submitted; the whole-project checks' Yes is "run-checks".
const ASSISTANT_RESUME_PROGRESS = Object.freeze({ implement: "Starting…", continue: "Continuing…", check: "Checking…", "run-checks": "Starting…" });

/**
 * The workflow notice above Main chat's composer for the saved request: its label, whether it shows, and its one
 * workflow action (Implement plan, the stage's Continue, or Check delivery) with whether it can be pressed now. An
 * action held by other work says when it becomes available (`waits`, "available when this answer ends"); one being
 * submitted says so (`progress`). The plan's status line names the same action in the same words. Once a plan is
 * finished, the notice asks whether to run the whole-project checks: its label is the question and its action, kind
 * "checks", is the Yes, beside which the notice shows No.
 * @param {object | null} request the saved routing request
 * @param {{ mode?: string, selection?: object | null, busy?: "" | "turn" | "message" | "voice", pendingAction?: string }}
 *   [options] mode: the chat's mode now; busy: what holds the chat (the assistant's turn, the person's message being
 *   sent, or their spoken message); pendingAction: the action being submitted, "implement", "continue", "run-checks"
 *   or "skip-checks"
 * @returns {{ shown: boolean, label: string, previousAttempt: boolean, needsAction: boolean, stop: boolean,
 *   action: { kind: "implement" | "continue" | "check" | "checks", label: string, enabled: boolean, waits: string,
 *     progress: string } | null }}
 */
function assistantRoutingNotice(request, { mode = "", selection = null, busy = "", pendingAction = "" } = {}) {
  if (!request) return { shown: false, label: "", previousAttempt: false, needsAction: false, stop: false, action: null };
  if (assistantAsksWholeChecks(request)) {
    const held = ASSISTANT_RESUME_WAITS[busy] || "";
    const action = {
      kind: "checks",
      label: "Yes",
      enabled: !pendingAction && !held,
      waits: pendingAction ? "" : held,
      progress: ASSISTANT_RESUME_PROGRESS[pendingAction] || ""
    };
    return { shown: true, label: WHOLE_CHECKS_QUESTION, previousAttempt: false, needsAction: true, stop: false, action };
  }
  const previousAttempt = Boolean(request.stopped && request.delivery === "uncertain" &&
    assistantRoutingRequestCanBeReplaced(request, selection));
  const label = previousAttempt ? "Previous assistant delivery unconfirmed" : assistantRoutingStatusLabel(request);
  const canImplement = mode === "auto" && request.stage === "planning" && request.status === "waiting" &&
    ["pending", "accepted"].includes(request.delivery) && !request.helper && request.workPlan?.status === "active" &&
    Boolean(request.workPlan.revision);
  // While Auto waits for the person's answer only their reply (or Implement plan) moves on.
  const resumable = request.followup || request.delivery === "accepted" && (request.workflow || request.stage === "planning");
  const needsAction = request.awaitingAnswer ? canImplement : Boolean(request.status === "waiting" && resumable ||
    request.delivery === "uncertain" && (request.followup || previousAttempt));
  // The original unsent message's delivery controls stay on its bubble.
  const hidden = request.stopped && !request.followup && !request.attemptedMessageId && !request.helper && !needsAction ||
    !request.followup && !request.helper && !previousAttempt && ["failed", "uncertain"].includes(request.delivery);
  const shown = !hidden && Boolean(label && (request.error || needsAction));
  let action = null;
  if (shown && needsAction) {
    let kind = "continue";
    if (canImplement) kind = "implement";
    else if (request.delivery === "uncertain") kind = "check";
    const name = { implement: "Implement plan", check: "Check delivery" }[kind] ||
      (assistantRunsWholeChecks(request) ? "Continue the checks" : ASSISTANT_RESUME_LABELS[request.stage]) || "Continue request";
    // Checking delivery only reads the saved attempt, so it works during a turn; the others wait for it.
    const held = kind === "check" ? "" : ASSISTANT_RESUME_WAITS[busy] || "";
    action = {
      kind,
      label: name,
      enabled: !pendingAction && !held,
      waits: pendingAction ? "" : held,
      progress: pendingAction ? ASSISTANT_RESUME_PROGRESS[kind] : ""
    };
  }
  return { shown, label, previousAttempt, needsAction, stop: shown && needsAction && request.delivery === "pending", action };
}

export { assistantRoutingNotice };
