import os from "node:os";
import path from "node:path";
import process from "node:process";

import {
  VIBE64_SYSTEM_ROOT_ENV
} from "../../../vibe64-core/src/server/studioRoots.js";
import {
  commandCallerEnv,
  VIBE64_INTERACTIVE_RUNTIME_PACKS,
  uniqueStrings,
  resolveCommandEnv
} from "@local/vibe64-execution/server";
import {
  codexCredentialContext
} from "@local/vibe64-execution/server";

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
      runtimes
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

export {
  codexRuntimeContext
};
