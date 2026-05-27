function actionResultTime(result = {}) {
  const time = new Date(result.at || "").getTime();
  return Number.isFinite(time) ? time : 0;
}

function actionResultsForAction(session = {}, actionId = "", {
  since = 0
} = {}) {
  const normalizedActionId = String(actionId || "");
  if (!normalizedActionId) {
    return [];
  }
  const earliestTime = Number(since || 0);
  const actionResults = Array.isArray(session?.actionResults) ? session.actionResults : [];
  return actionResults
    .filter((result) => result.actionId === normalizedActionId)
    .filter((result) => !earliestTime || actionResultTime(result) >= earliestTime)
    .slice()
    .sort((left, right) => actionResultTime(left) - actionResultTime(right));
}

function latestVibe64ActionResult(session = {}, actionId = "", options = {}) {
  return actionResultsForAction(session, actionId, options).at(-1) || null;
}

export {
  actionResultsForAction,
  latestVibe64ActionResult
};
