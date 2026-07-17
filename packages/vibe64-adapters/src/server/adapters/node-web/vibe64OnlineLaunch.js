import path from "node:path";

import {
  VIBE64_PROJECTS_ROOT_ENV,
  VIBE64_SERVICE_DATA_ROOT_ENV,
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  DEFAULT_WEB_LAUNCH_TARGET_PORT,
  createVibe64WebLaunchTargetTerminalSpec
} from "@local/studio-terminal-core/server/launchTargetTerminal";
import {
  VIBE64_RUNTIME_NAMESPACE_ENV,
  runtimeNamespace
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";
import {
  detectPackageManager,
  packageScript,
  readPackageJson,
  runScriptCommand
} from "../../nodePackage.js";
import {
  nestedStudioPreviewProxy,
  nestedStudioSessionRuntimeRoot
} from "../../nestedStudioLaunch.js";

const VIBE64_ONLINE_LAUNCH_TARGET_ID = "online";
const VIBE64_ONLINE_PACKAGE_NAME = "vibe64-online";
const VIBE64_PACKAGE_NAME = "vibe64";
const VIBE64_ONLINE_PUBLIC_SOURCE_ROOT_OPTION_ID = "publicSourceRoot";
const VIBE64_CODEX_ATTACHMENTS_ROOT_ENV = "VIBE64_CODEX_ATTACHMENTS_ROOT";
const VIBE64_ONLINE_COMPOSED_APP_ROOT_ENV = "VIBE64_ONLINE_COMPOSED_APP_ROOT";
const VIBE64_ONLINE_STATE_ROOT_ENV = "VIBE64_ONLINE_STATE_ROOT";
const VIBE64_PUBLIC_SOURCE_ROOT_ENV = "VIBE64_PUBLIC_SOURCE_ROOT";
const VIBE64_RELEASE_GENERATION_ENV = "VIBE64_RELEASE_GENERATION";
const VIBE64_RESTART_STATE_ROOT_ENV = "VIBE64_RESTART_STATE_ROOT";
const VIBE64_WORKSPACE_ENV = "VIBE64_WORKSPACE";
const VIBE64_INSTANCE_ENV = "VIBE64_INSTANCE";
const VIBE64_ONLINE_RESTART_ON_CHANGE = Object.freeze({
  exclude: Object.freeze([
    ".git/**",
    ".vibe64-online/**",
    ".vibe64-online-artifacts/**",
    ".vibe64-online-generated/**",
    "node_modules/**"
  ]),
  include: Object.freeze(["**"]),
  label: "Vibe64 Online source files",
  reason: "server_source_changed"
});

function isVibe64OnlinePackage(packageJson = {}) {
  return String(packageJson?.name || "").trim() === VIBE64_ONLINE_PACKAGE_NAME;
}

function vibe64OnlineLaunchTarget(packageJson = {}) {
  if (!isVibe64OnlinePackage(packageJson) || !packageScript(packageJson, "dev")) {
    return null;
  }
  return {
    defaultDisplay: "minimized",
    defaultPreview: true,
    id: VIBE64_ONLINE_LAUNCH_TARGET_ID,
    label: "Run Vibe64 Online",
    previewOptions: [
      {
        defaultValue: "",
        description: "Stable selected-session source path for the public Vibe64 project this app should compose.",
        id: VIBE64_ONLINE_PUBLIC_SOURCE_ROOT_OPTION_ID,
        label: "Public Vibe64 source root",
        placeholder: "/var/lib/vibe64/<workspace>/projects/vibe64/sessions/selected/source",
        type: "text"
      }
    ]
  };
}

function launchInputTextValue(launchInput = {}, id = "") {
  const values = launchInput?.values;
  const value = values && typeof values === "object" && !Array.isArray(values)
    ? values[id]
    : "";
  return String(value || "").trim();
}

async function validatePublicVibe64SourceRoot(launchInput = {}) {
  const inputPath = launchInputTextValue(launchInput, VIBE64_ONLINE_PUBLIC_SOURCE_ROOT_OPTION_ID);
  if (!inputPath) {
    return {
      ok: false,
      message: "Set the public Vibe64 source root in preview options before running Vibe64 Online."
    };
  }
  if (!path.isAbsolute(inputPath)) {
    return {
      ok: false,
      message: "Public Vibe64 source root must be an absolute path."
    };
  }
  const publicSourceRoot = path.resolve(inputPath);
  const packageName = String((await readPackageJson(publicSourceRoot))?.name || "").trim();
  if (packageName !== VIBE64_PACKAGE_NAME) {
    return {
      ok: false,
      message: `Public Vibe64 source root must point to a ${VIBE64_PACKAGE_NAME} checkout. Found ${packageName || "(no package.json)"}.`
    };
  }
  return {
    ok: true,
    publicSourceRoot
  };
}

function inheritedRuntimeIdentityEnv(env = process.env) {
  return Object.fromEntries([
    [VIBE64_WORKSPACE_ENV, env?.[VIBE64_WORKSPACE_ENV]],
    [VIBE64_INSTANCE_ENV, env?.[VIBE64_INSTANCE_ENV]],
    [VIBE64_RUNTIME_NAMESPACE_ENV, runtimeNamespace({ env })]
  ]
    .map(([name, value]) => [name, String(value || "").trim()])
    .filter(([, value]) => Boolean(value)));
}

async function createVibe64OnlineLaunchDescriptor({
  launchPort = DEFAULT_WEB_LAUNCH_TARGET_PORT,
  packageJson = {},
  publicSourceRoot = "",
  session = {},
  worktreePath = ""
} = {}) {
  const packageManager = await detectPackageManager(worktreePath, packageJson);
  const stateRoot = nestedStudioSessionRuntimeRoot({
    directoryName: "vibe64-online-child",
    session,
    worktreePath
  });
  const previewProxy = nestedStudioPreviewProxy({
    launchPort
  });
  const identityEnv = inheritedRuntimeIdentityEnv(process.env);
  const composedAppRoot = stateRoot ? path.join(stateRoot, "app") : "";
  return {
    allowedRoots: [publicSourceRoot, stateRoot].filter(Boolean),
    command: runScriptCommand(packageManager.name, "dev"),
    env: {
      ...identityEnv,
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: stateRoot ? path.join(stateRoot, "attachments") : "",
      [VIBE64_ONLINE_COMPOSED_APP_ROOT_ENV]: composedAppRoot,
      [VIBE64_ONLINE_STATE_ROOT_ENV]: stateRoot,
      [VIBE64_PROJECTS_ROOT_ENV]: "",
      [VIBE64_PUBLIC_SOURCE_ROOT_ENV]: publicSourceRoot,
      [VIBE64_RELEASE_GENERATION_ENV]: "",
      [VIBE64_RESTART_STATE_ROOT_ENV]: stateRoot ? path.join(stateRoot, "instance-restarts") : "",
      [VIBE64_SERVICE_DATA_ROOT_ENV]: "",
      [VIBE64_SYSTEM_ROOT_ENV]: stateRoot ? path.join(stateRoot, "system") : "",
      ...previewProxy.env
    },
    metadata: {
      commandSource: "package_json_dev_script",
      composedAppRoot,
      mode: "vibe64-online-dev",
      packageManager: packageManager.name,
      previewProxyPortRange: `${previewProxy.portRange.start}-${previewProxy.portRange.end}`,
      publicSourceRoot,
      runtimeNamespace: identityEnv[VIBE64_RUNTIME_NAMESPACE_ENV] || "",
      stateRoot
    },
    restartOnChange: VIBE64_ONLINE_RESTART_ON_CHANGE,
    runtimes: packageManager.name === "bun" ? ["node22", "bun"] : ["node22"],
    urlPath: "/app",
    workdir: worktreePath
  };
}

async function createVibe64OnlineLaunchTargetTerminalSpec({
  context = {},
  launchInput = {},
  session = {},
  targetRoot = ""
} = {}) {
  const worktreePath = sessionSourcePath(session);
  if (!worktreePath) {
    return {
      ok: false,
      message: "Create the session clone before running Vibe64 Online."
    };
  }
  const packageJson = await readPackageJson(worktreePath);
  const launchTarget = vibe64OnlineLaunchTarget(packageJson || {});
  if (!launchTarget) {
    return {
      ok: false,
      message: "Vibe64 Online launch is only available for the vibe64-online package with a dev script."
    };
  }
  const publicSource = await validatePublicVibe64SourceRoot(launchInput);
  if (!publicSource.ok) {
    return publicSource;
  }
  return createVibe64WebLaunchTargetTerminalSpec({
    adapterId: "node-web",
    launchTarget: context.launchTarget || launchTarget,
    preferredPort: DEFAULT_WEB_LAUNCH_TARGET_PORT,
    resolveLaunch: ({ port, worktreePath: launchWorktreePath }) => createVibe64OnlineLaunchDescriptor({
      launchPort: port,
      packageJson,
      publicSourceRoot: publicSource.publicSourceRoot,
      session,
      worktreePath: launchWorktreePath
    }),
    session,
    targetRoot: targetRoot || session.targetRoot || ""
  });
}

export {
  VIBE64_ONLINE_LAUNCH_TARGET_ID,
  createVibe64OnlineLaunchDescriptor,
  createVibe64OnlineLaunchTargetTerminalSpec,
  isVibe64OnlinePackage,
  vibe64OnlineLaunchTarget
};
