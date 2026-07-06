import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  STUDIO_TEMP_DIR_NAME
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const VIBE64_CODEX_ATTACHMENTS_ROOT_ENV = "VIBE64_CODEX_ATTACHMENTS_ROOT";

function processUid() {
  return typeof process.getuid === "function" ? process.getuid() : "user";
}

function defaultCodexAttachmentHostRoot() {
  return path.join(
    tmpdir(),
    `${STUDIO_TEMP_DIR_NAME}-${processUid()}`,
    "attachments"
  );
}

function codexAttachmentHostRoot({
  env = process.env
} = {}) {
  const explicitRoot = String(env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] || "").trim();
  return path.resolve(explicitRoot || defaultCodexAttachmentHostRoot());
}

const CODEX_ATTACHMENT_HOST_ROOT = codexAttachmentHostRoot();

async function prepareCodexAttachmentRoot(options = {}) {
  await mkdir(codexAttachmentHostRoot(options), {
    recursive: true
  });
}

export {
  CODEX_ATTACHMENT_HOST_ROOT,
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
};
