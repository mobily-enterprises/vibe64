import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

import {
  runtimeNetworkName
} from "@local/studio-terminal-core/server/runtimeContainers";
import {
  runHostCommand
} from "@local/studio-terminal-core/server/shellCommands";

async function withTemporaryRoot(callback) {
  const tempRoot = await mkdtemp(path.join(tmpdir(), "vibe64-test-"));
  const tempId = path.basename(tempRoot).replace(/[^A-Za-z0-9_.-]+/gu, "-");
  const root = path.join(tempRoot, `target-${tempId}`);
  await mkdir(root, {
    recursive: true
  });
  try {
    return await callback(root);
  } finally {
    await runHostCommand("docker", ["network", "rm", runtimeNetworkName(root)], {
      timeout: 5_000
    });
    await rm(tempRoot, {
      force: true,
      recursive: true
    });
  }
}

function worktreeMetadata(targetRoot, sessionId = "session") {
  return {
    worktree_path: path.join(targetRoot, ".vibe64-local/sessions/active", sessionId, "worktree")
  };
}

export {
  withTemporaryRoot,
  worktreeMetadata
};
