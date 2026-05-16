import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";

async function withTemporaryRoot(callback) {
  const root = await mkdtemp(path.join(tmpdir(), "ai-studio-test-"));
  try {
    return await callback(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

export {
  withTemporaryRoot
};
