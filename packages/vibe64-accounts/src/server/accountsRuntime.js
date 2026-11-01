import { appCredentialContext, GITHUB_ACCOUNT_MODE_LOCAL, githubCredentialContext } from "@local/vibe64-execution/server";
import { codexRuntimeContext, codexRuntimeContextRequiringSystemRoot } from "@local/studio-terminal-core/server/codexRuntimeContext";
import { isAssistantRoutingOwner } from "@local/vibe64-runtime/shared/assistantRouting";
import { projectServiceNamespaceRoot } from "@local/vibe64-core/server/projectServiceSelection";
import { resolveStudioTargetRoot, resolveVibe64SystemRoot } from "@local/vibe64-core/server/studioRoots";

/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const BROWSER_AUTH_MODE = "browser";
const DEVICE_AUTH_MODE = "device";
const API_KEY_AUTH_MODE = "api_key";

const ALL_CODEX_AUTH_MODES = Object.freeze([
  BROWSER_AUTH_MODE,
  DEVICE_AUTH_MODE,
  API_KEY_AUTH_MODE
]);

function resolveVibe64AccountsRoot(targetRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: targetRoot
  });
}

function authError(code, message, extra = {}) {
  return {
    ...extra,
    code,
    error: message,
    errors: [
      {
        code,
        message
      }
    ],
    ok: false
  };
}

function normalizeCodexAuthModes(modes = ALL_CODEX_AUTH_MODES) {
  const normalizedModes = Array.isArray(modes) && modes.length
    ? modes
    : ALL_CODEX_AUTH_MODES;
  return new Set(
    normalizedModes
      .map((mode) => String(mode || "").trim().toLowerCase())
      .filter((mode) => ALL_CODEX_AUTH_MODES.includes(mode))
  );
}

/**
 * What an account runtime adds to an account change's log line: nothing by default.
 */
function noDebugInput() {
  return {};
}

/**
 * The GitHub identity a person linked before: a host may remember one.
 */
function noPreviousGithub() {
  return null;
}

/**
 * Who may manage AI here: Claude and Codex sign-in, saved provider keys, model
 * access and model routing. By default only the workspace owner may.
 */
function ownerManagesAi(input = {}) {
  return isAssistantRoutingOwner(input.vibe64User) ? null
    : authError("vibe64_owner_required", "Only the workspace owner can manage AI connections and models.");
}

function unsupportedCodexAuthMode() {
  return "This Codex login method is not available for this Vibe64 account runtime.";
}

/**
 * @param {object} dependencies
 * @param {string[]} [dependencies.allowedCodexAuthModes]
 * @param {string} [dependencies.daemonHome]
 * @param {number | null} [dependencies.daemonGid]
 * @param {number | null} [dependencies.daemonUid]
 * @param {string} [dependencies.daemonUsername]
 * @param {(input: object) => object} [dependencies.debugInput]
 * @param {RuntimeEnv} [dependencies.env]
 * @param {string} [dependencies.githubAccountMode]
 * @param {(input: object) => object | null} [dependencies.previousGithub]
 * @param {ProjectService | null} [dependencies.project]
 * @param {(input: object) => object | null} [dependencies.requireAiManagement]
 * @param {boolean} [dependencies.requireExplicitRoots]
 * @param {string} [dependencies.systemRoot]
 * @param {string} [dependencies.targetRoot]
 * @param {(mode: string) => string} [dependencies.unsupportedCodexAuthModeMessage]
 */
function createAccountsRuntime({
  allowedCodexAuthModes = ALL_CODEX_AUTH_MODES,
  daemonHome = "",
  daemonGid = null,
  daemonUid = null,
  daemonUsername = "",
  debugInput = noDebugInput,
  env = process.env,
  githubAccountMode = GITHUB_ACCOUNT_MODE_LOCAL,
  previousGithub = noPreviousGithub,
  // readable-check: allow dependency-default - input validation: only a runtime without its target root reads the project's namespace root
  project = null,
  requireAiManagement = ownerManagesAi,
  requireExplicitRoots = true,
  systemRoot = "",
  targetRoot = "",
  unsupportedCodexAuthModeMessage = unsupportedCodexAuthMode
} = {}) {
  const explicitSystemRoot = String(systemRoot || "").trim();
  const resolvedSystemRoot = requireExplicitRoots && !explicitSystemRoot
    ? ""
    : resolveVibe64SystemRoot({
        env,
        explicitRoot: systemRoot
      });
  const codexAuthModes = normalizeCodexAuthModes(allowedCodexAuthModes);
  const readCodexRuntimeContext = requireExplicitRoots ? codexRuntimeContextRequiringSystemRoot : codexRuntimeContext;

  function currentTargetRoot() {
    const selectedTargetRoot = String(targetRoot || projectServiceNamespaceRoot(project)).trim();
    return selectedTargetRoot ? resolveVibe64AccountsRoot(selectedTargetRoot) : "";
  }

  function readClaudeContext() {
    return appCredentialContext({
      home: daemonHome || undefined,
      gid: daemonGid ?? undefined,
      uid: daemonUid ?? undefined,
      username: daemonUsername
    });
  }

  function readCodexContext() {
    return readCodexRuntimeContext({
      env,
      gid: daemonGid ?? undefined,
      home: daemonHome || undefined,
      systemRoot: resolvedSystemRoot,
      uid: daemonUid ?? undefined,
      username: daemonUsername
    });
  }

  function codexModeAllowed(mode = "") {
    return codexAuthModes.has(String(mode || "").trim().toLowerCase());
  }

  function readDebugInput(input = {}) {
    return debugInput(input) || {};
  }

  function readGithubContext(input = {}) {
    return githubCredentialContext(input, {
      accountMode: githubAccountMode
    });
  }

  function readPreviousGithub(input = {}) {
    return previousGithub(input);
  }

  /**
   * The one answer to who may manage AI here; a host may override it.
   */
  function checkAiManagement(input = {}) {
    return requireAiManagement(input);
  }

  function unsupportedCodexAuthModeText(mode = "") {
    return unsupportedCodexAuthModeMessage(mode);
  }

  return Object.freeze({
    claudeContext: readClaudeContext,
    codexContext: readCodexContext,
    codexModeAllowed,
    currentTargetRoot,
    debugInput: readDebugInput,
    githubContext: readGithubContext,
    previousGithub: readPreviousGithub,
    requireAiManagement: checkAiManagement,
    systemRoot: resolvedSystemRoot,
    unsupportedCodexAuthModeMessage: unsupportedCodexAuthModeText
  });
}

export {
  ALL_CODEX_AUTH_MODES,
  API_KEY_AUTH_MODE,
  authError,
  BROWSER_AUTH_MODE,
  createAccountsRuntime,
  DEVICE_AUTH_MODE,
  noDebugInput,
  noPreviousGithub,
  normalizeCodexAuthModes,
  ownerManagesAi,
  resolveVibe64AccountsRoot,
  unsupportedCodexAuthMode
};
