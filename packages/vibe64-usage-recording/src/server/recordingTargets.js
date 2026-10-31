import { recordingError } from "./recordingError.js";
import { recordingUnavailableReason, usageTracersForRuntimes } from "./tracers/index.js";

/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

/**
 * The targets a session can record: its Preview and its other Output targets,
 * each with the tracers its runtimes have and why it cannot be recorded.
 * @param {object} dependencies
 * @param {TerminalsService} dependencies.terminals
 */
function createRecordingTargets({ terminals }) {
  async function targetsFor(context) {
    const result = await terminals.usageRecordingTargets(context.sessionId);
    if (result?.ok === false) {
      throw recordingError(422, result.error || "This session's Output targets cannot be read.", result.code || "vibe64_usage_recording_targets_unavailable");
    }
    const describe = (outputTarget, { id, kind, label }) => {
      const runtimes = [...outputTarget.runtimes];
      const tracers = usageTracersForRuntimes(runtimes).map((tracer) => ({
        tracer,
        prepared: tracer.prepare({ recordingDirectory: "", sourceRoot: context.sourceRoot, recordingId: "", targetKind: kind })
      }));
      const ready = tracers.filter(({ prepared }) => prepared.available);
      const reason = !outputTarget.available
        ? outputTarget.disabledReason || "This Output target is unavailable."
        : tracers.length === 0
          ? recordingUnavailableReason(runtimes)
          : ready.length === 0 ? tracers.map(({ prepared }) => prepared.reason).join(" ") : "";
      return {
        id,
        kind,
        label,
        runtimes,
        available: !reason,
        reason,
        parameters: kind === "web" ? [] : outputTarget.parameters.map(({ id: parameterId, label: parameterLabel, required }) => ({
          id: parameterId, label: parameterLabel, required: required === true
        })),
        outputTarget
      };
    };
    const outputTargets = Array.isArray(result?.targets) ? result.targets : [];
    const preview = outputTargets.find((target) => target.web && target.id === result.previewTargetId);
    return [
      ...(preview ? [describe(preview, { id: "preview", kind: "web", label: "Preview" })] : []),
      ...outputTargets.filter((target) => !target.web)
        .map((target) => describe(target, { id: `output:${target.id}`, kind: "terminal", label: target.label }))
    ];
  }

  return Object.freeze({ targetsFor });
}

export { createRecordingTargets };
