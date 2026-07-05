import { chmodSync, mkdirSync, writeFileSync } from "node:fs";
import path from "node:path";

import {
  hostSupplementaryGroupDockerArgs,
  hostUserDockerArgs
} from "./shellCommands.js";
import {
  packageManagerCacheEnv,
  packageManagerCacheMountDockerArgs
} from "./sharedPackageCaches.js";

function normalizeDockerEnv(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env)
    .map(([key, value]) => [
      String(key || "").trim(),
      String(value ?? "")
    ])
    .filter(([key]) => Boolean(key)));
}

function dockerEnvArgs(env = {}) {
  return Object.entries(normalizeDockerEnv(env))
    .filter(([, value]) => String(value || ""))
    .flatMap(([name, value]) => [
      "-e",
      `${name}=${value}`
    ]);
}

function dockerEnvNameArgs(env = {}) {
  return Object.keys(normalizeDockerEnv(env)).flatMap((key) => [
    "-e",
    key
  ]);
}

function dockerEnvFileText(env = {}) {
  return Object.entries(normalizeDockerEnv(env))
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([key, value]) => {
      if (/[\r\n\0]/u.test(value)) {
        throw new Error(`Docker env-file value for ${key} cannot contain a newline or NUL byte.`);
      }
      return `${key}=${value}`;
    })
    .join("\n") + "\n";
}

function writeDockerEnvFileSync(filePath = "", env = {}) {
  const resolvedPath = String(filePath || "").trim()
    ? path.resolve(String(filePath || ""))
    : "";
  const normalizedEnv = normalizeDockerEnv(env);
  if (!resolvedPath || Object.keys(normalizedEnv).length === 0) {
    return [];
  }
  mkdirSync(path.dirname(resolvedPath), {
    recursive: true
  });
  writeFileSync(resolvedPath, dockerEnvFileText(normalizedEnv), {
    mode: 0o600
  });
  chmodSync(resolvedPath, 0o600);
  return [
    "--env-file",
    resolvedPath
  ];
}

function writableHostUserDockerArgs({
  env = {},
  home = "/tmp/studio-home"
} = {}) {
  return [
    ...hostUserDockerArgs(),
    ...hostSupplementaryGroupDockerArgs(),
    ...dockerEnvArgs({
      HOME: home,
      ...env
    })
  ];
}

function writableHostUserPackageCacheDockerArgs({
  cacheNames = ["npm"],
  env = {},
  home = "/tmp/studio-home"
} = {}) {
  return [
    ...writableHostUserDockerArgs({
      env: {
        ...env,
        ...packageManagerCacheEnv(cacheNames)
      },
      home
    }),
    ...packageManagerCacheMountDockerArgs(cacheNames)
  ];
}

export {
  dockerEnvArgs,
  dockerEnvFileText,
  dockerEnvNameArgs,
  normalizeDockerEnv,
  writeDockerEnvFileSync,
  writableHostUserDockerArgs,
  writableHostUserPackageCacheDockerArgs
};
