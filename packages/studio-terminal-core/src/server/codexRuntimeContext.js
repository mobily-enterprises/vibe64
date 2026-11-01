import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_SYSTEM_ROOT_ENV
} from "@local/vibe64-core/server/studioRoots";
import {
  commandCallerEnv,
  envRecord,
  normalizeText,
  recordValue,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  uniqueStrings,
  resolveCommandEnv
} from "@local/vibe64-execution/server";
import {
  codexCredentialContext
} from "@local/vibe64-execution/server";

function normalizeAbsolutePath(value = "") {
  const normalized = normalizeText(value);
  return normalized && path.isAbsolute(normalized) ? path.resolve(normalized) : "";
}

function currentProcessId(methodName = "") {
  // readable-check: allow method-probe - platform object: process.getuid() and process.getgid() exist only on POSIX
  return typeof process[methodName] === "function" ? process[methodName]() : null;
}

function codexRuntimeActor(credential = {}) {
  return {
    actor: "app",
    credentialScope: credential.scope || "app",
    requiresRealUser: false,
    user: {
      gid: credential.gid,
      home: credential.toolHomeSource,
      uid: credential.uid,
      username: credential.username
    }
  };
}

function codexRuntimeIds(value = []) {
  const requested = Array.isArray(value) ? value : [];
  return uniqueStrings([
    ...VIBE64_INTERACTIVE_RUNTIME_PACKS,
    ...requested
  ]);
}

/**
 * The Codex runtime context both public forms share: the second argument says whether a missing system root refuses.
 */
function buildCodexRuntimeContext({
  env = process.env,
  gid = currentProcessId("getgid"),
  home = os.homedir(),
  providerOptions = {},
  shimDirs = [],
  systemRoot = "",
  terminalEnv = {},
  toolHomeSource = "",
  uid = currentProcessId("getuid"),
  username = ""
}, systemRootRequired) {
  const normalizedProviderOptions = recordValue(providerOptions);
  const runtimes = codexRuntimeIds(normalizedProviderOptions.runtimes);
  const mergedEnv = {
    ...recordValue(process.env),
    ...recordValue(env),
    ...recordValue(normalizedProviderOptions.env)
  };
  const resolvedSystemRoot = normalizeAbsolutePath(
    systemRoot ||
    normalizedProviderOptions.systemRoot ||
    mergedEnv[VIBE64_SYSTEM_ROOT_ENV]
  );
  if (systemRootRequired && !resolvedSystemRoot) {
    return {
      code: "vibe64_codex_system_root_required",
      error: "A Vibe64 system root is required for Codex runtime operations.",
      errors: [
        {
          code: "vibe64_codex_system_root_required",
          message: "A Vibe64 system root is required for Codex runtime operations."
        }
      ],
      ok: false
    };
  }

  const credential = codexCredentialContext({
    gid,
    home: toolHomeSource || normalizedProviderOptions.toolHomeSource || home,
    uid,
    username
  });
  if (credential?.ok === false) {
    return credential;
  }

  const actor = codexRuntimeActor(credential);
  const rawTerminalEnv = envRecord(terminalEnv);
  const normalizedTerminalEnv = commandCallerEnv(rawTerminalEnv, {
    envPolicy: "session"
  });
  const runtimeEnv = resolveCommandEnv({
    actor,
    baseEnv: mergedEnv,
    request: {
      env: {},
      envPolicy: "auth",
      purpose: "codex",
      runtimes
    }
  });
  const terminalProcessEnv = resolveCommandEnv({
    actor,
    baseEnv: runtimeEnv,
    request: {
      env: rawTerminalEnv,
      envPolicy: "session",
      project: {
        databaseEnv: rawTerminalEnv
      },
      purpose: "codex",
      runtimes,
      shimDirs
    }
  });

  return {
    ...credential,
    env: runtimeEnv,
    ok: true,
    providerOptions: {
      ...normalizedProviderOptions,
      env: runtimeEnv,
      runtimes,
      systemRoot: resolvedSystemRoot,
      toolHomeSource: credential.toolHomeSource
    },
    runtimes,
    systemRoot: resolvedSystemRoot,
    terminalEnv: normalizedTerminalEnv,
    terminalProcessEnv
  };
}

/**
 * The Codex runtime context: its credential, environments and system root (empty when none is configured).
 * @param {object} [options]
 */
function codexRuntimeContext(options = {}) {
  return buildCodexRuntimeContext(options, false);
}

/**
 * The Codex runtime context, refused with vibe64_codex_system_root_required when no system root is configured.
 * @param {object} [options]
 */
function codexRuntimeContextRequiringSystemRoot(options = {}) {
  return buildCodexRuntimeContext(options, true);
}

export {
  codexRuntimeContext,
  codexRuntimeContextRequiringSystemRoot
};
