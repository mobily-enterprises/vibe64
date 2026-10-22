import assert from "node:assert/strict";
import { stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import { resolveDefaultLocalEditorSystemRoot } from "@local/vibe64-core/server/studioRoots";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  configureCodexAttachmentHostRoot
} from "@local/vibe64-runtime/server/codexAttachmentPaths";
import { prepareCodexGitCommand } from "@local/vibe64-terminals/server/codexGitCommand";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

async function withProcessRoot(value, operation) {
  const previous = process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
  if (value) process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = value;
  else delete process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
  try {
    return await operation();
  } finally {
    if (previous === undefined) delete process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
    else process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = previous;
  }
}

function inside(child, parent) {
  const relative = path.relative(path.resolve(parent), path.resolve(child));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

test("live session state defaults to the local state root, never temporary space", async () => {
  await withProcessRoot("", () => {
    const root = codexAttachmentHostRoot({ env: {} });
    assert.equal(root, path.join(resolveDefaultLocalEditorSystemRoot(), "attachments"));
    assert.equal(inside(root, tmpdir()), false, `${root} is inside ${tmpdir()}`);
  });
});

test("the server places live session state below its system root and keeps an explicit root", () => {
  const env = {};
  assert.equal(configureCodexAttachmentHostRoot("/srv/state/vibe64", env), "/srv/state/vibe64/attachments");
  assert.equal(codexAttachmentHostRoot({ env }), "/srv/state/vibe64/attachments");
  const explicit = { [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: "/custom/attachments" };
  assert.equal(configureCodexAttachmentHostRoot("/srv/state/vibe64", explicit), "/custom/attachments");
});

// The incident: callers that pass a curated environment without the variable
// (Claude and OpenCode sessions) wrote agent helpers below os.tmpdir(), where a
// host's temporary-file aging deleted them under live agents.
test("agent command helpers prepared with a curated environment use the process's session state root", async () => {
  await withTemporaryRoot(async (root) => {
    const stateRoot = path.join(root, "daemon-state", "attachments");
    await withProcessRoot(stateRoot, async () => {
      const prepared = await prepareCodexGitCommand({
        commandService: { run: async () => ({ ok: true }) },
        env: { VIBE64_SYSTEM_ROOT: path.join(root, "daemon-state") },
        sessionId: "session-a",
        stateRoot: path.join(root, "project-runtime")
      });
      assert.equal(prepared.ok, true);
      assert.equal(inside(prepared.hostWrapperDir, path.join(stateRoot, "codex-git-command")), true, prepared.hostWrapperDir);
      assert.equal((await stat(path.join(prepared.hostWrapperDir, "git"))).isFile(), true);
    });
  });
});
