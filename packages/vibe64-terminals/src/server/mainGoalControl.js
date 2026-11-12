import { AppError } from "@jskit-ai/kernel/server/runtime";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

/**
 * Main chat pauses, resumes or blocks its own goal through the goal control its
 * admitted turn carries; any other caller is refused.
 * @param {"pause" | "resume" | "block"} operation
 * @param {object} input the validated goal control input
 * @param {object} context the action context of the request
 */
function requestMainGoalControl(operation, input, context) {
  // readable-check: allow method-probe - input validation: only an admitted Main conversation's request carries its goal controls
  if (typeof context.mainGoalControl?.[operation] !== "function" ||
      (context.vibe64Action?.project || currentProjectRequestContext())?.slug !== context.projectSlug) {
    throw new AppError(403, "Only this goal's admitted Main conversation can request this goal control.", { code: "vibe64_main_goal_control_required" });
  }
  return context.mainGoalControl[operation](input);
}

export { requestMainGoalControl };
