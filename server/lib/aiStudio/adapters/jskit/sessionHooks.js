import path from "node:path";

import {
  shellQuote
} from "../../../shellCommands.js";
import {
  normalizeText,
  pathExists
} from "../../core.js";

const SESSION_PROVISION_PACKAGE_SCRIPT = "jskit:provision-session";
const SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT = "jskit:finalization-guard";
const ENABLE_RECURSIVE_AI_STUDIO_OPENING_CONFIG = "enable_recursive_ai_studio_opening";
const RECURSIVE_AI_STUDIO_COMPANION_ROOT_CONFIG = "recursive_ai_studio_local_jskit_ai_root";

const PACKAGE_SCRIPT_EXISTS_NODE = [
  "const fs = require('node:fs');",
  "const packageJson = JSON.parse(fs.readFileSync('package.json', 'utf8'));",
  "const scripts = packageJson.scripts || {};",
  "process.exit(Object.prototype.hasOwnProperty.call(scripts, process.argv[1]) ? 0 : 1);"
].join("");

function isEnabledValue(value = "") {
  return [
    "1",
    "true",
    "yes",
    "on",
    "auto"
  ].includes(normalizeText(value).toLowerCase());
}

function configValues(config = {}) {
  return config?.values && typeof config.values === "object"
    ? config.values
    : config;
}

function recursiveAiStudioOpeningEnabled(config = {}) {
  return isEnabledValue(configValues(config)[ENABLE_RECURSIVE_AI_STUDIO_OPENING_CONFIG]);
}

function recursiveAiStudioCompanionRoot(config = {}) {
  return normalizeText(configValues(config)[RECURSIVE_AI_STUDIO_COMPANION_ROOT_CONFIG]);
}

function packageScriptRecordName(scriptName = "") {
  return normalizeText(scriptName).replace(/[^a-zA-Z0-9._-]+/gu, "_");
}

function shellEnvironment(assignments = {}) {
  return Object.entries(assignments)
    .filter(([, value]) => normalizeText(value))
    .map(([name, value]) => `${name}=${shellQuote(value)}`)
    .join(" ");
}

function sessionHookEnvironment({
  developmentRepoRoot = "",
  scriptName = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const env = {
    JSKIT_SESSION_ID: session.sessionId,
    JSKIT_SESSION_PACKAGE_SCRIPT: scriptName,
    JSKIT_SESSION_ROOT: session.sessionRoot,
    JSKIT_TARGET_ROOT: targetRoot || session.targetRoot,
    JSKIT_WORKTREE_ROOT: worktreePath
  };

  if (developmentRepoRoot) {
    env.JSKIT_AI_ROOT = developmentRepoRoot;
    env.JSKIT_DEVLINKS = developmentRepoRoot;
    env.JSKIT_REPO_ROOT = developmentRepoRoot;
  }

  return env;
}

async function isJskitRepoRoot(repoRoot = "") {
  return Boolean(
    repoRoot &&
    await pathExists(path.join(repoRoot, "packages")) &&
    await pathExists(path.join(repoRoot, "tooling"))
  );
}

async function resolveJskitDevelopmentRepoRoot({
  config = {}
} = {}) {
  if (!recursiveAiStudioOpeningEnabled(config)) {
    return "";
  }

  const repoRoot = recursiveAiStudioCompanionRoot(config);
  if (repoRoot && await isJskitRepoRoot(repoRoot)) {
    return path.resolve(repoRoot);
  }

  return "";
}

function optionalSessionPackageHookScript({
  developmentRepoRoot = "",
  scriptName = "",
  session = {},
  targetRoot = "",
  worktreePath = ""
} = {}) {
  const normalizedScriptName = normalizeText(scriptName);
  if (!normalizedScriptName) {
    return "";
  }

  const recordPath = session.sessionRoot
    ? path.join(session.sessionRoot, "hooks", packageScriptRecordName(normalizedScriptName))
    : "";
  const envPrefix = shellEnvironment(sessionHookEnvironment({
    developmentRepoRoot,
    scriptName: normalizedScriptName,
    session,
    targetRoot,
    worktreePath
  }));
  const runHookCommand = `${envPrefix} npm run ${shellQuote(normalizedScriptName)}`;
  const lines = [
    `if node -e ${shellQuote(PACKAGE_SCRIPT_EXISTS_NODE)} ${shellQuote(normalizedScriptName)}; then`,
    `  printf '[studio] Running package hook %s\\n' ${shellQuote(normalizedScriptName)}`,
    `  ${runHookCommand}`
  ];

  if (recordPath) {
    lines.push(
      `  mkdir -p ${shellQuote(path.dirname(recordPath))}`,
      `  { date -u '+%Y-%m-%dT%H:%M:%SZ'; printf '%s\\n' ${shellQuote(`${normalizedScriptName} completed.`)}; } > ${shellQuote(recordPath)}`
    );
  }

  lines.push(
    "else",
    `  printf '[studio] Package hook %s is not declared; skipping.\\n' ${shellQuote(normalizedScriptName)}`,
    "fi"
  );

  return lines.join("\n");
}

export {
  ENABLE_RECURSIVE_AI_STUDIO_OPENING_CONFIG,
  RECURSIVE_AI_STUDIO_COMPANION_ROOT_CONFIG,
  SESSION_FINALIZATION_GUARD_PACKAGE_SCRIPT,
  SESSION_PROVISION_PACKAGE_SCRIPT,
  optionalSessionPackageHookScript,
  recursiveAiStudioOpeningEnabled,
  resolveJskitDevelopmentRepoRoot
};
