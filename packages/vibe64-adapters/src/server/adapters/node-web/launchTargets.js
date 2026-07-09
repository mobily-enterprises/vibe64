import {
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  detectPackageManager,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  preferredLaunchScriptNames
} from "./projectDetection.js";
import {
  launchTargetWithStartupArgsOption,
  startupArgsFromLaunchInput
} from "../../launchPreviewOptions.js";

function launchTarget(id, label) {
  return launchTargetWithStartupArgsOption({
    id,
    label
  });
}

function hasScript(packageJson = {}, scriptName = "") {
  return Boolean(scriptName && packageScript(packageJson, scriptName));
}

async function listGenericNodeWebLaunchTargets({
  session = {}
} = {}) {
  const worktreePath = sessionSourcePath(session);
  const packageJson = worktreePath ? await readPackageJson(worktreePath) : null;
  if (!packageJson) {
    return [];
  }
  const scripts = preferredLaunchScriptNames(packageJson);
  return [
    scripts.build && scripts.start ? launchTarget("built", "Build and run server script") : null,
    scripts.dev ? launchTarget("dev", "Run dev script") : null,
    hasScript(packageJson, "start") ? launchTarget("start", "Run start script") : null,
    scripts.preview ? launchTarget("preview", "Run preview script") : null
  ].filter(Boolean);
}

function knownCliNetworkArgs(command = "", port = "") {
  const normalizedPort = String(port || "").trim();
  if (!normalizedPort) {
    return [];
  }
  if (/\bnext\b/u.test(command)) {
    return ["-H", "0.0.0.0", "-p", normalizedPort];
  }
  if (/\bvinext\b/u.test(command)) {
    return ["--hostname", "0.0.0.0", "--port", normalizedPort];
  }
  if (/\b(astro|ng|nuxt|svelte-kit|vite)\b/u.test(command)) {
    return ["--host", "0.0.0.0", "--port", normalizedPort];
  }
  return [];
}

function serverScriptCommand(packageJson = {}, packageManagerName = "npm", scriptName = "", {
  port = "",
  startupArgs = []
} = {}) {
  const script = packageScript(packageJson, scriptName);
  const extraArgs = [
    ...knownCliNetworkArgs(script, port),
    ...startupArgs
  ];
  return scriptName
    ? runScriptCommand(packageManagerName, scriptName, extraArgs)
    : "";
}

async function createGenericNodeWebLaunchDescriptor({
  launchInput = {},
  launchTargetId = "dev",
  port,
  worktreePath = ""
} = {}) {
  const packageJson = await readPackageJson(worktreePath);
  const packageManager = await detectPackageManager(worktreePath, packageJson || {});
  const scripts = preferredLaunchScriptNames(packageJson || {});
  const buildScript = scripts.build;
  const serverScript = {
    built: scripts.start,
    dev: scripts.dev,
    preview: scripts.preview,
    start: scripts.start
  }[launchTargetId] || "";
  const startupArgs = startupArgsFromLaunchInput(launchInput);
  const serverCommand = serverScriptCommand(packageJson || {}, packageManager.name, serverScript, {
    port,
    startupArgs
  });
  const buildCommand = launchTargetId === "built" && buildScript
    ? runScriptCommand(packageManager.name, buildScript)
    : "";

  return {
    commands: [
      buildCommand
        ? {
            command: buildCommand,
            label: "Building Node web app.",
            networkEnv: false
          }
        : null,
      serverCommand
        ? {
            command: serverCommand,
            label: "Starting Node web app.",
            networkEnv: true
          }
        : null
    ].filter(Boolean),
    metadata: {
      buildCommand,
      commandSource: "package-script",
      packageManager: packageManager.name,
      port,
      serverCommand,
      serverScript
    },
    runtimes: ["node22"],
    urlPath: "/"
  };
}

function createGenericNodeWebLaunchTargetTerminalSpec({
  context = {},
  launchInput = {},
  launchTargetId = "",
  session = {},
  targetRoot = ""
} = {}) {
  if (!["built", "dev", "preview", "start"].includes(launchTargetId)) {
    return {
      ok: false,
      message: `Unknown generic Node web launch target: ${launchTargetId || "(empty)"}.`
    };
  }
  const launchTargetRoot = targetRoot || session.targetRoot || "";
  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "node-web",
    launchTarget: context.launchTarget || launchTarget(launchTargetId, launchTargetId),
    resolveLaunch: ({ port, worktreePath }) => createGenericNodeWebLaunchDescriptor({
      launchInput,
      launchTargetId,
      port,
      worktreePath
    }),
    session,
    targetRoot: launchTargetRoot
  });
}

export {
  createGenericNodeWebLaunchDescriptor,
  createGenericNodeWebLaunchTargetTerminalSpec,
  listGenericNodeWebLaunchTargets
};
