import { isDeepStrictEqual } from "node:util";
import { managedPreviewTarget } from "@local/studio-terminal-core/shared";
import { assertSourceInspectionHealthy } from "@local/vibe64-runtime/server/sessionSourceInspection";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { currentProjectSlug } from "./terminalShared.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { inspectVibe64WorkspaceSetupForContext, listVibe64OutputTargets } from "./vibe64OutputTargets.js";
import { launchTerminalIsRunning } from "./launchPreviewReadiness.js";
import { CONNECTED_PREPARATION_STEP_LABEL } from "./workspaceSetupRules.js";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

// What a launch reads before it starts: the session's launch context, its
// output targets with the workspace-setup gate, and the managed Preview plan.

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-runtime/server/runtime").Vibe64SessionRuntime} Vibe64SessionRuntime */

/**
 * What a launch works from, for a session already read: its source root,
 * project environment, Preview identities and the project's roots.
 * @param {ProjectService} project
 * @param {Vibe64SessionRuntime} runtime
 * @param {object} session
 * @param {boolean} prepareEnvironment
 */
async function launchContextFor(project, runtime, session, prepareEnvironment) {
  const sessionSourceRoot = sessionSourcePath(session);
  const projectEnvironment = await loadProjectExecutionEnv({
    prepare: prepareEnvironment,
    reusePrepared: prepareEnvironment,
    project,
    session,
    target: "output-target"
  });
  const projectContextRoot = String(project.currentTargetRoot() || "").trim();
  const previewIdentitySettings = await project.readPreviewApplicationIdentities({
    sessionId: session.sessionId
  });
  if (previewIdentitySettings?.ok === false) {
    const error = new Error(
      previewIdentitySettings.errors?.[0]?.message ||
      previewIdentitySettings.error ||
      "Managed app identities could not be read."
    );
    error.code = previewIdentitySettings.errors?.[0]?.code || previewIdentitySettings.code ||
      "vibe64_preview_application_identities_unavailable";
    throw error;
  }
  return {
    project,
    previewApplicationIdentities: previewIdentitySettings.identities || [],
    projectEnvironment,
    projectsRoot: project.selectedProject?.projectsRoot || "",
    projectContextRoot,
    projectSlug: currentProjectSlug(project),
    runtime,
    serviceDataRoot: project.currentServiceDataRoot(),
    session,
    store: runtime.store,
    sessionSourceRoot
  };
}

/**
 * Reads what a launch works from: the session, its source root, project
 * environment, Preview identities and the project's roots.
 * @param {ProjectService} project
 * @param {string} sessionId
 */
async function readLaunchContext(project, sessionId) {
  const runtime = await project.createRuntime();
  const session = await runtime.getSession(sessionId);
  assertSourceInspectionHealthy(session.sourceInspection);
  return launchContextFor(project, runtime, session, false);
}

/**
 * Reads what a launch starts from: the session after its workspace
 * preparation has completed, with the project environment prepared.
 * @param {ProjectService} project
 * @param {string} sessionId
 * @param {object} options
 * @param {(sessionId: string, context: object) => Promise<object>} options.ensureWorkspacePrepared
 * @param {boolean} options.rerunFailedSetup
 */
async function readPreparedLaunchContext(project, sessionId, { ensureWorkspacePrepared, rerunFailedSetup }) {
  const runtime = await project.createRuntime();
  const session = await runtime.getSession(sessionId);
  assertSourceInspectionHealthy(session.sourceInspection);
  const setup = await ensureWorkspacePrepared(sessionId, {
    rerunFailedSetup,
    runtime,
    session
  });
  if (setup?.ok === false) {
    throw Object.assign(new Error(setup.error || "Workspace preparation could not start."), setup);
  }
  if (setup?.completion) {
    await setup.completion;
  }
  return launchContextFor(project, runtime, await runtime.getSession(sessionId), true);
}

async function listOutputTargets(context, options = {}) {
  const { inspectOutputs } = options;
  const [targets, setup] = await Promise.all([
    listVibe64OutputTargets(context, inspectOutputs ? { inspect: inspectOutputs } : {}),
    inspectVibe64WorkspaceSetupForContext(context)
  ]);
  const disabledReason = workspaceSetupLaunchDisabledReason(context.session, setup);
  if (!disabledReason) {
    return targets;
  }
  return targets.map((target) => ({
    ...target,
    available: false,
    disabledReason
  }));
}

function workspaceSetupLaunchDisabledReason(session = {}, inspection = null) {
  const stored = session.workspaceSetup || {};
  const storedStatus = String(stored.status || "").trim();
  const inspectionStatus = String(inspection?.status || "").trim();
  // Connected preparation waiting for a person to run it holds Preview back as its failure does.
  const stopped = ["ambiguous", "failed"].includes(storedStatus) ||
    (storedStatus === "required" && String(stored.currentLabel || "").trim() === CONNECTED_PREPARATION_STEP_LABEL);

  if (!inspectionStatus) {
    return stopped
      ? String(stored.diagnostic || "Workspace preparation must be fixed before managed preview can start.").trim()
      : "";
  }
  if (inspectionStatus === "unconfigured") {
    return "";
  }

  const diagnostic = (Array.isArray(inspection?.diagnostics) ? inspection.diagnostics : [])
    .map((entry) => String(
      typeof entry === "string" ? entry : entry?.message || entry?.code || ""
    ).trim())
    .find(Boolean) || "";
  if (inspectionStatus !== "ready") {
    return diagnostic || "Vibe64 workspace preparation is not ready.";
  }

  const recipeHash = String(inspection?.recipeHash || "").trim();
  const storedRecipeHash = String(stored.recipeHash || "").trim();
  const currentRecipe = Boolean(recipeHash && storedRecipeHash === recipeHash);
  if (currentRecipe && storedStatus === "succeeded") {
    return "";
  }
  if (currentRecipe && storedStatus === "running") {
    return "";
  }
  // A stop recorded before any recipe (connected preparation stops there)
  // cannot go stale with a recipe, so it holds until preparation runs again.
  if ((currentRecipe || !storedRecipeHash) && stopped) {
    return String(
      stored.diagnostic || "Workspace preparation must be fixed before managed preview can start."
    ).trim();
  }
  // Starting an output target owns running and awaiting the current recipe.
  // A new or changed recipe is therefore pending work, not a disabled target.
  return "";
}

function findOutputTarget(targets = [], outputTargetId = "") {
  const normalizedOutputTargetId = normalizeText(outputTargetId);
  return targets.find((target) => target.id === normalizedOutputTargetId) || null;
}

function previewTargetError(target, outputTargetId) {
  if (target && target.available !== false && target.presentation?.kind === "web") {
    return null;
  }
  return vibe64Error(`Preview target ${outputTargetId} must be an available declared web target.`, "vibe64_preview_target_unavailable", {
    params: { outputTargetId }
  });
}

function managedPreviewUnavailableMessage(outputTargets = []) {
  const reasons = [...new Set(outputTargets
    .map((target) => String(target?.disabledReason || "").trim())
    .filter(Boolean))];
  if (reasons.length > 0) {
    return reasons.join(" ");
  }
  return outputTargets.length > 0
    ? "The managed preview is not currently available."
    : "This project does not currently provide a managed preview.";
}

function managedPreviewLaunchPlan({
  outputTargets = [],
  outputTargetId = "",
  previewStatus = {},
  outputParameters,
  restart = false,
  savedOutputTarget = null
} = {}) {
  const activeTerminal = previewStatus.activeTerminal || null;
  const previewState = String(previewStatus.preview?.state || "").trim();
  const requestedTarget = outputTargetId ? findOutputTarget(outputTargets, outputTargetId) : null;
  const targetError = outputTargetId ? previewTargetError(requestedTarget, outputTargetId) : null;
  if (targetError) {
    return {
      code: targetError.code,
      error: targetError.message,
      ready: false
    };
  }
  const sameTarget = !outputTargetId || activeTerminal?.metadata?.outputTargetId === outputTargetId;
  const sameParameters = outputParameters === undefined || isDeepStrictEqual(
    outputParameters,
    activeTerminal?.metadata?.outputParameters || {}
  );
  if (!restart && sameTarget && sameParameters && (
    previewState === "ready" ||
    (previewState === "starting" && launchTerminalIsRunning(activeTerminal || {}))
  )) {
    return {
      ready: true,
      terminal: activeTerminal || {
        ok: true
      }
    };
  }

  const activeMetadata = activeTerminal?.metadata || {};
  const lastOutputTarget = previewStatus.lastOutputTarget || savedOutputTarget || {};
  const previousTargetId = normalizeText(
    lastOutputTarget.id || activeMetadata.outputTargetId
  );
  if (restart && !previousTargetId) {
    return {
      code: "vibe64_preview_not_started",
      error: "No managed Vibe64 preview has been started for this session.",
      ready: false
    };
  }
  const previousTarget = findOutputTarget(outputTargets, previousTargetId);
  if (restart && (!previousTarget || previousTarget.available === false)) {
    return {
      error: previousTarget?.disabledReason || "The previous managed preview output target is no longer available.",
      ready: false
    };
  }
  const outputTarget = requestedTarget || (
    previousTarget && previousTarget.available !== false
      ? previousTarget
      : null
  ) || (restart ? null : managedPreviewTarget(outputTargets));
  if (!outputTarget) {
    return {
      error: managedPreviewUnavailableMessage(outputTargets),
      ready: false
    };
  }

  return {
    forceRestart: restart || launchTerminalIsRunning(activeTerminal || {}),
    outputTargetId: outputTarget.id,
    ready: false
  };
}

const __testables = Object.freeze({ workspaceSetupLaunchDisabledReason });

export {
  readLaunchContext,
  readPreparedLaunchContext,
  listOutputTargets,
  findOutputTarget,
  previewTargetError,
  managedPreviewLaunchPlan,
  __testables
};
