import path from "node:path";

import {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PORT_END_ENV,
  PREVIEW_PROXY_PORT_START_ENV,
  PREVIEW_PROXY_PUBLIC_HOST_ENV
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import {
  DEFAULT_WEB_LAUNCH_TARGET_PORT
} from "@local/studio-terminal-core/server/launchTargetTerminal";

const NESTED_PREVIEW_PROXY_PORT_BASE = 50000;
const NESTED_PREVIEW_PROXY_PORT_SPAN = 100;

function normalizeWebLaunchPort(value, fallback = DEFAULT_WEB_LAUNCH_TARGET_PORT) {
  const port = Number.parseInt(String(value || ""), 10);
  return Number.isInteger(port) && port >= 1024 && port <= 65535
    ? port
    : fallback;
}

function nestedStudioSessionRuntimeRoot({
  directoryName = "",
  session = {},
  worktreePath = ""
} = {}) {
  const name = String(directoryName || "").trim();
  if (!name || path.basename(name) !== name) {
    throw new TypeError("Nested Studio runtime directoryName must be one path segment.");
  }
  const explicitSessionRoot = String(session.sessionRoot || "").trim();
  const sourceRoot = String(worktreePath || "").trim();
  const derivedSessionRoot = !explicitSessionRoot && path.basename(sourceRoot) === "source"
    ? path.dirname(sourceRoot)
    : "";
  const sessionRoot = explicitSessionRoot || derivedSessionRoot;
  return sessionRoot ? path.join(sessionRoot, "runtime", name) : "";
}

function nestedStudioPreviewProxy({
  launchPort = DEFAULT_WEB_LAUNCH_TARGET_PORT
} = {}) {
  const port = normalizeWebLaunchPort(launchPort);
  const offset = Math.max(0, port - DEFAULT_WEB_LAUNCH_TARGET_PORT);
  const lastStart = 65535 - NESTED_PREVIEW_PROXY_PORT_SPAN + 1;
  const start = Math.min(
    lastStart,
    NESTED_PREVIEW_PROXY_PORT_BASE + offset * NESTED_PREVIEW_PROXY_PORT_SPAN
  );
  const portRange = {
    end: start + NESTED_PREVIEW_PROXY_PORT_SPAN - 1,
    start
  };
  return {
    env: {
      [PREVIEW_PROXY_HOST_ENV]: "127.0.0.1",
      [PREVIEW_PROXY_PUBLIC_HOST_ENV]: "127.0.0.1",
      [PREVIEW_PROXY_PORT_START_ENV]: String(portRange.start),
      [PREVIEW_PROXY_PORT_END_ENV]: String(portRange.end)
    },
    portRange
  };
}

export {
  nestedStudioPreviewProxy,
  nestedStudioSessionRuntimeRoot,
  normalizeWebLaunchPort
};
