import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */

const VIBE64_CODEX_ATTACHMENTS_ROOT_ENV = "VIBE64_CODEX_ATTACHMENTS_ROOT";

function configuredRoot(env = {}) {
  return String(env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] || "").trim();
}

/**
 * Live session state: each session's agent command helpers, their runs and
 * pending uploads. Agents keep these paths for their whole lifetime, so the
 * root is daemon state, never temporary space that a host may age out. The
 * server sets it below its system root at startup; a caller's environment may
 * name another root, and a process without a server uses the local state root.
 * @param {object} options
 * @param {RuntimeEnv} options.env the caller's env, read before this process's own
 */
function codexAttachmentHostRoot({ env }) {
  return path.resolve(
    configuredRoot(env) ||
    configuredRoot(process.env) ||
    path.join(resolveDefaultLocalEditorSystemRoot(), "attachments")
  );
}

/**
 * Names the attachment root below the system root in env, unless env already names one.
 * @param {string} systemRoot
 * @param {RuntimeEnv} env
 */
function configureCodexAttachmentHostRoot(systemRoot, env) {
  if (!configuredRoot(env)) {
    env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = path.join(path.resolve(systemRoot), "attachments");
  }
  return env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
}

/**
 * @param {object} options
 * @param {RuntimeEnv} options.env the caller's env, read before this process's own
 */
async function prepareCodexAttachmentRoot({ env }) {
  await mkdir(codexAttachmentHostRoot({ env }), {
    recursive: true
  });
}

export {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  configureCodexAttachmentHostRoot,
  prepareCodexAttachmentRoot
};
