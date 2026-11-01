// Where a Preview proxy listens: a loopback port or a private socket, and clearing stale sockets first.

import { connect as netConnect } from "node:net";
import {
  chmod,
  lstat,
  mkdir,
  readdir,
  unlink
} from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import {
  PREVIEW_PROXY_HOST_ENV,
  PREVIEW_PROXY_PUBLIC_HOST_ENV,
  previewProxyPortRange
} from "@local/vibe64-core/server/launchPreviewProxyEnv";
import { previewProxyDebugLog } from "./launchPreviewDebugLog.js";

const LOOPBACK_HOST = "127.0.0.1";

const PREVIEW_PROXY_SOCKET_DIR_ENV = "VIBE64_PREVIEW_PROXY_SOCKET_DIR";

const PREVIEW_PUBLIC_SOCKET_BASENAME_PATTERN = /^v64preview-[a-f0-9]{12}--[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:--p[0-9]{1,5})?\.sock$/u;

async function listenOnPreviewPort(server, {
  env = process.env,
  host = previewProxyListenHost(env),
  portEnd = undefined,
  portStart = undefined
} = {}) {
  const configuredRange = previewProxyPortRange(env);
  const firstPort = portStart || configuredRange.start;
  const lastPort = portEnd || configuredRange.end;
  const publicHost = previewProxyPublicHost(host, env);
  for (let port = firstPort; port <= lastPort; port += 1) {
    const listened = await tryListen(server, port, host);
    if (listened) {
      return {
        host,
        kind: "port",
        origin: `http://${publicHost}:${port}`,
        port,
        publicHost
      };
    }
  }
  throw new Error(`No launch preview proxy port is available in ${firstPort}-${lastPort}.`);
}

/**
 * The shared temporary directory is writable by every account, so the private
 * parent must already belong to this user before sockets go inside it.
 */
async function assertPrivateFallbackSocketParent(socketDir = "") {
  const parent = path.dirname(socketDir);
  await mkdir(parent, { mode: 0o700, recursive: true });
  const entry = await lstat(parent);
  // readable-check: allow optional-call - platform object: process.getuid() exists only on POSIX
  const uid = process.getuid?.();
  if (!entry.isDirectory() || (uid !== undefined && entry.uid !== uid) || (entry.mode & 0o077) !== 0) {
    throw new Error(`Preview socket folder ${parent} must be a private folder owned by this user. ` +
      `Remove it, or set XDG_RUNTIME_DIR or ${PREVIEW_PROXY_SOCKET_DIR_ENV}.`);
  }
}

async function preparePreviewSocketDirectory(env = process.env) {
  const socketDir = previewProxySocketDir(env);
  if (socketDir === fallbackPreviewProxySocketDir()) {
    await assertPrivateFallbackSocketParent(socketDir);
  }
  await mkdir(socketDir, {
    mode: 0o700,
    recursive: true
  });
  await chmod(socketDir, 0o700);
  return socketDir;
}

async function pruneStalePreviewSockets({
  env = process.env,
  socketHasLiveListener = previewSocketHasLiveListener
} = {}) {
  const socketDir = await preparePreviewSocketDirectory(env);
  const names = await readdir(socketDir);
  let preserved = 0;
  let removed = 0;
  for (const name of names) {
    if (!PREVIEW_PUBLIC_SOCKET_BASENAME_PATTERN.test(name)) {
      continue;
    }
    const socketPath = path.join(socketDir, name);
    let entry;
    try {
      entry = await lstat(socketPath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        continue;
      }
      throw error;
    }
    if (!entry.isSocket()) {
      preserved += 1;
      continue;
    }
    if (await socketHasLiveListener(socketPath)) {
      preserved += 1;
      continue;
    }
    await unlinkIfExists(socketPath);
    removed += 1;
  }
  if (removed > 0) {
    previewProxyDebugLog("server.launchPreviewProxy.staleSocketsPruned", {
      preserved,
      removed,
      socketDir
    });
  }
  return {
    preserved,
    removed,
    socketDir
  };
}

async function listenOnPreviewSocket(server, {
  env = process.env,
  publicOrigin = ""
} = {}) {
  const socketPath = previewPublicSocketPath(publicOrigin, env);
  await preparePreviewSocketDirectory(env);
  const listened = await tryListenOnPreviewSocket(server, socketPath);
  if (!listened) {
    const hasLiveListener = await previewSocketHasLiveListener(socketPath);
    if (hasLiveListener) {
      const error = new Error(`Launch preview proxy socket is already in use by a live listener: ${socketPath}`);
      error.code = "EADDRINUSE";
      error.address = socketPath;
      throw error;
    }
    await unlinkIfExists(socketPath);
    await listenOnPreviewSocketAfterStaleCleanup(server, socketPath);
  }
  await chmod(socketPath, 0o600);
  const socket = await lstat(socketPath);
  return {
    kind: "socket",
    origin: publicOrigin,
    port: "",
    publicHost: new URL(publicOrigin).host,
    socketDevice: socket.dev,
    socketInode: socket.ino,
    socketPath
  };
}

async function listenOnPreviewSocketAfterStaleCleanup(server, socketPath = "") {
  const listened = await tryListenOnPreviewSocket(server, socketPath);
  if (listened) {
    return;
  }
  const error = new Error(`Launch preview proxy socket is already in use after stale cleanup: ${socketPath}`);
  error.code = "EADDRINUSE";
  error.address = socketPath;
  throw error;
}

function tryListenOnPreviewSocket(server, socketPath = "") {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      if (error?.code === "EADDRINUSE") {
        resolve(false);
        return;
      }
      reject(error);
    };
    function onListening() {
      server.off("error", onError);
      resolve(true);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(socketPath);
  });
}

function previewSocketHasLiveListener(socketPath = "") {
  return new Promise((resolve) => {
    const socket = netConnect(socketPath);
    let settled = false;
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      socket.removeAllListeners();
      socket.destroy();
      resolve(value);
    };
    socket.once("connect", () => finish(true));
    socket.once("error", (error) => {
      if (["ECONNREFUSED", "ENOENT", "ENOTSOCK"].includes(String(error?.code || ""))) {
        finish(false);
        return;
      }
      finish(true);
    });
    socket.setTimeout(250, () => finish(true));
  });
}

async function unlinkIfExists(targetPath = "") {
  if (!targetPath) {
    return;
  }
  try {
    await unlink(targetPath);
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
}

function normalizePreviewPublicOrigin(value = "") {
  const text = String(value || "").trim();
  if (!text) {
    return "";
  }
  const url = new URL(text);
  if (!["http:", "https:"].includes(url.protocol)) {
    throw new Error("Launch preview public origin must use HTTP or HTTPS.");
  }
  url.pathname = "/";
  url.search = "";
  url.hash = "";
  return url.origin;
}

function previewPublicSocketPath(publicOrigin = "", env = process.env) {
  const origin = normalizePreviewPublicOrigin(publicOrigin);
  const url = new URL(origin);
  const host = url.hostname;
  // A Preview nests under its editor host: <preview>.<workspace>.<domain>.
  const match = /^(v64preview-[a-z0-9]{12})\.([a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)\./u.exec(host);
  if (!match) {
    throw new Error("Launch preview public origin must use the <preview>.<workspace> host format.");
  }
  const socketDir = previewProxySocketDir(env);
  const portSuffix = url.port ? `--p${url.port}` : "";
  return path.join(socketDir, `${match[1]}--${match[2]}${portSuffix}.sock`);
}

function previewProxySocketDir(env = process.env) {
  const configured = String(env[PREVIEW_PROXY_SOCKET_DIR_ENV] || "").trim();
  if (configured) {
    return configured;
  }
  const runtimeDir = String(env.XDG_RUNTIME_DIR || "").trim();
  if (runtimeDir) {
    return path.join(runtimeDir, "vibe64", "apps");
  }
  return fallbackPreviewProxySocketDir();
}

/**
 * A Unix socket path holds at most 107 bytes, and TMPDIR may name a long
 * folder (macOS gives each user one), so the fallback is always under /tmp.
 */
function fallbackPreviewProxySocketDir() {
  // readable-check: allow optional-call - platform object: process.getuid() exists only on POSIX
  return path.join("/tmp", `vibe64-${process.getuid?.() ?? os.userInfo().username}`, "apps");
}

function tryListen(server, port, host) {
  return new Promise((resolve, reject) => {
    const onError = (error) => {
      server.off("listening", onListening);
      if (error?.code === "EADDRINUSE" || error?.code === "EACCES") {
        resolve(false);
        return;
      }
      reject(error);
    };
    function onListening() {
      server.off("error", onError);
      resolve(true);
    }
    server.once("error", onError);
    server.once("listening", onListening);
    server.listen(port, host);
  });
}

function previewProxyListenHost(env = process.env) {
  return String(env[PREVIEW_PROXY_HOST_ENV] || LOOPBACK_HOST).trim() || LOOPBACK_HOST;
}

function previewProxyPublicHost(listenHost = LOOPBACK_HOST, env = process.env) {
  const configured = String(env[PREVIEW_PROXY_PUBLIC_HOST_ENV] || "").trim();
  if (configured) {
    return configured;
  }
  return ["0.0.0.0", "::", "[::]"].includes(String(listenHost || ""))
    ? LOOPBACK_HOST
    : listenHost;
}

export {
  assertPrivateFallbackSocketParent,
  listenOnPreviewPort,
  listenOnPreviewSocket,
  normalizePreviewPublicOrigin,
  previewProxyListenHost,
  previewPublicSocketPath,
  pruneStalePreviewSockets,
  unlinkIfExists
};
