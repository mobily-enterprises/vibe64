import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";

/**
 * Main chat pauses or blocks its own goal through the goal control its
 * admitted turn carries; any other caller is refused.
 * @param {"pause" | "block"} operation
 * @param {object} input the validated goal control input
 * @param {object} context the action context of the request
 */
function requestMainGoalControl(operation, input, context) {
  // readable-check: allow method-probe - input validation: only an admitted Main conversation's request carries its goal controls
  if (typeof context.mainGoalControl?.[operation] !== "function" ||
      (context.vibe64Action?.project || currentProjectRequestContext())?.slug !== context.projectSlug) {
    throw Object.assign(new Error("Only this goal's admitted Main conversation can request this goal control."), {
      code: "vibe64_main_goal_control_required",
      statusCode: 403
    });
  }
  return context.mainGoalControl[operation](input);
}

export { requestMainGoalControl };
