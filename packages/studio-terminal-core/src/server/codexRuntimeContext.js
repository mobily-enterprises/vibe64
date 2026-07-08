import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_SYSTEM_ROOT_ENV
} from "../../../vibe64-core/src/server/studioRoots.js";
import {
  codexCredentialContext
} from "./credentialHomes.js";
import {
  realUserHomeEnv
} from "./hostUserExecution.js";

function recordValue(value) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value
    : {};
}

function envRecord(value) {
  return Object.fromEntries(Object.entries(recordValue(value))
    .map(([key, envValue]) => [
      normalizeText(key),
      String(envValue ?? "")
    ])
    .filter(([key]) => Boolean(key)));
}

function normalizeText(value = "") {
  return String(value || "").trim();
}

function normalizeAbsolutePath(value = "") {
  const normalized = normalizeText(value);
  return normalized && path.isAbsolute(normalized) ? path.resolve(normalized) : "";
}

function currentProcessId(methodName = "") {
  return typeof process[methodName] === "function" ? process[methodName]() : null;
}

function codexRuntimeContext({
  env = process.env,
  gid = currentProcessId("getgid"),
  home = os.homedir(),
  providerOptions = {},
  requireSystemRoot = false,
  systemRoot = "",
  terminalEnv = {},
  toolHomeSource = "",
  uid = currentProcessId("getuid"),
  username = ""
} = {}) {
  const normalizedProviderOptions = recordValue(providerOptions);
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
  if (requireSystemRoot && !resolvedSystemRoot) {
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

  const runtimeEnv = realUserHomeEnv({
    env: mergedEnv,
    home: credential.toolHomeSource,
    username: credential.username
  });
  const normalizedTerminalEnv = envRecord(terminalEnv);
  const terminalProcessEnv = realUserHomeEnv({
    env: {
      ...runtimeEnv,
      ...normalizedTerminalEnv
    },
    home: credential.toolHomeSource,
    username: credential.username
  });

  return {
    ...credential,
    env: runtimeEnv,
    ok: true,
    providerOptions: {
      ...normalizedProviderOptions,
      env: runtimeEnv,
      systemRoot: resolvedSystemRoot,
      toolHomeSource: credential.toolHomeSource
    },
    systemRoot: resolvedSystemRoot,
    terminalEnv: normalizedTerminalEnv,
    terminalProcessEnv
  };
}

export {
  codexRuntimeContext
};
