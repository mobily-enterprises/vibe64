import { mkdir } from "node:fs/promises";
import path from "node:path";
import process from "node:process";

import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";

const VIBE64_CODEX_ATTACHMENTS_ROOT_ENV = "VIBE64_CODEX_ATTACHMENTS_ROOT";

function configuredRoot(env = {}) {
  return String(env?.[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] || "").trim();
}

// Live session state: each session's agent command helpers, their runs and
// pending uploads. Agents keep these paths for their whole lifetime, so the
// root is daemon state, never temporary space that a host may age out. The
// server sets it below its system root at startup; a caller's environment may
// name another root, and a process without a server uses the local state root.
function codexAttachmentHostRoot({
  env = process.env
} = {}) {
  return path.resolve(
    configuredRoot(env) ||
    configuredRoot(process.env) ||
    path.join(resolveDefaultLocalEditorSystemRoot(), "attachments")
  );
}

function configureCodexAttachmentHostRoot(systemRoot = "", env = process.env) {
  if (!configuredRoot(env)) {
    env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = path.join(path.resolve(systemRoot), "attachments");
  }
  return env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
}

async function prepareCodexAttachmentRoot(options = {}) {
  await mkdir(codexAttachmentHostRoot(options), {
    recursive: true
  });
}

export {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  configureCodexAttachmentHostRoot,
  prepareCodexAttachmentRoot
};
