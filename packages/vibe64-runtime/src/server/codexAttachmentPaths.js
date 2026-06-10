import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  STUDIO_TEMP_DIR_NAME
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const CODEX_ATTACHMENT_CONTAINER_ROOT = "/studio-attachments";
const CODEX_ATTACHMENT_HOST_ROOT = path.join(
  tmpdir(),
  STUDIO_TEMP_DIR_NAME,
  "attachments"
);

function codexAttachmentMount() {
  return {
    readOnly: true,
    source: CODEX_ATTACHMENT_HOST_ROOT,
    target: CODEX_ATTACHMENT_CONTAINER_ROOT
  };
}

async function prepareCodexAttachmentRoot() {
  await mkdir(CODEX_ATTACHMENT_HOST_ROOT, {
    recursive: true
  });
}

export {
  CODEX_ATTACHMENT_CONTAINER_ROOT,
  CODEX_ATTACHMENT_HOST_ROOT,
  codexAttachmentMount,
  prepareCodexAttachmentRoot
};
