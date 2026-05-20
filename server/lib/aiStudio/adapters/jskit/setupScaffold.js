import path from "node:path";

import {
  blockedDoctorCheck as blockedCheck,
  formatDoctorList as formatList,
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "../../../doctorCheckItems.js";
import {
  shellQuote
} from "../../../shellCommands.js";
import {
  shellScript
} from "../../../shellScript.js";
import {
  selectedConfigValue
} from "../../configValues.js";
import {
  writableHostUserDockerArgs
} from "../../dockerRuntime.js";
import {
  JSKIT_TOOLCHAIN_IMAGE
} from "./toolchainIdentity.js";

const JSKIT_TENANCY_MODE_CONFIG = "jskit_tenancy_mode";
const JSKIT_CREATE_APP_TENANCY_MODES = new Set([
  "none",
  "personal",
  "workspaces"
]);
const JSKIT_SCAFFOLD_ALLOWED_BOOTSTRAP_ENTRIES = new Set([
  ".gitignore",
  "node_modules"
]);

function selectedJskitTenancyMode(config = {}) {
  return selectedConfigValue(config, JSKIT_TENANCY_MODE_CONFIG, JSKIT_CREATE_APP_TENANCY_MODES, "none");
}

function repoNameFromTargetRoot(targetRoot) {
  return String(path.basename(targetRoot) || "jskit-app")
    .replace(/[^A-Za-z0-9_.-]+/gu, "-")
    .replace(/^-+|-+$/gu, "") || "jskit-app";
}

function titleFromRepoName(repoName) {
  return repoName
    .split(/[-_.\s]+/u)
    .filter(Boolean)
    .map((part) => part.slice(0, 1).toUpperCase() + part.slice(1))
    .join(" ") || "JSKIT App";
}

function scaffoldCommandPreview(config = {}) {
  return `npx @jskit-ai/create-app "$JSKIT_APP_NAME" --target . --force --tenancy-mode ${shellQuote(selectedJskitTenancyMode(config))} --title "$JSKIT_APP_TITLE" --initial-bundles none`;
}

function scaffoldScript(config = {}) {
  return shellScript([
    "set -e",
    "set -x",
    scaffoldCommandPreview(config)
  ]);
}

function scaffoldEnvArgs(targetRoot) {
  const repoName = repoNameFromTargetRoot(targetRoot);
  return [
    ...writableHostUserDockerArgs({
      env: {
        npm_config_cache: "/tmp/npm-cache"
      }
    }),
    "-e",
    `JSKIT_APP_NAME=${repoName}`,
    "-e",
    `JSKIT_APP_TITLE=${titleFromRepoName(repoName)}`
  ];
}

function scaffoldTerminalAction(targetRoot, toolkit) {
  return toolkit.toolchainTerminalAction({
    actionId: "terminal-scaffold-jskit",
    autoRun: true,
    commandArgs: (context = {}) => ["bash", "-lc", scaffoldScript(context.config)],
    commandPreview: (context = {}) => scaffoldCommandPreview(context.config),
    extraArgs: (context = {}) => scaffoldEnvArgs(context.targetRoot || targetRoot),
    image: JSKIT_TOOLCHAIN_IMAGE,
    label: "Seed this project",
    targetRoot
  });
}

function scaffoldRepair(targetRoot, context, toolkit) {
  return scaffoldTerminalAction(targetRoot, toolkit).repair({
    config: context.config,
    targetRoot
  });
}

async function checkJskitScaffold(targetRoot, context, toolkit) {
  const markers = {
    configPublic: await toolkit.targetConfigFileExists("public.js", { targetRoot }),
    lock: await toolkit.targetFileExists(".jskit/lock.json", { targetRoot }),
    packageJson: await toolkit.targetFileExists("package.json", { targetRoot })
  };

  if (markers.lock) {
    const lock = await toolkit.readTargetJson(".jskit/lock.json", { targetRoot });
    if (!lock.ok) {
      return hardStopCheck({
        id: "scaffold",
        label: "Seed JSKIT app",
        expected: ".jskit/lock.json is valid JSON.",
        observed: lock.error,
        explanation: "Malformed JSKIT metadata needs manual recovery before Studio can reason about the app."
      });
    }
    context.jskitLock = lock.value;
  }

  if (markers.packageJson && markers.lock && markers.configPublic) {
    return passCheck({
      id: "scaffold",
      label: "Seed JSKIT app",
      expected: "package.json, .jskit/lock.json, and config/public.js exist.",
      observed: "Minimal JSKIT scaffold markers are present.",
      explanation: "Studio can now use official JSKIT tooling for deeper checks."
    });
  }

  const nonGitEntries = (context.nonGitEntries || [])
    .filter((entry) => !JSKIT_SCAFFOLD_ALLOWED_BOOTSTRAP_ENTRIES.has(entry));
  if (nonGitEntries.length) {
    const missingMarkers = Object.entries(markers)
      .filter(([, present]) => !present)
      .map(([name]) => name)
      .join(", ");
    return hardStopCheck({
      id: "scaffold",
      label: "Seed JSKIT app",
      expected: "Existing files are already a recognizable JSKIT scaffold.",
      observed: `Missing markers: ${missingMarkers}\nFiles: ${formatList(nonGitEntries)}`,
      explanation: "Studio will not run the JSKIT app generator over an existing non-JSKIT file tree."
    });
  }

  return blockedCheck({
    id: "scaffold",
    label: "Seed JSKIT app",
    expected: "Minimal JSKIT scaffold markers exist.",
    observed: "No scaffold files are present yet.",
    explanation: "Seed this target with the selected JSKIT configuration before installing dependencies or checking runtime readiness.",
    repair: scaffoldRepair(targetRoot, context, toolkit)
  });
}

export {
  checkJskitScaffold,
  repoNameFromTargetRoot,
  scaffoldCommandPreview,
  scaffoldRepair,
  scaffoldScript,
  scaffoldTerminalAction,
  selectedJskitTenancyMode
};
