import crypto from "node:crypto";
import path from "node:path";

import {
  inspectVibe64Outputs,
  inspectVibe64WorkspaceSetup
} from "@local/vibe64-genesis/server";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  shellQuote
} from "@local/vibe64-execution/server";
import {
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  terminalNoGithubActorMetadata
} from "@local/studio-terminal-core/server/terminalOwnership";

const OUTPUT_RESULTS_READY_MARKER_PREFIX = "VIBE64_OUTPUT_RESULTS_READY_V1";
const VIBE64_RUNTIME_PACKS = Object.freeze({
  bubblewrap: ["bubblewrap"],
  bun: ["bun"],
  composer: ["composer"],
  cpp: ["cpp"],
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
    label: String(target.label || target.id || "").trim(),
    mode: String(target.mode || "").trim(),
    presentation
  };
}

function vibe64OutputSourceRoot(context = {}) {
  return sessionSourcePath(context.session || {});
}

async function inspectVibe64ForContext(context = {}, inspect, unconfigured) {
  const sourceRoot = vibe64OutputSourceRoot(context);
  if (!sourceRoot) {
    return unconfigured;
  }
  try {
    return await inspect({
      environment: {
        ...(await context.runtime?.resolvePromptEnvironment() || process.env),
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

async function inspectVibe64OutputsForContext(context = {}, {
  inspect = inspectVibe64Outputs
} = {}) {
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

async function inspectVibe64WorkspaceSetupForContext(context = {}, {
  inspect = inspectVibe64WorkspaceSetup
} = {}) {
  return inspectVibe64ForContext(context, inspect, {
    recipeHash: "",
    status: "unconfigured",
    steps: []
  });
}

async function listVibe64OutputTargets(context = {}, options = {}) {
  const outputs = await inspectVibe64OutputsForContext(context, options);
  return (Array.isArray(outputs?.targets) ? outputs.targets : [])
    .map(vibe64OutputTargetView)
    .filter((target) => target.id && target.label);
}

function vibe64OutputCommand(argv = [], {
  host = "127.0.0.1",
  port = ""
} = {}) {
  return (Array.isArray(argv) ? argv : [])
    .map((argument) => String(argument)
      .replaceAll("{host}", String(host))
      .replaceAll("{port}", String(port)))
    .map(shellQuote)
    .join(" ");
}

function outputResultsReadyMarker() {
  return `[[${OUTPUT_RESULTS_READY_MARKER_PREFIX}:${crypto.randomBytes(24).toString("hex")}]]`;
}

function outputResultsMarkerCommand(marker = "") {
  return `printf '\\n%s\\n' ${shellQuote(marker)}`;
}

function vibe64WebOutputDescriptor(target = {}, {
  host = "127.0.0.1",
  marker = "",
  port,
  worktreePath
} = {}) {
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const previewIdentityRuntime = vibe64RuntimePacks(target.previewIdentity?.runtimes);
  const commands = (Array.isArray(target.steps) ? target.steps : []).flatMap((step) => {
    const command = vibe64OutputCommand(step.argv, { host, port });
    const entry = {
      command,
      commandPreview: command,
      label: String(step.label || "").trim(),
      networkEnv: step.role === "run"
    };
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
      outputMode: target.mode,
      outputPresentationKind: "web",
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

function genericOutputStartupScript(target = {}, marker = "") {
  const steps = Array.isArray(target.steps) ? target.steps : [];
  const lines = ["set -e"];
  for (const step of steps) {
    if (step.role === "run") {
      continue;
    }
    const command = vibe64OutputCommand(step.argv);
    lines.push(
      `printf '\\n[vibe64] %s\\n' ${shellQuote(String(step.label || step.role || "Step"))}`,
      `printf '[vibe64] $ %s\\n\\n' ${shellQuote(command)}`,
      command
    );
  }
  if (marker) {
    lines.push(outputResultsMarkerCommand(marker));
  }
  const run = steps.find(({ role }) => role === "run");
  if (run) {
    const command = vibe64OutputCommand(run.argv);
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
  const relativeWorkdir = path.relative(resolvedWorktreeRoot, workdir);
  if (relativeWorkdir === ".."
    || relativeWorkdir.startsWith(`..${path.sep}`)
    || path.isAbsolute(relativeWorkdir)) {
    return {
      ok: false,
      message: "Output command workdir is outside the session source."
    };
  }
  const marker = outputResultsReadyMarker();
  const runtime = vibe64RuntimePacks(target.runtimeRequirements);
  const script = genericOutputStartupScript(target, marker);
  return {
    args: ["-lc", script],
    command: "bash",
    commandPreview: (Array.isArray(target.steps) ? target.steps : [])
      .map((step) => vibe64OutputCommand(step.argv))
      .join("\n"),
    cwd: workdir,
    env: {},
    metadata: {
      outputDownloads: structuredClone(target.downloads || []),
      outputMode: target.mode,
      outputPresentationKind: target.presentation?.kind || "none",
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

async function createVibe64OutputTargetTerminalSpec({
  context = {},
  outputTargetId = ""
} = {}, options = {}) {
  const outputs = await inspectVibe64OutputsForContext(context, options);
  const targetId = String(outputTargetId || "").trim();
  const target = (Array.isArray(outputs?.targets) ? outputs.targets : [])
    .find((entry) => entry.id === targetId);
  if (!target) {
    return {
      ok: false,
      message: `Unknown Vibe64 output target: ${targetId || "(empty)"}.`
    };
  }
  const targetView = vibe64OutputTargetView(target);
  if (!targetView.available) {
    return {
      ok: false,
      message: targetView.disabledReason
    };
  }
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
  const spec = await createVibe64WebLaunchTargetTerminalSpec({
    launchTarget: {
      id: targetView.id,
      label: targetView.label
    },
    preferredPort: target.presentation.preferredPort || undefined,
    resolveLaunch: ({ port, worktreePath }) => vibe64WebOutputDescriptor(target, {
      marker,
      port,
      worktreePath
    }),
    session: context.session || {}
  });
  if (spec?.ok !== false) {
    spec.stackHash = outputs.stackHash;
    spec.resourceWorkflow = resourceWorkflowRecipe(target, outputs.resourceEstimates);
    spec.metadata = {
      ...(spec.metadata || {}),
      outputTargetId: targetView.id,
      outputTargetLabel: targetView.label
    };
    delete spec.metadata.launchTargetId;
    delete spec.metadata.launchTargetLabel;
  }
  return spec;
}

function resourceWorkflowRecipe(target, estimates) {
  return {
    operation: { kind: "output", targetId: target.id },
    runtimes: vibe64RuntimePacks(target.runtimeRequirements).runtimes,
    steps: target.steps.map((step) => ({ argv: step.argv, role: step.role, workdir: target.workdir || "." })),
    configuration: { mode: target.mode, presentation: target.presentation?.kind || "none" },
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

export {
  OUTPUT_RESULTS_READY_MARKER_PREFIX,
  VIBE64_RUNTIME_PACKS,
  createVibe64GenericOutputTargetTerminalSpec,
  createVibe64OutputTargetTerminalSpec,
  genericOutputStartupScript,
  inspectVibe64OutputsForContext,
  inspectVibe64WorkspaceSetupForContext,
  listVibe64OutputTargets,
  outputResultsMarkerLineSeen,
  vibe64OutputCommand,
  vibe64OutputTargetView,
  vibe64RuntimePacks,
  vibe64WebOutputDescriptor
};
