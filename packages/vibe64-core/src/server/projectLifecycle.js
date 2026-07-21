import {
  PROJECT_APPLICATION_MODE_NEW,
  normalizeProjectApplicationMode
} from "../shared/projectApplication.js";

const PROJECT_BOOTSTRAP_STATUS_PENDING = "pending";
const PROJECT_BOOTSTRAP_STATUS_COMPLETE = "complete";
const PROJECT_RESOURCE_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/u;
const PROJECT_RESOURCE_NAME_PATTERN = /^[A-Za-z0-9_]{1,64}$/u;

function projectLifecycleError(message, code) {
  const error = new Error(message);
  error.code = code;
  return error;
}

function createProjectBootstrap(applicationMode = "") {
  const mode = normalizeProjectApplicationMode(applicationMode);
  if (!mode) {
    throw projectLifecycleError(
      "Project bootstrap requires a valid application mode.",
      "vibe64_project_bootstrap_mode_invalid"
    );
  }
  return {
    mode,
    status: PROJECT_BOOTSTRAP_STATUS_PENDING
  };
}

function normalizeProjectBootstrap(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw projectLifecycleError(
      "Project metadata requires a bootstrap record.",
      "vibe64_project_bootstrap_missing"
    );
  }
  const mode = normalizeProjectApplicationMode(value.mode);
  const status = String(value.status || "").trim();
  if (!mode) {
    throw projectLifecycleError(
      "Project bootstrap mode is invalid.",
      "vibe64_project_bootstrap_mode_invalid"
    );
  }
  if (![PROJECT_BOOTSTRAP_STATUS_PENDING, PROJECT_BOOTSTRAP_STATUS_COMPLETE].includes(status)) {
    throw projectLifecycleError(
      "Project bootstrap status is invalid.",
      "vibe64_project_bootstrap_status_invalid"
    );
  }
  const normalized = {
    mode,
    status
  };
  const templateCommit = String(value.templateCommit || "").trim().toLowerCase();
  if (templateCommit) {
    if (mode !== PROJECT_APPLICATION_MODE_NEW || !/^[0-9a-f]{40}$/u.test(templateCommit)) {
      throw projectLifecycleError(
        "Template bootstrap metadata requires the exact materialized commit.",
        "vibe64_project_bootstrap_template_invalid"
      );
    }
    normalized.templateCommit = templateCommit;
  }
  return normalized;
}

function pendingProjectBootstrap(value = null) {
  const bootstrap = normalizeProjectBootstrap(value);
  return bootstrap.status === PROJECT_BOOTSTRAP_STATUS_PENDING ? bootstrap : null;
}

function requirePendingProjectBootstrap(value = null) {
  const bootstrap = pendingProjectBootstrap(value);
  if (!bootstrap) {
    throw projectLifecycleError(
      "Project bootstrap is already complete.",
      "vibe64_project_bootstrap_complete"
    );
  }
  return bootstrap;
}

function projectBootstrapApplicationMode(value = null) {
  return pendingProjectBootstrap(value)?.mode || "";
}

function projectBootstrapWithTemplate(value = null, {
  commit = ""
} = {}) {
  const bootstrap = requirePendingProjectBootstrap(value);
  if (bootstrap.mode !== PROJECT_APPLICATION_MODE_NEW) {
    throw projectLifecycleError(
      "Only a new application can use a ready-made template.",
      "vibe64_project_bootstrap_template_mode_invalid"
    );
  }
  const templateCommit = String(commit || "").trim().toLowerCase();
  if (!/^[0-9a-f]{40}$/u.test(templateCommit)) {
    throw projectLifecycleError(
      "Template bootstrap metadata requires the exact materialized commit.",
      "vibe64_project_bootstrap_template_invalid"
    );
  }
  return normalizeProjectBootstrap({
    ...bootstrap,
    templateCommit
  });
}

function completedProjectBootstrap(value = null) {
  const normalized = normalizeProjectBootstrap(value);
  if (normalized.status === PROJECT_BOOTSTRAP_STATUS_COMPLETE) {
    return normalized;
  }
  return normalizeProjectBootstrap({
    ...normalized,
    status: PROJECT_BOOTSTRAP_STATUS_COMPLETE
  });
}

function normalizeManagedProjectResource(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw projectLifecycleError(
      "Managed project resources must be objects.",
      "vibe64_project_resource_invalid"
    );
  }
  const adapterId = String(value.adapterId || "").trim();
  const id = String(value.id || "").trim();
  const kind = String(value.kind || "").trim();
  const name = String(value.name || "").trim();
  const provider = String(value.provider || "").trim();
  if (!PROJECT_RESOURCE_ID_PATTERN.test(adapterId) || !PROJECT_RESOURCE_ID_PATTERN.test(id)) {
    throw projectLifecycleError(
      "Managed project resource identifiers are invalid.",
      "vibe64_project_resource_id_invalid"
    );
  }
  if (kind !== "relational-database" || provider !== "mariadb") {
    throw projectLifecycleError(
      "Managed project resource type is unsupported.",
      "vibe64_project_resource_type_invalid"
    );
  }
  if (!PROJECT_RESOURCE_NAME_PATTERN.test(name)) {
    throw projectLifecycleError(
      "Managed project database name is invalid.",
      "vibe64_project_resource_name_invalid"
    );
  }
  return {
    adapterId,
    id,
    kind,
    name,
    provider
  };
}

function normalizeManagedProjectResources(value = []) {
  if (!Array.isArray(value)) {
    throw projectLifecycleError(
      "Managed project resources must be an array.",
      "vibe64_project_resource_invalid"
    );
  }
  const resources = value
    .map(normalizeManagedProjectResource)
    .sort((left, right) => left.id.localeCompare(right.id));
  const ids = new Set();
  for (const resource of resources) {
    if (ids.has(resource.id)) {
      throw projectLifecycleError(
        `Managed project resource ID is duplicated: ${resource.id}.`,
        "vibe64_project_resource_duplicate"
      );
    }
    ids.add(resource.id);
  }
  return resources;
}

function normalizeProjectDeletion(value = null) {
  if (!value) {
    return null;
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    throw projectLifecycleError(
      "Project deletion state is invalid.",
      "vibe64_project_deletion_invalid"
    );
  }
  const startedAt = String(value.startedAt || "").trim();
  if (!startedAt || !Number.isFinite(Date.parse(startedAt))) {
    throw projectLifecycleError(
      "Project deletion state requires a valid start time.",
      "vibe64_project_deletion_started_at_invalid"
    );
  }
  const normalized = {
    startedAt: new Date(startedAt).toISOString(),
    steps: {}
  };
  if (!value.steps || typeof value.steps !== "object" || Array.isArray(value.steps)) {
    throw projectLifecycleError(
      "Project deletion steps are invalid.",
      "vibe64_project_deletion_step_invalid"
    );
  }
  for (const [step, completedAtValue] of Object.entries(value.steps || {})) {
    const completedAt = String(completedAtValue || "").trim();
    if (!PROJECT_RESOURCE_ID_PATTERN.test(step) || !completedAt || !Number.isFinite(Date.parse(completedAt))) {
      throw projectLifecycleError(
        "Project deletion step state is invalid.",
        "vibe64_project_deletion_step_invalid"
      );
    }
    normalized.steps[step] = new Date(completedAt).toISOString();
  }
  return normalized;
}

export {
  PROJECT_BOOTSTRAP_STATUS_COMPLETE,
  PROJECT_BOOTSTRAP_STATUS_PENDING,
  completedProjectBootstrap,
  createProjectBootstrap,
  normalizeManagedProjectResources,
  normalizeProjectBootstrap,
  normalizeProjectDeletion,
  pendingProjectBootstrap,
  projectBootstrapApplicationMode,
  projectBootstrapWithTemplate
};
