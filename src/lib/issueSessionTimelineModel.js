const FIRST_REWINDABLE_STEP_ID = "dependencies_installed";

function issueSessionStepSourceIds(step = {}) {
  return Array.isArray(step.sourceStepIds) && step.sourceStepIds.length ? step.sourceStepIds : [step.id].filter(Boolean);
}

function groupedIssueSessionSteps(steps = []) {
  const sortedSteps = [...steps].sort((left, right) => Number(left.index || 0) - Number(right.index || 0));
  const groupedSteps = [];

  for (let index = 0; index < sortedSteps.length; index += 1) {
    const step = sortedSteps[index];
    const groupId = String(step.displayGroupId || "").trim();
    if (!groupId) {
      groupedSteps.push(step);
      continue;
    }

    const members = [step];
    while (
      index + 1 < sortedSteps.length &&
      String(sortedSteps[index + 1].displayGroupId || "").trim() === groupId
    ) {
      index += 1;
      members.push(sortedSteps[index]);
    }

    if (members.length === 1) {
      groupedSteps.push(step);
      continue;
    }

    groupedSteps.push({
      ...step,
      description: members.map((member) => member.description).filter(Boolean).join(" "),
      id: `group:${groupId}`,
      kind: Array.from(new Set(members.map((member) => member.kind).filter(Boolean))).join(" / "),
      label: step.displayGroupLabel || step.label,
      sourceStepIds: members.map((member) => member.id),
      sourceSteps: members
    });
  }

  return groupedSteps;
}

function issueSessionDisplayStepId(stepId = "", groupedSteps = []) {
  const normalizedStepId = String(stepId || "").trim();
  const displayStep = groupedSteps.find((step) => issueSessionStepSourceIds(step).includes(normalizedStepId));
  return displayStep?.id || normalizedStepId;
}

function sourceStepDefinition(stepDefinitions = [], stepId = "") {
  return stepDefinitions.find((step) => step.id === stepId) || null;
}

function uiCheckForStep(uiChecks = [], stepId = "") {
  return [...uiChecks].reverse().find((check) => check?.stepId === stepId) || null;
}

function issueSessionStepIsSkipped(step = {}, session = {}) {
  const uiChecks = Array.isArray(session.uiChecks) ? session.uiChecks : [];
  return issueSessionStepSourceIds(step).every((stepId) => {
    if (stepId === "main_checkout_synced") {
      return String(session.mainCheckoutSync?.status || "").trim() === "skipped";
    }
    return String(uiCheckForStep(uiChecks, stepId)?.status || "").trim() === "skipped";
  });
}

function issueSessionStepIsDone(step = {}, completedStepIds = new Set()) {
  return issueSessionStepSourceIds(step).every((stepId) => completedStepIds.has(stepId));
}

function rewindStepIdFor(step = {}, stepDefinitions = []) {
  const sourceIds = issueSessionStepSourceIds(step);
  const targetStepId = sourceIds[0] || step.id || "";
  const targetStep = sourceStepDefinition(stepDefinitions, targetStepId) || step;
  const targetIndex = Number(targetStep.index);
  const firstRewindableIndex = Number(sourceStepDefinition(stepDefinitions, FIRST_REWINDABLE_STEP_ID)?.index ?? -1);

  if (!targetStepId || targetStepId === "session_created" || targetStepId === "worktree_created") {
    return "";
  }
  if (firstRewindableIndex < 0 || !Number.isFinite(targetIndex) || targetIndex < firstRewindableIndex) {
    return "";
  }
  return targetStepId;
}

function rewindStepLabelFor(step = {}, stepDefinitions = []) {
  const targetStepId = rewindStepIdFor(step, stepDefinitions);
  const targetStep = sourceStepDefinition(stepDefinitions, targetStepId) || step;
  return targetStep?.label || targetStepId || "this step";
}

function activeStepDescription(step = {}, currentStepId = "", currentAction = {}) {
  if (step.id === currentStepId) {
    return currentAction.description || step.description || "";
  }
  return step.description || "";
}

function issueSessionStepState(step = {}, {
  completedStepIds = new Set(),
  currentStepId = "",
  session = {}
} = {}) {
  if (issueSessionStepIsSkipped(step, session)) {
    return "skipped";
  }
  if ((session.errors || []).length && step.id === currentStepId) {
    return "blocked";
  }
  if (step.id === currentStepId) {
    return "current";
  }
  if (issueSessionStepIsDone(step, completedStepIds)) {
    return "done";
  }
  return "pending";
}

function issueSessionStepBadges(step = {}, {
  currentStepId = "",
  currentAction = {},
  session = {}
} = {}) {
  const badges = [];
  if (issueSessionStepIsSkipped(step, session)) {
    badges.push({
      color: "info",
      label: "Skipped"
    });
  }
  if (step.id === currentStepId && currentAction.conditional) {
    badges.push({
      color: "info",
      label: "Conditional"
    });
  }
  if (step.id === currentStepId && currentAction.retryable) {
    badges.push({
      color: "warning",
      label: "Retryable"
    });
  }
  return badges;
}

function issueSessionCurrentStepActionNotice(action = {}) {
  if (action.retryable) {
    return {
      text: "This blocked step is retryable. Repair the reported issue, then run it again.",
      type: "warning"
    };
  }
  if (action.conditional && action.skipReason) {
    return {
      text: `JSKIT can skip this conditional step: ${action.skipReason}`,
      type: "info"
    };
  }
  if (action.conditional) {
    return {
      text: "This is a conditional step. JSKIT decides whether it runs or records a skip based on session metadata.",
      type: "info"
    };
  }
  return null;
}

function issueSessionTimelineSteps({
  currentAction = {},
  currentStepId = "",
  isOpen = false,
  session = {},
  stepDefinitions = []
} = {}) {
  const completedStepIds = new Set(session.completedSteps || []);
  const groupedSteps = groupedIssueSessionSteps(stepDefinitions);

  return groupedSteps.map((step) => {
    const description = activeStepDescription(step, currentStepId, currentAction);
    const done = issueSessionStepIsDone(step, completedStepIds);
    const rewindStepId = rewindStepIdFor(step, stepDefinitions);
    const canRewind = Boolean(
      rewindStepId &&
      isOpen &&
      done &&
      step.id !== currentStepId &&
      completedStepIds.has(rewindStepId)
    );

    return {
      badges: issueSessionStepBadges(step, {
        currentAction,
        currentStepId,
        session
      }),
      canExpand: done && step.id !== currentStepId && (Boolean(description) || canRewind),
      canRewind,
      current: step.id === currentStepId,
      description,
      done,
      id: step.id,
      index: step.index,
      label: step.label,
      rewindLabel: rewindStepLabelFor(step, stepDefinitions),
      rewindStepId,
      state: issueSessionStepState(step, {
        completedStepIds,
        currentStepId,
        session
      }),
      title: description || step.description || undefined
    };
  });
}

export {
  groupedIssueSessionSteps,
  issueSessionCurrentStepActionNotice,
  issueSessionDisplayStepId,
  issueSessionStepSourceIds,
  issueSessionTimelineSteps
};
