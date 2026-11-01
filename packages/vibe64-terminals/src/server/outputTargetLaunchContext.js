import { isDeepStrictEqual } from "node:util";
import { managedPreviewTarget } from "@local/studio-terminal-core/shared";
import { assertSourceInspectionHealthy } from "@local/vibe64-runtime/server/sessionSourceInspection";
import { sessionSourcePath } from "@local/vibe64-core/server/sessionSourcePath";
import { currentProjectSlug } from "./terminalShared.js";
import { loadProjectExecutionEnv } from "./projectExecutionEnv.js";
import { inspectVibe64WorkspaceSetupForContext, listVibe64OutputTargets } from "./vibe64OutputTargets.js";
import { trimmedText as normalizeOutputTargetId } from "./trimmedText.js";
import { launchTerminalIsRunning } from "./launchPreviewReadiness.js";

// What a launch reads before it starts: the session's launch context, its
// output targets with the workspace-setup gate, and the managed Preview plan.

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * Reads what a launch works from: the session (after its workspace preparation,
 * when a preparer is given), its source root, project environment, Preview
 * identities and the project's roots.
 * @param {ProjectService} projectService
 * @param {string} sessionId
 * @param {object} [options]
 * @param {boolean} [options.awaitWorkspacePrepared]
 * @param {((sessionId: string, context: object) => Promise<object>) | null} [options.ensureWorkspacePrepared]
 * @param {boolean} [options.prepareEnvironment]
 * @param {boolean} [options.rerunFailedSetup]
 */
async function readLaunchContext(projectService, sessionId, {
  awaitWorkspacePrepared = false,
  ensureWorkspacePrepared = null,
  prepareEnvironment = false,
  rerunFailedSetup = false
} = {}) {
  const runtime = await projectService.createRuntime();
  let session = await runtime.getSession(sessionId);
  assertSourceInspectionHealthy(session.sourceInspection);
  if (typeof ensureWorkspacePrepared === "function") {
    const setup = await ensureWorkspacePrepared(sessionId, {
      rerunFailedSetup,
      runtime,
      session
    });
    if (setup?.ok === false) {
      throw Object.assign(new Error(setup.error || "Workspace preparation could not start."), setup);
    }
    if (awaitWorkspacePrepared && setup?.completion) {
      await setup.completion;
    }
    session = await runtime.getSession(sessionId);
  }
  const sessionSourceRoot = sessionSourcePath(session);
  const projectEnvironment = await loadProjectExecutionEnv({
    prepare: prepareEnvironment,
    reusePrepared: prepareEnvironment,
    projectService,
    session,
    target: "output-target"
  });
  // readable-check: allow method-probe - optional operation: a project service without a target root reads the session source only
  const projectContextRoot = typeof projectService?.currentTargetRoot === "function"
    ? String(projectService.currentTargetRoot() || "").trim()
    : "";
  // readable-check: allow method-probe - optional operation: a project service without managed app identities offers none
  const previewIdentitySettings = typeof projectService?.readPreviewApplicationIdentities === "function"
    ? await projectService.readPreviewApplicationIdentities({
        sessionId: session.sessionId
      })
    : {
        identities: [],
        ok: true
      };
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
    projectService,
    previewApplicationIdentities: previewIdentitySettings.identities || [],
    projectEnvironment,
    projectsRoot: projectService?.selectedProject?.projectsRoot || "",
    projectContextRoot,
    projectSlug: currentProjectSlug(projectService),
    runtime,
    // readable-check: allow method-probe - optional operation: a project service without service data keeps none
    serviceDataRoot: typeof projectService?.currentServiceDataRoot === "function"
      ? projectService.currentServiceDataRoot()
      : "",
    session,
    store: runtime.store,
    sessionSourceRoot
  };
}

async function listOutputTargets(context, {
  inspectOutputs,
  inspectWorkspaceSetup
} = {}) {
  const [targets, setup] = await Promise.all([
    listVibe64OutputTargets(context, inspectOutputs ? { inspect: inspectOutputs } : {}),
    inspectVibe64WorkspaceSetupForContext(
      context,
      inspectWorkspaceSetup ? { inspect: inspectWorkspaceSetup } : {}
    )
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

  if (!inspectionStatus) {
    return ["ambiguous", "failed"].includes(storedStatus)
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
  if (currentRecipe && ["ambiguous", "failed"].includes(storedStatus)) {
    return String(
      stored.diagnostic || "Workspace preparation must be fixed before managed preview can start."
    ).trim();
  }
  // Starting an output target owns running and awaiting the current recipe.
  // A new or changed recipe is therefore pending work, not a disabled target.
  return "";
}

function findOutputTarget(targets = [], outputTargetId = "") {
  const normalizedOutputTargetId = normalizeOutputTargetId(outputTargetId);
  return targets.find((target) => target.id === normalizedOutputTargetId) || null;
}

function previewTargetError(target, outputTargetId) {
  if (target && target.available !== false && target.presentation?.kind === "web") {
    return null;
  }
  return Object.assign(new Error(`Preview target ${outputTargetId} must be an available declared web target.`), {
    code: "vibe64_preview_target_unavailable"
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
  const previousTargetId = normalizeOutputTargetId(
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

export {
  readLaunchContext,
  listOutputTargets,
  workspaceSetupLaunchDisabledReason,
  findOutputTarget,
  previewTargetError,
  managedPreviewLaunchPlan
};
