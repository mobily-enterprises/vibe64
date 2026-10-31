import { vibe64Error as projectDeletionError } from "./core.js";

const PROJECT_DELETION_STEP_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;

function normalizeProjectDeletion(value = null) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw projectDeletionError(
      "Project deletion state is invalid.",
      "vibe64_project_deletion_invalid"
    );
  }
  const startedAt = String(value.startedAt || "").trim();
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) {
    throw projectDeletionError(
      "Project deletion state requires a valid start time.",
      "vibe64_project_deletion_started_at_invalid"
    );
  }
  if (!value.steps || typeof value.steps !== "object" || Array.isArray(value.steps)) {
    throw projectDeletionError(
      "Project deletion steps are invalid.",
      "vibe64_project_deletion_step_invalid"
    );
  }
  const steps = {};
  for (const [step, completedAtValue] of Object.entries(value.steps)) {
    const completedAt = String(completedAtValue || "").trim();
    if (
      !PROJECT_DELETION_STEP_PATTERN.test(step) ||
      !completedAt ||
      !Number.isFinite(Date.parse(completedAt))
    ) {
      throw projectDeletionError(
        "Project deletion step state is invalid.",
        "vibe64_project_deletion_step_invalid"
      );
    }
    steps[step] = new Date(completedAt).toISOString();
  }
  return {
    startedAt: new Date(startedAt).toISOString(),
    steps
  };
}

export {
  normalizeProjectDeletion
};
