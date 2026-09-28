import { createSchema } from "@jskit-ai/kernel/shared/validators";

const text = { type: "string", maxLength: 512, required: false };
const identity = { type: "string", maxLength: 4096, noTrim: true, required: false };
const terminalFields = {
  id: identity, status: text, createdAt: text, lastOutputAt: text, closeError: text,
  targetId: identity, targetLabel: text, mode: text, presentationKind: text,
  exitCode: { type: "integer", nullable: true, required: false },
  closed: { type: "boolean", required: false }, stale: { type: "boolean", required: false }
};

function terminalSummary(terminal) {
  const fields = { ...terminal, targetId: terminal.metadata?.outputTargetId, targetLabel: terminal.metadata?.outputTargetLabel,
    mode: terminal.metadata?.outputMode, presentationKind: terminal.metadata?.outputPresentationKind };
  return Object.fromEntries(Object.entries(terminalFields).flatMap(([key, schema]) => {
    const value = fields[key];
    if (schema.type === "string" && typeof value === "string") return [[key, schema === identity ? value : value.slice(0, 512)]];
    if (schema.type === "boolean" && typeof value === "boolean") return [[key, value]];
    if (schema.type === "integer" && (value === null || Number.isSafeInteger(value))) return [[key, value]];
    return [];
  }));
}

export function outputTerminalTool(description, { log = false } = {}) {
  return {
    description,
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, error: text, code: text, resourceAdmissionId: identity,
      ...terminalFields,
      ...(log ? { output: { type: "string", noTrim: true, maxLength: 4000, required: true },
        outputTruncated: { type: "boolean", required: true } } : {})
    }) },
    transformResult(result) {
      const output = { ok: result.ok === true, ...terminalSummary(result),
        ...Object.fromEntries(["error", "code", "resourceAdmissionId"].flatMap((key) => typeof result[key] === "string"
          ? [[key, result[key].slice(0, 512)]] : [])) };
      if (log) {
        const content = String(result.output || "");
        output.output = content.slice(-4000);
        output.outputTruncated = result.outputTruncated === true || content.length > 4000;
      }
      return output;
    }
  };
}

export function outputStatusTool() {
  return {
    description: "Inspect this session's declared output targets, actual run/preview state and recent downloadable result identities without starting work. At most ten targets and five newest runs are returned; pass nextTargetOffset as targetOffset or nextRunOffset as runOffset for more. Read one exact outputTargetId to get its complete parameter defaults and current values before a parameterized start/restart. An unfiltered first page with outputTargetCount=0 means no declared output; an exact-id read with no targets means no matching declaration. ok=false is an inspection failure. A running terminal is not web readiness: use preview.state, and use output.state for finite/terminal results. Closing is still in progress. Logs use output-terminal.read with the actual terminal id; delegate code diagnostics to a coding conversation. Identity names are available choices, not the browser's current signed-in identity. Use Colleague navigation.open with project/session and pane=preview to show the existing output UI; this read does not open a browser. Result arrays may be truncated; complete downloadable history is in that UI. Never invent commands, URLs or file paths, and do not submit publicHost/publicProtocol.",
    output: { mode: "replace", schema: createSchema({
      ok: { type: "boolean", required: true }, error: text, code: text, resourceAdmissionId: identity,
      outputTargetCount: { type: "integer", required: false }, targetOffset: { type: "integer", required: false },
      nextTargetOffset: { type: "integer", nullable: true, required: false },
      outputRunCount: { type: "integer", required: false }, runOffset: { type: "integer", required: false },
      nextRunOffset: { type: "integer", nullable: true, required: false },
      activeTerminal: { type: "object", schema: createSchema(terminalFields), required: false },
      output: { type: "object", required: false, schema: createSchema({
        state: text, targetId: identity, mode: text, presentationKind: text, error: text
      }) },
      preview: { type: "object", required: false, schema: createSchema({
        state: text, message: text, reason: text, terminalId: identity,
        canRestart: { type: "boolean", required: false }, canStart: { type: "boolean", required: false }, canShowLog: { type: "boolean", required: false }
      }) },
      previewIdentity: { type: "object", required: false, schema: createSchema({
        available: { type: "boolean", required: true }, disabledReason: text,
        names: { type: "array", items: identity, required: true }, truncated: { type: "boolean", required: true }
      }) },
      outputTargets: { type: "array", required: false, items: createSchema({
        id: identity, label: text, mode: text, presentationKind: text, disabledReason: text,
        available: { type: "boolean", required: true }, default: { type: "boolean", required: true },
        parameterCount: { type: "integer", required: true },
        parameters: { type: "array", required: false, items: createSchema({
          id: identity, label: text, description: text, default: identity,
          required: { type: "boolean", required: true }
        }) },
        currentParameters: { type: "object", additionalProperties: true, required: false }
      }) },
      outputRuns: { type: "array", required: false, items: createSchema({
        id: identity, outputTargetId: identity, terminalSessionId: identity, createdAt: text,
        resultCount: { type: "integer", required: true }, resultsTruncated: { type: "boolean", required: true },
        results: { type: "array", required: true, items: createSchema({
          id: identity, downloadId: identity, name: text, mediaType: text,
          size: { type: "integer", required: false }
        }) }
      }) }
    }) },
    transformResult(result) {
      const output = { ok: result.ok === true,
        ...Object.fromEntries(["error", "code", "resourceAdmissionId"].flatMap((key) => typeof result[key] === "string"
          ? [[key, result[key].slice(0, 512)]] : [])) };
      if (result.activeTerminal) output.activeTerminal = terminalSummary(result.activeTerminal);
      if (result.output) {
        output.output = Object.fromEntries(["state", "targetId", "mode", "presentationKind"].flatMap((key) => typeof result.output[key] === "string"
          ? [[key, key === "targetId" ? result.output[key] : result.output[key].slice(0, 512)]] : []));
        if (result.output.error?.message) output.output.error = String(result.output.error.message).slice(0, 512);
      }
      if (result.preview) output.preview = {
        ...Object.fromEntries(["state", "message", "reason", "terminalId"].flatMap((key) => typeof result.preview[key] === "string"
          ? [[key, key === "terminalId" ? result.preview[key] : result.preview[key].slice(0, 512)]] : [])),
        ...Object.fromEntries(["canRestart", "canStart", "canShowLog"].map((key) => [key, result.preview[key] === true]))
      };
      if (result.previewIdentity) output.previewIdentity = { available: result.previewIdentity.available === true,
        disabledReason: String(result.previewIdentity.disabledReason || "").slice(0, 512),
        names: (result.previewIdentity.identities || []).slice(0, 40).map(identity => identity.name),
        truncated: (result.previewIdentity.identities || []).length > 40 };
      if (result.outputTargets) {
        const targets = result.outputTargets.slice(0, 10);
        output.outputTargetCount = result.outputTargetCount ?? result.outputTargets.length;
        output.targetOffset = result.targetOffset ?? 0;
        output.nextTargetOffset = output.targetOffset + targets.length < output.outputTargetCount ? output.targetOffset + targets.length : null;
        output.outputTargets = targets.map(target => {
          const parameters = target.parameters || [];
          const summary = { id: target.id, label: String(target.label || "").slice(0, 512), mode: target.mode,
            presentationKind: target.presentation?.kind || "none", available: target.available !== false, default: target.default === true,
            disabledReason: String(target.disabledReason || "").slice(0, 512), parameterCount: parameters.length };
          if (result.requestedOutputTargetId === target.id) {
            summary.parameters = parameters.map(parameter => ({ id: parameter.id, required: parameter.required === true,
              default: parameter.default, label: String(parameter.label || "").slice(0, 512), description: String(parameter.description || "").slice(0, 512) }));
            if (result.lastOutputTarget?.id === target.id) summary.currentParameters = Object.fromEntries(parameters
              .filter(parameter => typeof result.lastOutputTarget.outputParameters?.[parameter.id] === "string")
              .map(parameter => [parameter.id, result.lastOutputTarget.outputParameters[parameter.id]]));
          }
          return summary;
        });
      }
      if (result.outputRuns) {
        const runs = result.outputRuns.slice(0, 5);
        output.outputRunCount = result.outputRunCount ?? result.outputRuns.length;
        output.runOffset = result.runOffset ?? 0;
        output.nextRunOffset = output.runOffset + runs.length < output.outputRunCount ? output.runOffset + runs.length : null;
        output.outputRuns = runs.map(run => ({ id: run.id, outputTargetId: run.outputTargetId, terminalSessionId: run.terminalSessionId,
          createdAt: String(run.createdAt || "").slice(0, 512), resultCount: (run.results || []).length, resultsTruncated: (run.results || []).length > 20,
          results: (run.results || []).slice(0, 20).map(result => ({ id: result.id, downloadId: result.downloadId,
            name: String(result.name || "").slice(0, 512), mediaType: String(result.mediaType || "").slice(0, 512), size: result.size })) }));
      }
      return output;
    }
  };
}
