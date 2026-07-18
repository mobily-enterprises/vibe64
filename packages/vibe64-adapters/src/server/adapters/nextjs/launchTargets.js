import {
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  detectPackageManager,
  packageBinCommand,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  launchTargetWithStartupArgsOption,
  startupArgsFromLaunchInput
} from "../../launchPreviewOptions.js";
function launchModeForTarget(launchTargetId = "") {
  return launchTargetId === "dev" ? "development" : "production";
}

function nextCommandOrPackageScript(packageJson = {}, packageManagerName = "npm", {
  args = [],
  binArgs = [],
  scriptName = ""
} = {}) {
  return packageScript(packageJson, scriptName)
    ? runScriptCommand(packageManagerName, scriptName, args)
    : packageBinCommand(packageManagerName, "next", binArgs.length ? binArgs : [scriptName, ...args]);
}

function nextjsLaunchTarget(id, label) {
  return launchTargetWithStartupArgsOption({
    ...(id === "dev" ? { defaultPreview: true } : {}),
    id,
    label
  });
}

async function listNextjsLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath || !await readPackageJson(worktreePath)) {
    return [];
  }
  return [
    nextjsLaunchTarget("built", "Run built version"),
    nextjsLaunchTarget("dev", "Run dev version")
  ];
}

async function createNextjsLaunchDescriptor({
  launchInput = {},
  mode = "production",
  port,
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const buildCommand = nextCommandOrPackageScript(packageJson || {}, packageManager.name, {
    scriptName: "build"
  });
  const serverArgs = [
    "-H",
    "0.0.0.0",
    "-p",
    String(port),
    ...startupArgsFromLaunchInput(launchInput)
  ];
  const serverCommand = mode === "development"
    ? nextCommandOrPackageScript(packageJson || {}, packageManager.name, {
        args: serverArgs,
        scriptName: "dev"
      })
    : nextCommandOrPackageScript(packageJson || {}, packageManager.name, {
        args: serverArgs,
        scriptName: "start"
      });

  return {
    commands: [
      mode === "production"
        ? {
            command: buildCommand,
            label: "Building Next.js app.",
            networkEnv: false
          }
        : null,
      {
        command: serverCommand,
        label: "Starting Next.js launch server.",
        networkEnv: true
      }
    ].filter(Boolean),
    metadata: {
      buildCommand: mode === "production" ? buildCommand : "",
      commandSource: "next",
      mode,
      packageManager: packageManager.name,
      serverCommand
    },
    runtimes: ["node26"],
    urlPath: "/"
  };
}

function createNextjsLaunchTargetTerminalSpec({
  context = {},
  launchInput = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown Next.js launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const launchTargetRoot = targetRoot || session.targetRoot || "";
  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "nextjs",
    launchTarget: context.launchTarget || nextjsLaunchTarget(launchTargetId, launchTargetId),
    resolveLaunch: ({ port, worktreePath }) => createNextjsLaunchDescriptor({
      config: context.config || session.config || {},
      launchInput,
      mode: launchModeForTarget(launchTargetId),
      port,
      targetRoot: launchTargetRoot,
      worktreePath
    }),
    session,
    targetRoot: launchTargetRoot
  });
}

export {
  createNextjsLaunchTargetTerminalSpec,
  createNextjsLaunchDescriptor,
  listNextjsLaunchTargets
};
