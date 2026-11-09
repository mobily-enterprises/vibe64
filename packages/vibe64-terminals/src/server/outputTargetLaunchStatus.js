import { managedPreviewTarget } from "@local/studio-terminal-core/shared";
import {
  createPreviewIdentityGrant,
  previewAuthIdentityAvailable
} from "@local/vibe64-core/server/previewAuth";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { vibe64Result } from "./terminalShared.js";
import { inspectVibe64OutputsForContext, normalizedRuntimeRequirements } from "./vibe64OutputTargets.js";
import { listOutputResults } from "./outputResults.js";
import {
  previewAuthForLaunchTerminal,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewIdentitySelection
} from "./launchPreviewAuth.js";
import { outputTargetFromMetadata, previewStopState } from "./outputTargetMetadata.js";
import { launchTerminalIsRunning } from "./launchPreviewReadiness.js";
import { outputStatusResponseFromPreviewStatus } from "./launchPreviewStatus.js";
import { readLatestPreviewDiagnostic } from "./launchPreviewDiagnostics.js";
import { readLaunchContext, listOutputTargets } from "./outputTargetLaunchContext.js";

/** @typedef {import("./types.js").OutputTargetTerminalState} OutputTargetTerminalState */
/** @typedef {import("./types.js").OutputTargetLaunchCoordination} OutputTargetLaunchCoordination */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

/**
 * What a session's outputs show: the launch status, the open target, the
 * Preview identity grant and the targets a usage recording may launch.
 * @param {object} dependencies
 * @param {OutputTargetTerminalState} dependencies.state
 * @param {OutputTargetLaunchCoordination} dependencies.launchCoordination
 * @param {ProjectService} dependencies.project
 */
function createOutputTargetLaunchStatus({
  state,
  launchCoordination,
  project,
  runCommand
}) {
  /**
   * The launch status of the session's outputs; launchStatus reads it under
   * the start lock and the session's admission.
   */
  async function readLaunchStatus(sessionId, options) {
    const context = await readLaunchContext(project, sessionId);
    const unavailable = launchCoordination.launchAdmissionFailure(sessionId, context.session);
    if (unavailable) {
      return unavailable;
    }
    const outputTargets = await listOutputTargets(context);
    const [previewStatus, outputRuns] = await Promise.all([
      launchCoordination.resolvePreviewStatus(sessionId, context, outputTargets, options),
      listOutputResults(context.session)
    ]);
    const response = outputStatusResponseFromPreviewStatus({
      outputRuns,
      outputTargets,
      previewStatus,
      previewApplicationIdentities: context.previewApplicationIdentities
    });
    const stopState = previewStopState(context.session.metadata);
    if (stopState.stopped) response.preview.stoppedIntent = true;
    if (stopState.stopped && !launchTerminalIsRunning(previewStatus.activeTerminal || {})) {
      response.preview.state = stopState.error ? "failed" : "stopped";
      response.preview.message = stopState.error || "Preview is stopped. Start it to run the application.";
    }
    const testRun = state.previewTestRuns.get(sessionId);
    if (testRun) response.previewTestRun = { targetId: testRun.targetId, state: testRun.state };
    if (!["ready", "starting"].includes(response.preview.state) && !launchTerminalIsRunning(previewStatus.activeTerminal || {})) {
      const diagnostic = await readLatestPreviewDiagnostic(context.session);
      if (diagnostic?.sessionId === sessionId && diagnostic.status === "failed" &&
          diagnostic.error?.code === "vibe64_capacity_rejected" &&
          /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/u.test(diagnostic.error.resourceAdmissionId || "") &&
          outputTargets.some((target) => target.id === diagnostic.outputTargetId)) {
        response.resourceAdmissionId = diagnostic.error.resourceAdmissionId;
        response.preview.state = "failed";
        response.preview.message = diagnostic.error.message;
      }
    }
    return response;
  }

  async function launchStatus(sessionId, options = {}) {
    return vibe64Result(async () => launchCoordination.withLaunchStartLock(sessionId, () => (
      launchCoordination.withLaunchAdmission(sessionId, () => readLaunchStatus(sessionId, options))
    )));
  }

  async function selectPreviewIdentity(sessionId, input = {}, options = {}) {
    return vibe64Result(async () => {
      const status = await launchStatus(sessionId, options);
      if (status?.ok === false) {
        const error = new Error(status.error || "Preview identity is unavailable.");
        error.code = status.code || "vibe64_preview_identity_unavailable";
        throw error;
      }
      const unavailable = launchCoordination.launchAdmissionFailure(sessionId);
      if (unavailable) {
        return unavailable;
      }
      if (!["ready", "stale"].includes(String(status.preview?.state || ""))) {
        throw vibe64Error(
          status.preview?.message || "Run the preview before selecting an identity.",
          "vibe64_preview_identity_preview_not_ready"
        );
      }
      const previewAuth = previewAuthForLaunchTerminal(status.activeTerminal || {}, {
        sessionId,
        targetHref: status.preview.targetHref
      });
      if (!previewAuthIdentityAvailable(previewAuth || {})) {
        throw vibe64Error(
          "This preview does not support application identity switching.",
          "vibe64_preview_application_identity_unsupported"
        );
      }
      const identity = previewIdentitySelection(input, {
        identities: status.previewIdentity?.identities || []
      });
      return {
        grant: createPreviewIdentityGrant(previewAuth, identity.selection),
        ok: true,
        requestedIdentity: identity.requestedIdentity
      };
    });
  }

  /**
   * Runs the application's identity command for a configured identity, as the preview's sign-in does, and
   * says whether the application accepted it. An AI task's check uses it, so no browser takes part.
   * @param {string} sessionId
   * @param {{ identityName: string }} input
   */
  async function verifyPreviewIdentity(sessionId, { identityName }) {
    return vibe64Result(async () => {
      const status = await launchStatus(sessionId);
      if (status?.ok === false) {
        throw vibe64Error(status.error || "Preview identity is unavailable.", status.code || "vibe64_preview_identity_unavailable");
      }
      if (!["ready", "stale"].includes(String(status.preview?.state || ""))) {
        throw vibe64Error(
          status.preview?.message || "Run the preview before selecting an identity.",
          "vibe64_preview_identity_preview_not_ready"
        );
      }
      const runner = previewIdentityCommandRunnerForLaunchTerminal({
        context: await readLaunchContext(project, sessionId),
        runCommand,
        targetHref: status.preview.targetHref,
        terminal: status.activeTerminal || null
      });
      if (!runner) {
        throw vibe64Error(
          "This preview does not support application identity switching.",
          "vibe64_preview_application_identity_unsupported"
        );
      }
      const identity = previewIdentitySelection({ identityName, mode: "identity" }, {
        identities: status.previewIdentity?.identities || []
      });
      const result = await runner(identity.selection);
      if (result?.ok !== true) {
        throw vibe64Error(
          String(result?.error || "Application preview identity was rejected."),
          String(result?.code || "vibe64_preview_identity_application_rejected")
        );
      }
      return { ok: true };
    });
  }

  /**
   * The Output targets a usage recording may launch, with their declared
   * runtimes, and which web target a Preview restart runs.
   */
  async function usageRecordingTargets(sessionId) {
    return vibe64Result(async () => {
      const context = await readLaunchContext(project, sessionId);
      // One composition of the Stack's outputs serves the declared targets and their launch views.
      const inspection = inspectVibe64OutputsForContext(context);
      const [outputs, targets] = await Promise.all([
        inspection,
        listOutputTargets(context, { outputs: inspection })
      ]);
      const declared = new Map((outputs.targets || []).map((target) => [target.id, target]));
      const saved = outputTargetFromMetadata(context.session?.metadata || {});
      const isWeb = (target) => target?.presentation?.kind === "web";
      const previewTarget = targets.find((target) => target.id === saved?.id && isWeb(target) && target.available !== false) ||
        managedPreviewTarget(targets);
      return {
        ok: true,
        previewTargetId: String(previewTarget?.id || ""),
        targets: targets.map((target) => ({
          available: target.available !== false,
          disabledReason: target.disabledReason || "",
          id: target.id,
          label: target.label,
          parameters: (declared.get(target.id)?.parameters || []).map(({ default: defaultValue, id, label, required }) => ({
            ...(defaultValue !== undefined ? { default: defaultValue } : {}),
            id,
            label,
            required: required === true
          })),
          runtimes: normalizedRuntimeRequirements(declared.get(target.id)?.runtimeRequirements),
          web: isWeb(target)
        }))
      };
    });
  }

  async function openOutputTarget(sessionId) {
    return vibe64Result(async () => {
      const status = await launchStatus(sessionId);
      if (status?.ok === false) {
        return status;
      }
      const unavailable = launchCoordination.launchAdmissionFailure(sessionId);
      if (unavailable) {
        return unavailable;
      }
      if (!status.openTarget.available) {
        return {
          ok: false,
          error: status.openTarget.disabledReason
        };
      }
      return {
        ok: true,
        target: status.openTarget
      };
    });
  }

  return Object.freeze({
    launchStatus,
    selectPreviewIdentity,
    verifyPreviewIdentity,
    usageRecordingTargets,
    openOutputTarget
  });
}

export {
  createOutputTargetLaunchStatus
};
