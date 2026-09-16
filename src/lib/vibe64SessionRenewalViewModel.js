const SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS = 20_000;

const SESSION_RENEWAL_PROGRESS_STAGES = Object.freeze([
  Object.freeze({
    id: "handover",
    label: "Prepare the handover",
    stages: new Set(["draft_generating", "draft_ready"])
  }),
  Object.freeze({
    id: "quiesce",
    label: "Stop the old session safely",
    stages: new Set(["old_quiescing"])
  }),
  Object.freeze({
    id: "successor",
    label: "Create the fresh session",
    stages: new Set([
      "successor_creating",
      "successor_discarding",
      "successor_setup"
    ])
  }),
  Object.freeze({
    id: "briefing",
    label: "Brief the fresh assistant",
    stages: new Set(["successor_seeding", "successor_acknowledged"])
  }),
  Object.freeze({
    id: "archive",
    label: "Archive the old session",
    stages: new Set(["old_archiving"])
  }),
  Object.freeze({
    id: "activate",
    label: "Open the fresh session",
    stages: new Set(["successor_activating", "completed"])
  })
]);

const SESSION_RENEWAL_RESTORE_PROGRESS = Object.freeze([
  Object.freeze({
    id: "restore",
    label: "Restore the old session safely",
    state: "active"
  })
]);

function sessionRenewalText(value = "") {
  return String(value ?? "")
    .replaceAll("\r\n", "\n")
    .replaceAll("\r", "\n");
}

function sessionRenewalDraftCharacterCount(value = "") {
  return Array.from(sessionRenewalText(value)).length;
}

function sessionRenewalPhase(renewal = null, {
  initialLoading = false,
  loadError = ""
} = {}) {
  if (!renewal && initialLoading) {
    return "loading";
  }
  if (!renewal && String(loadError || "").trim()) {
    return "load_error";
  }
  const status = String(renewal?.status || "").trim();
  if (!renewal || status === "cancelled") {
    return "intro";
  }
  if (status === "review") {
    return "review";
  }
  if (status === "failed") {
    return "failed";
  }
  if (status === "completed") {
    return "completed";
  }
  return "progress";
}

function sessionRenewalStageProgress(stage = "") {
  const currentStage = String(stage || "").trim();
  if (currentStage === "failure_restoring") {
    return SESSION_RENEWAL_RESTORE_PROGRESS.map((step) => ({ ...step }));
  }
  const activeIndex = SESSION_RENEWAL_PROGRESS_STAGES.findIndex((step) => (
    step.stages.has(currentStage)
  ));
  return SESSION_RENEWAL_PROGRESS_STAGES.map((step, index) => ({
    id: step.id,
    label: step.label,
    state: currentStage === "completed" || (activeIndex >= 0 && index < activeIndex)
      ? "complete"
      : index === activeIndex
        ? "active"
        : "pending"
  }));
}

function sessionRenewalStageLabel(stage = "") {
  return ({
    draft_generating: "Preparing the handover…",
    failure_restoring: "Restoring the old session…",
    old_archiving: "Archiving the old session…",
    old_quiescing: "Stopping old session tools…",
    successor_acknowledged: "Fresh assistant is ready…",
    successor_activating: "Opening the fresh session…",
    successor_creating: "Creating the fresh session…",
    successor_discarding: "Resetting the fresh session safely…",
    successor_seeding: "Briefing the fresh assistant…",
    successor_setup: "Preparing the fresh workspace…"
  })[String(stage || "").trim()] || "Renewing this session…";
}

function sessionRenewalFailureSupportingMessage(renewal = null) {
  let message = "";
  if (String(renewal?.error?.code || "").trim() === "vibe64_session_renewal_restore_failed") {
    message = "The old session and its recovery state are retained, but it is not writable yet. Retry to finish restoring it safely.";
  } else {
    message = "The old session remains available. Fix the reported condition, then retry the same saved renewal.";
  }
  return String(renewal?.error?.message || "").trim() === message ? "" : message;
}

function sessionRenewalAdvisoryPresentation(advisory = {}) {
  const severity = String(advisory?.severity || "none").trim();
  const recommended = advisory?.recommended === true;
  return {
    attention: recommended,
    color: severity === "soon" ? "warning" : recommended ? "primary" : undefined,
    label: severity === "soon" ? "Renew soon" : recommended ? "Consider renewal" : "Renew session",
    reason: String(advisory?.reason || "Renew this session with a reviewed handover.").trim()
  };
}

function sessionRenewalOperationKey(sessionId = "", {
  now = Date.now(),
  randomId = ""
} = {}) {
  const safeSessionId = String(sessionId || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .slice(0, 48) || "session";
  const safeRandomId = String(randomId || "")
    .trim()
    .replace(/[^A-Za-z0-9_.-]+/gu, "")
    .slice(0, 40) || Math.random().toString(36).slice(2, 14);
  return `renewal:${safeSessionId}:${Number(now).toString(36)}:${safeRandomId}`.slice(0, 128);
}

export {
  SESSION_RENEWAL_MAX_HANDOVER_CHARACTERS,
  SESSION_RENEWAL_PROGRESS_STAGES,
  sessionRenewalAdvisoryPresentation,
  sessionRenewalDraftCharacterCount,
  sessionRenewalFailureSupportingMessage,
  sessionRenewalOperationKey,
  sessionRenewalPhase,
  sessionRenewalStageLabel,
  sessionRenewalStageProgress,
  sessionRenewalText
};
