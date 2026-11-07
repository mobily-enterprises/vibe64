import { chmod, lstat, mkdir, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { portNumbers } from "get-port";
import { vibe64SharedModes } from "@local/vibe64-execution/server";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const DEFAULT_PORT_SEARCH_LIMIT = 50;
const DEFAULT_SOCKET_FILE_NAME = "server.sock";

function preferredPortRange(port) {
  const requestedPort = Number(port) || 0;
  if (requestedPort < 1024 || requestedPort >= 65535) {
    return requestedPort;
  }
  return portNumbers(requestedPort, Math.min(65535, requestedPort + DEFAULT_PORT_SEARCH_LIMIT - 1));
}

function hasOwnOption(options = {}, name = "") {
  return Object.prototype.hasOwnProperty.call(options, name);
}

function explicitOptionValue(options = {}, name = "") {
  return hasOwnOption(options, name) ? options[name] : undefined;
}

function hasExplicitPortOption(options = {}) {
  if (!hasOwnOption(options, "port")) {
    return false;
  }
  return String(options.port ?? "").trim() !== "";
}

/**
 * The listen socket path when none is configured: below XDG_RUNTIME_DIR, or a per-user temporary folder.
 * @param {object} options
 * @param {RuntimeEnv} options.env
 */
function defaultListenSocketPath({ env }) {
  const runtimeDir = String(env.XDG_RUNTIME_DIR || "").trim();
  if (runtimeDir) {
    return path.join(runtimeDir, "vibe64", DEFAULT_SOCKET_FILE_NAME);
  }
  // readable-check: allow method-probe - platform object: process.getuid() exists only on POSIX
  const uid = typeof process.getuid === "function" ? String(process.getuid()) : "user";
  return path.join(os.tmpdir(), `vibe64-${uid}`, DEFAULT_SOCKET_FILE_NAME);
}

/**
 * Where the server listens: a TCP port when one is requested, otherwise a socket.
 * @param {object} input
 * @param {RuntimeEnv} input.env the server's runtime env: its PORT and HOST, and XDG_RUNTIME_DIR for the default
 *   socket path
 * @param {object} [input.options]
 */
function resolveListenTarget({
  env,
  options = {}
}) {
  if (hasExplicitPortOption(options) || env.PORT !== "") {
    const port = Number(explicitOptionValue(options, "port") ?? env.PORT);
    return {
      host: String(explicitOptionValue(options, "host") || env.HOST).trim() || "127.0.0.1",
      port: Number.isFinite(port) ? port : 3000,
      transport: "tcp"
    };
  }

  const configuredSocketPath = String(explicitOptionValue(options, "listenSocket") || "").trim();
  const socketPath = path.resolve(configuredSocketPath || defaultListenSocketPath({ env }));
  const fallbackDirectory = !configuredSocketPath && !String(env.XDG_RUNTIME_DIR || "").trim();
  return {
    // The shared temporary folder lets anyone create the per-user folder first.
    ...(fallbackDirectory ? { privateDirectory: path.dirname(socketPath) } : {}),
    socketPath,
    transport: "socket"
  };
}

/**
 * Makes the per-user socket folder in the shared temporary folder, and refuses
 * one that is not this user's own: another account may have made it first, or
 * put a link there.
 * @param {string} directory
 */
async function preparePrivateSocketDirectory(directory) {
  const directoryMode = vibe64SharedModes().directory;
  await mkdir(directory, { recursive: true, mode: directoryMode });
  const info = await lstat(directory);
  // readable-check: allow method-probe - platform object: process.getuid() exists only on POSIX
  const uid = typeof process.getuid === "function" ? process.getuid() : info.uid;
  // Only a host whose accounts share files through a group lets the group write.
  const foreignWrite = directoryMode & 0o020 ? 0o002 : 0o022;
  if (!info.isDirectory() || info.uid !== uid || (info.mode & foreignWrite) !== 0) {
    const error = new Error(
      `Refusing to listen in ${directory}: it must be a folder of this user that other accounts can't write to. ` +
      "Remove it, or set XDG_RUNTIME_DIR."
    );
    error.code = "vibe64_listen_socket_directory_unsafe";
    throw error;
  }
}

async function removeStaleSocket(socketPath = "") {
  try {
    const info = await lstat(socketPath);
    if (!info.isSocket()) {
      const error = new Error(`Refusing to remove non-socket listen path: ${socketPath}`);
      error.code = "vibe64_listen_path_not_socket";
      throw error;
    }
    await rm(socketPath, {
      force: true
    });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return;
    }
    throw error;
  }
}

/**
 * @param {string} socketPath
 * @param {object} [options]
 * @param {string} [options.privateDirectory] the fallback folder that must be this user's own
 */
async function prepareListenSocket(socketPath = "", { privateDirectory = "" } = {}) {
  if (!socketPath) {
    const error = new Error("Vibe64 listen socket path is required.");
    error.code = "vibe64_listen_socket_required";
    throw error;
  }
  if (privateDirectory) {
    await preparePrivateSocketDirectory(privateDirectory);
  } else {
    await mkdir(path.dirname(socketPath), {
      recursive: true
    });
  }
  await removeStaleSocket(socketPath);
}

async function publishListenSocket(socketPath = "") {
  await chmod(socketPath, vibe64SharedModes().file);
}

export {
  defaultListenSocketPath,
  hasExplicitPortOption,
  preferredPortRange,
  prepareListenSocket,
  publishListenSocket,
  resolveListenTarget
};
