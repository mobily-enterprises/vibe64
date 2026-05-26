import {
  createAiStudioWebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  selectedConfigValue
} from "../../configValues.js";
import {
  VINEXT_REVIEW_MODE_CONFIG
} from "./constants.js";
import {
  detectPackageManager,
  packageBinCommand,
  readPackageJson
} from "./packageManager.js";

function launchModeForTarget(launchTargetId = "") {
  return launchTargetId === "dev" ? "development" : "production";
}

function vinextLaunchTarget(id, label) {
  return {
    id,
    label
  };
}

function reviewMode(config = {}) {
  return selectedConfigValue(config, VINEXT_REVIEW_MODE_CONFIG, new Set(["development", "production"]), "production");
}

function launchTargetIdForMode(mode = "production") {
  return mode === "development" ? "dev" : "built";
}

function reviewLaunchTarget(mode = "production") {
  return mode === "development"
    ? vinextLaunchTarget("dev", "Run dev version")
    : vinextLaunchTarget("built", "Run built version");
}

async function listVinextLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = String(session.metadata?.worktree_path || "").trim();
  if (!worktreePath || !await readPackageJson(worktreePath)) {
    return [];
  }
  return [
    vinextLaunchTarget("built", "Run built version"),
    vinextLaunchTarget("dev", "Run dev version")
  ];
}

async function createVinextLaunchDescriptor({
  mode = "production",
  port,
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const buildCommand = packageBinCommand(packageManager.name, "vinext", ["build"]);
  const serverCommand = mode === "development"
    ? packageBinCommand(packageManager.name, "vinext", ["dev", "--hostname", "0.0.0.0", "--port", String(port)])
    : packageBinCommand(packageManager.name, "vinext", ["start", "--hostname", "0.0.0.0", "--port", String(port)]);

  return {
    commands: [
      mode === "production"
        ? {
            command: buildCommand,
            label: "Building Vinext app.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Vinext launch server.",
        networkEnv: true
      }
    ].filter(Boolean),
    metadata: {
      buildCommand: mode === "production" ? buildCommand : "",
      commandSource: "vinext",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    urlPath: "/"
  };
}

async function createVinextReviewDescriptor({
  config = {},
  port,
  worktreePath = ""
} = {}) {
  const descriptor = await createVinextLaunchDescriptor({
    mode: reviewMode(config),
    port,
    worktreePath
  });
  return {
    ...descriptor,
    commands: descriptor.commands.map((entry) => entry.command === descriptor.metadata.serverCommand
      ? {
          ...entry,
          label: "Starting Vinext review server."
        }
      : entry)
  };
}

function createVinextLaunchTargetTerminalSpec({
  context = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown Vinext launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  return createAiStudioWebLaunchTargetTerminalSpec({
    adapterId: "vinext",
    launchTarget: context.launchTarget || vinextLaunchTarget(launchTargetId, launchTargetId),
    resolveLaunch: ({ port, worktreePath }) => createVinextLaunchDescriptor({
      mode: launchModeForTarget(launchTargetId),
      port,
      worktreePath
    }),
    session,
    targetRoot
  });
}

async function createVinextAppReviewTerminalSpec({
  context = {},
  session = {},
  targetRoot = ""
} = {}) {
  const config = context.config || session.config || {};
  const mode = reviewMode(config);
  const spec = await createAiStudioWebLaunchTargetTerminalSpec({
    adapterId: "vinext",
    launchTarget: reviewLaunchTarget(mode),
    resolveLaunch: ({ port, worktreePath }) => createVinextReviewDescriptor({
      config,
      port,
      worktreePath
    }),
    session,
    targetRoot
  });
  if (!spec.ok) {
    return spec;
  }
  return {
    ...spec,
    metadata: {
      ...spec.metadata,
      appUrl: spec.metadata.targetUrl,
      launchTargetId: spec.metadata.launchTargetId || launchTargetIdForMode(mode)
    }
  };
}

export {
  createVinextAppReviewTerminalSpec,
  createVinextLaunchTargetTerminalSpec,
  createVinextLaunchDescriptor,
  createVinextReviewDescriptor,
  listVinextLaunchTargets
};
