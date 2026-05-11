function buildProgressText({
  checking,
  passedCheckCount,
  requiredCheckCount
}) {
  if (!requiredCheckCount) {
    return checking ? "Checks are starting." : "No required checks were reported.";
  }
  const suffix = checking ? "have passed so far" : "are ready";
  return `${passedCheckCount} of ${requiredCheckCount} required checks ${suffix}.`;
}

function resolveDoctorSummaryState({
  blockedLabel = "Blocked",
  blockedTitle = "Blocked",
  checkingLabel = "Checking",
  checkingTitle = "Checking",
  isLoading = false,
  passedCheckCount = 0,
  ready = false,
  readyLabel = "Ready",
  readyTitle = "Ready",
  requiredCheckCount = 0
} = {}) {
  const checking = Boolean(isLoading);

  if (checking) {
    return {
      color: "primary",
      label: checkingLabel,
      progressIndeterminate: requiredCheckCount === 0,
      progressText: buildProgressText({
        checking: true,
        passedCheckCount,
        requiredCheckCount
      }),
      state: "checking",
      title: checkingTitle
    };
  }

  if (ready) {
    return {
      color: "success",
      label: readyLabel,
      progressIndeterminate: false,
      progressText: buildProgressText({
        checking: false,
        passedCheckCount,
        requiredCheckCount
      }),
      state: "pass",
      title: readyTitle
    };
  }

  return {
    color: "error",
    label: blockedLabel,
    progressIndeterminate: false,
    progressText: buildProgressText({
      checking: false,
      passedCheckCount,
      requiredCheckCount
    }),
    state: "fail",
    title: blockedTitle
  };
}

export {
  resolveDoctorSummaryState
};
