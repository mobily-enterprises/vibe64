import path from "node:path";

import {
  envRecord,
  normalizeAbsolutePath,
  uniqueStrings
} from "../normalize.js";

const ISOLATED_PROCESS_BASE_ENV_NAMES = Object.freeze([
  "LANG",
  "LC_ALL",
  "NO_PROXY",
  "PATH",
  "SSL_CERT_DIR",
  "SSL_CERT_FILE",
  "TZ"
]);
const ISOLATED_PROCESS_RESERVED_ENV_NAMES = new Set([
  "HOME",
  "PATH",
  "XDG_CACHE_HOME",
  "XDG_CONFIG_HOME",
  "XDG_DATA_HOME",
  "XDG_STATE_HOME"
]);

function requiredAbsoluteDirectory(value = "", label = "directory") {
  const directory = normalizeAbsolutePath(value);
  if (!directory) {
    throw new TypeError(`Isolated process ${label} must be an absolute path.`);
  }
  return directory;
}

function isolatedProcessEnv(baseEnv = {}, options = {}) {
  const {
    cacheRoot = "",
    configRoot = "",
    dataRoot = "",
    extraEnv = {},
    homeRoot = "",
    pathEntries = [],
    stateRoot = ""
  } = options;
  const home = requiredAbsoluteDirectory(homeRoot, "home root");
  const cache = requiredAbsoluteDirectory(cacheRoot, "cache root");
  const config = requiredAbsoluteDirectory(configRoot, "config root");
  const data = requiredAbsoluteDirectory(dataRoot, "data root");
  const state = requiredAbsoluteDirectory(stateRoot, "state root");
  const source = envRecord(baseEnv);
  const base = Object.fromEntries(ISOLATED_PROCESS_BASE_ENV_NAMES
    .filter((name) => source[name] !== undefined)
    .map((name) => [name, source[name]]));
  const additions = Object.fromEntries(Object.entries(envRecord(extraEnv))
    .filter(([name]) => !ISOLATED_PROCESS_RESERVED_ENV_NAMES.has(name)));
  const commandPath = uniqueStrings([
    ...(Array.isArray(pathEntries) ? pathEntries : [pathEntries])
      .map((value) => String(value ?? "").trim())
      .filter((value) => value && path.isAbsolute(value))
      .map(normalizeAbsolutePath)
      .filter(Boolean),
    String(base.PATH || "").trim()
  ]).join(path.delimiter);
  return {
    ...base,
    ...additions,
    HOME: home,
    ...(commandPath ? { PATH: commandPath } : {}),
    XDG_CACHE_HOME: cache,
    XDG_CONFIG_HOME: config,
    XDG_DATA_HOME: data,
    XDG_STATE_HOME: state
  };
}

export {
  isolatedProcessEnv
};
