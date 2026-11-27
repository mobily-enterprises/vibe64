import crypto from "node:crypto";
import path from "node:path";
import { pathInsideOrEqual } from "@local/vibe64-core/server/core";

import {
  inspectVibe64Outputs,
  resolveVibe64OutputParameters
} from "@local/vibe64-genesis/server";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  createVibe64WebLaunchTargetTerminalSpec
} from "./launchTargetTerminal.js";
import {
  terminalNoGithubActorMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

const OUTPUT_RESULTS_READY_MARKER_PREFIX = "VIBE64_OUTPUT_RESULTS_READY_V1";
const OUTPUT_PREPARE_DONE_MARKER_PREFIX = "VIBE64_OUTPUT_PREPARE_DONE_V1";
const VIBE64_RUNTIME_PACKS = Object.freeze({
  awsebcli: ["awsebcli"],
  bubblewrap: ["bubblewrap"],
  bun: ["bun"],
  composer: ["composer"],
  cpp: ["cpp"],
  csharp: ["csharp"],
  go: ["go"],
  java: ["java"],
  kotlin: ["java", "kotlin"],
  python: ["python"],
  ruby: ["ruby"],
  rust: ["rust", "cpp"],
  sqlite: ["sqlite"],
  git: ["git"],
  mariadb: ["mariadb"],
  mysql: ["mysql"],
  nodejs: ["node26"],
  php: ["php"],
  playwright: ["playwright"],
  postgresql: ["postgresql"],
  ripgrep: ["ripgrep"],
  shell: []
});

function normalizedRuntimeRequirements(values = []) {
  return [...new Set((Array.isArray(values) ? values : [])
    .map((value) => String(value || "").trim())
    .filter(Boolean))];
}

function vibe64RuntimePacks(values = []) {
  const requirements = normalizedRuntimeRequirements(values);
  const unsupported = requirements.filter((requirement) => !Object.hasOwn(VIBE64_RUNTIME_PACKS, requirement));
  return {
    available: unsupported.length === 0,
    disabledReason: unsupported.length === 0
      ? ""
      : `Vibe64 does not provide a pinned runtime for: ${unsupported.join(", ")}.`,
    runtimes: [...new Set(requirements.flatMap((requirement) => VIBE64_RUNTIME_PACKS[requirement] || []))],
    unsupported
  };
}

function vibe64OutputTargetView(target = {}) {
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const previewIdentityRuntime = vibe64RuntimePacks(target.previewIdentity?.runtimes);
  const available = target.available !== false && runtime.available && previewIdentityRuntime.available;
  const presentation = target.presentation && typeof target.presentation === "object"
    ? { kind: String(target.presentation.kind || "").trim() }
    : null;
  return {
    available,
    ...(target.default === true ? { default: true } : {}),
    disabledReason: available
      ? ""
      : String(
        target.disabledReason ||
        runtime.disabledReason ||
        previewIdentityRuntime.disabledReason ||
        "This output target is unavailable."
      ).trim(),
    downloads: (Array.isArray(target.downloads) ? target.downloads : []).map((download) => ({
      id: String(download?.id || "").trim(),
      mediaType: String(download?.mediaType || "application/octet-stream").trim(),
      name: String(download?.name || download?.id || "download").trim()
    })).filter(({ id }) => Boolean(id)),
    id: String(target.id || "").trim(),
    ...(target.previewIdentity?.identityTypes?.length
      ? { identityTypes: [...target.previewIdentity.identityTypes] }
      : {}),
    label: String(target.label || target.id || "").trim(),
    mode: String(target.mode || "").trim(),
    ...(target.dataMode ? { dataMode: target.dataMode } : {}),
    presentation,
    ...(target.parameters?.length ? { parameters: structuredClone(target.parameters) } : {})
  };
}

function vibe64OutputSourceRoot(context = {}) {
  return sessionSourcePath(context.session || {});
}

async function inspectVibe64ForContext(context, inspect, unconfigured) {
  const sourceRoot = vibe64OutputSourceRoot(context);
  if (!sourceRoot) {
    return unconfigured;
  }
  try {
    return await inspect({
      session: context.session,
      environment: {
        ...(await context.runtime.resolvePromptEnvironment()),
        ...(context.projectEnvironment || {})
      },
      projectRoot: sourceRoot
    });
  } catch (error) {
    if (String(error?.code || "").trim() === "STACK_REQUIRED") {
      return unconfigured;
    }
    throw error;
  }
}

async function inspectVibe64OutputsForContext(context = {}, options = {}) {
  const {
    inspect = inspectVibe64Outputs
  } = options;
  const outputs = await inspectVibe64ForContext(context, inspect, {
    status: "unconfigured",
    targets: []
  });
  if (outputs.status === "blocked" && outputs.targets.length === 0) {
    const error = new Error(outputs.diagnostics.map(({ message }) => message).join(" "));
    error.code = outputs.diagnostics[0].code;
    throw error;
  }
  return outputs;
}

/**
 * The session source's workspace setup, inspected by the context's project; a source without a Stack is unconfigured.
 * @param {{ project: ProjectService }} context a launch context
 */
async function inspectVibe64WorkspaceSetupForContext(context) {
  return inspectVibe64ForContext(context, context.project.inspectWorkspaceSetup, {
    recipeHash: "",
    status: "unconfigured",
    steps: []
  });
}

/**
 * The session's Output targets as launch views. `options.outputs` is an
 * inspection the caller has already made (its promise or result), so one
 * composition of the Stack's outputs serves both; otherwise they are inspected.
 */
async function listVibe64OutputTargets(context = {}, options = {}) {
  const outputs = await (options.outputs || inspectVibe64OutputsForContext(context, options));
  const estimates = outputs?.resourceEstimates?.status === "ready" ? outputs.resourceEstimates.outputs : [];
  return (Array.isArray(outputs?.targets) ? outputs.targets : [])
    .map((target) => {
      const view = vibe64OutputTargetView(target);
      if (!outputTargetServesWorkers(target)) return view;
      // A browser-test run sizes its app servers by the peak the last run's recorded in the target's folder, else by
      // its Running high estimate (outputTargetPreviewTests.js, browserTestWorkers.js).
      const runningHighBytes = estimates.find((estimate) => estimate.targetId === view.id)?.running?.highBytes;
      return {
        ...view,
        servesWorkers: true,
        workdir: String(target.workdir || ".").trim() || ".",
        ...(runningHighBytes ? { runningHighBytes } : {})
      };
    })
    .filter((target) => target.id && target.label);
}

function vibe64OutputCommand(argv = [], options = {}) {
  const {
    host = "127.0.0.1",
    port = "",
    parameters = {},
    workers = 1
  } = options;
  const values = { host, port, workers };
  return (Array.isArray(argv) ? argv : [])
    .map((argument) => String(argument)
      .replace(/\{(host|port|workers|parameter:([a-z0-9]+(?:-[a-z0-9]+)*))\}/gu, (_match, placeholder, id) => {
        if (id) {
          if (!Object.hasOwn(parameters, id)) throw new Error(`Missing output parameter: ${id}.`);
          return parameters[id];
        }
        return String(values[placeholder]);
      }))
    .map(shellQuote)
    .join(" ");
}

function outputResultsReadyMarker() {
  return `[[${OUTPUT_RESULTS_READY_MARKER_PREFIX}:${crypto.randomBytes(24).toString("hex")}]]`;
}

/**
 * The line a target's last Prepare step prints once its Prepare steps succeeded, "" for a target without any: a restart
 * waits for it rather than cutting a Prepare step (a migration, a seed) part way, and a Stop before it says so.
 * @param {Array<{ role: string }>} steps
 */
function outputPrepareMarker(steps = []) {
  return steps.some(({ role }) => role === "prepare")
    ? `[[${OUTPUT_PREPARE_DONE_MARKER_PREFIX}:${crypto.randomBytes(24).toString("hex")}]]`
    : "";
}

function outputResultsMarkerCommand(marker = "") {
  return `printf '\\n%s\\n' ${shellQuote(marker)}`;
}

function vibe64WebOutputDescriptor(target = {}, options = {}) {
  const {
    host = "127.0.0.1",
    marker = "",
    port,
    workers = 1,
    worktreePath
  } = options;
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const previewIdentityRuntime = vibe64RuntimePacks(target.previewIdentity?.runtimes);
  const steps = Array.isArray(target.steps) ? target.steps : [];
  const prepareMarker = outputPrepareMarker(steps);
  const lastPrepare = steps.findLastIndex(({ role }) => role === "prepare");
  const commands = steps.flatMap((step, index) => {
    const command = vibe64OutputCommand(step.argv, { host, port, parameters: target.parameterValues, workers });
    const entry = {
      command,
      commandPreview: command,
      label: String(step.label || "").trim(),
      networkEnv: step.role === "run"
    };
    if (index === lastPrepare) {
      return [entry, { command: outputResultsMarkerCommand(prepareMarker), networkEnv: false, quiet: true }];
    }
    return step.role === "run" && marker
      ? [
          {
            command: outputResultsMarkerCommand(marker),
            commandPreview: "Record declared downloads",
            label: "Build results ready",
            networkEnv: false
          },
          entry
        ]
      : [entry];
  });
  return {
    commands,
    metadata: {
      outputDownloads: structuredClone(target.downloads || []),
      outputParameters: target.parameterValues || {},
      outputMode: target.mode,
      // A test-data target's identity command opens only its test database (launchPreviewAuth.js).
      ...(target.dataMode ? { outputDataMode: target.dataMode } : {}),
      outputPresentationKind: "web",
      ...(prepareMarker ? { outputPrepareMarker: prepareMarker } : {}),
      outputResultsMarker: marker,
      vibe64OutputsSource: String(target.source || "").trim(),
      vibe64RuntimeRequirements: normalizedRuntimeRequirements(target.runtimeRequirements)
    },
    previewIdentity: target.previewIdentity
      ? {
          ...target.previewIdentity,
          runtimes: previewIdentityRuntime.runtimes
        }
      : null,
    readiness: target.presentation?.readiness || null,
    runtimes: runtime.runtimes,
    urlPath: String(target.presentation?.urlPath || "/").trim() || "/",
    workdir: path.resolve(worktreePath, String(target.workdir || ".").trim() || ".")
  };
}

function genericOutputStartupScript(target = {}, marker = "", prepareMarker = "") {
  const steps = Array.isArray(target.steps) ? target.steps : [];
  const lastPrepare = steps.findLastIndex(({ role }) => role === "prepare");
  // The login shell may have reordered PATH (macOS path_helper); restore the
  // tool PATH Vibe64 resolved when it provides one.
  const lines = ["set -e", "if [ -n \"${VIBE64_TOOL_PATH:-}\" ]; then export PATH=\"$VIBE64_TOOL_PATH\"; fi"];
  for (const [index, step] of steps.entries()) {
    if (step.role === "run") {
      continue;
    }
    const command = vibe64OutputCommand(step.argv, { parameters: target.parameterValues });
    lines.push(
      `printf '\\n[vibe64] %s\\n' ${shellQuote(String(step.label || step.role || "Step"))}`,
      `printf '[vibe64] $ %s\\n\\n' ${shellQuote(command)}`,
      command
    );
    if (index === lastPrepare) lines.push(outputResultsMarkerCommand(prepareMarker));
  }
  if (marker) {
    lines.push(outputResultsMarkerCommand(marker));
  }
  const run = steps.find(({ role }) => role === "run");
  if (run) {
    const command = vibe64OutputCommand(run.argv, { parameters: target.parameterValues });
    lines.push(
      `printf '\\n[vibe64] %s\\n' ${shellQuote(String(run.label || "Run"))}`,
      `printf '[vibe64] $ %s\\n\\n' ${shellQuote(command)}`,
      `exec ${command}`
    );
  }
  return lines.join("\n");
}

function createVibe64GenericOutputTargetTerminalSpec({
  session = {},
  target = {},
  targetView = {}
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the session clone before running this output target."
    };
  }
  const resolvedWorktreeRoot = path.resolve(worktreePath);
  const workdir = path.resolve(resolvedWorktreeRoot, String(target.workdir || ".").trim() || ".");
  if (!pathInsideOrEqual(resolvedWorktreeRoot, workdir)) {
    return {
      ok: false,
      message: "Output command workdir is outside the session source."
    };
  }
  const marker = outputResultsReadyMarker();
  const prepareMarker = outputPrepareMarker(Array.isArray(target.steps) ? target.steps : []);
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const script = genericOutputStartupScript(target, marker, prepareMarker);
  return {
    args: ["-lc", script],
    command: "bash",
    commandPreview: (Array.isArray(target.steps) ? target.steps : [])
      .map((step) => vibe64OutputCommand(step.argv, { parameters: target.parameterValues }))
      .join("\n"),
    cwd: workdir,
    env: {},
    metadata: {
      outputDownloads: structuredClone(target.downloads || []),
      outputParameters: target.parameterValues || {},
      outputMode: target.mode,
      outputPresentationKind: target.presentation?.kind || "none",
      ...(prepareMarker ? { outputPrepareMarker: prepareMarker } : {}),
      outputResultsMarker: marker,
      outputTargetId: targetView.id,
      outputTargetLabel: targetView.label,
      runRoot: workdir,
      scope: "session",
      sessionId: session.sessionId || "",
      sessionRoot: String(session.sessionRoot || ""),
      sessionSourceRoot: resolvedWorktreeRoot,
      vibe64OutputsSource: String(target.source || "").trim(),
      vibe64RuntimeRequirements: normalizedRuntimeRequirements(target.runtimeRequirements),
      ...terminalNoGithubActorMetadata({
        ownerUserKey: "output-target",
        reason: "output-target"
      })
    },
    ok: true,
    readinessMarker: marker,
    runtimes: runtime.runtimes,
    reuseRunning: target.mode === "interactive"
  };
}

/**
 * @param {{ context?: object, outputTargetId?: string, outputParameters?: object, workers?: number }} request `workers`:
 *   the app servers a browser-test run asks a test target for (browserTestWorkers.js); a target whose Run step takes
 *   no {workers} always serves one
 */
async function createVibe64OutputTargetTerminalSpec({
  context = {},
  outputTargetId = "",
  outputParameters,
  workers = 1
} = {}, options = {}) {
  const outputs = await inspectVibe64OutputsForContext(context, options);
  const targetId = String(outputTargetId || "").trim();
  const declaredTarget = (Array.isArray(outputs?.targets) ? outputs.targets : [])
    .find((entry) => entry.id === targetId);
  if (!declaredTarget) {
    return {
      ok: false,
      message: `Unknown Vibe64 output target: ${targetId || "(empty)"}.`
    };
  }
  const targetView = vibe64OutputTargetView(declaredTarget);
  if (!targetView.available) {
    return {
      ok: false,
      message: targetView.disabledReason
    };
  }
  const target = {
    ...declaredTarget,
    parameterValues: resolveVibe64OutputParameters(declaredTarget, outputParameters)
  };
  if (target.presentation?.kind !== "web") {
    return {
      ...createVibe64GenericOutputTargetTerminalSpec({
        session: context.session || {},
        target,
        targetView
      }),
      stackHash: outputs.stackHash,
      resourceWorkflow: resourceWorkflowRecipe(target, outputs.resourceEstimates)
    };
  }
  const marker = outputResultsReadyMarker();
  const serverCount = outputTargetServesWorkers(target) ? Math.max(1, workers) : 1;
  const spec = await createVibe64WebLaunchTargetTerminalSpec({
    launchTarget: {
      id: targetView.id,
      label: targetView.label
    },
    preferredPort: target.presentation.preferredPort || undefined,
    resolveLaunch: ({ port, worktreePath }) => vibe64WebOutputDescriptor(target, {
      marker,
      port,
      workers: serverCount,
      worktreePath
    }),
    session: context.session || {},
    workers: serverCount
  });
  if (spec?.ok === false) {
    return spec;
  }
  const metadata = {
    ...(spec.metadata || {}),
    outputTargetId: targetView.id,
    outputTargetLabel: targetView.label
  };
  delete metadata.launchTargetId;
  delete metadata.launchTargetLabel;
  return {
    ...spec,
    stackHash: outputs.stackHash,
    resourceWorkflow: resourceWorkflowRecipe(target, outputs.resourceEstimates, serverCount),
    metadata
  };
}

/**
 * Whether a target's Run step takes {workers}: it serves as many app servers as a browser-test run asks for.
 * @param {{ steps?: Array<{ role: string, argv: string[] }> }} target
 */
function outputTargetServesWorkers(target = {}) {
  return (Array.isArray(target.steps) ? target.steps : [])
    .some(({ role, argv }) => role === "run" && argv.some((argument) => String(argument).includes("{workers}")));
}

// A run with several app servers is admitted as one workflow of that many, so a host can scale its memory and task limits.
function resourceWorkflowRecipe(target, estimates, workers = 1) {
  return {
    operation: { kind: "output", targetId: target.id },
    runtimes: vibe64RuntimePacks(target.runtimeRequirements).runtimes,
    steps: target.steps.map((step) => ({ argv: step.argv, role: step.role, workdir: target.workdir || "." })),
    configuration: {
      mode: target.mode,
      presentation: target.presentation?.kind || "none",
      ...(target.parameters?.length ? { parameters: target.parameterValues } : {}),
      ...(workers > 1 ? { workers } : {})
    },
    estimates
  };
}

function outputResultsMarkerLineSeen(output = "", marker = "") {
  if (!marker) {
    return false;
  }
  return String(output || "")
    .split(/\r?\n/u)
    .some((line) => line.trim() === marker);
}

const __testables = Object.freeze({ vibe64OutputCommand, vibe64OutputTargetView, vibe64WebOutputDescriptor });

export {
  createVibe64OutputTargetTerminalSpec,
  inspectVibe64OutputsForContext,
  outputTargetServesWorkers,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64OutputTargets,
  normalizedRuntimeRequirements,
  outputResultsMarkerLineSeen,
  vibe64RuntimePacks,
  __testables
};
