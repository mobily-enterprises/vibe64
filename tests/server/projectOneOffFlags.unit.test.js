import assert from "node:assert/strict";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  PROJECT_ONE_OFF_FLAGS_DIR,
  consumeProjectOneOffFlag,
  readProjectOneOffFlag,
  writeProjectOneOffFlag
} from "../../packages/vibe64-core/src/server/projectOneOffFlags.js";

async function withTemporaryRoot(operation) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-one-off-flags-"));
  try {
    return await operation(root);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
}

test("project one-off flags persist separately and are consumed idempotently", async () => {
  await withTemporaryRoot(async (projectRuntimeRoot) => {
    const options = {
      name: "application-mode",
      projectRuntimeRoot
    };

    assert.equal(await readProjectOneOffFlag(options), null);

    await writeProjectOneOffFlag({
      ...options,
      value: "existing"
    });

    assert.equal(await readProjectOneOffFlag(options), "existing");
    assert.deepEqual(
      JSON.parse(await readFile(path.join(
        projectRuntimeRoot,
        PROJECT_ONE_OFF_FLAGS_DIR,
        "application-mode.json"
      ), "utf8")),
      { value: "existing" }
    );

    await consumeProjectOneOffFlag(options);
    await consumeProjectOneOffFlag(options);

    assert.equal(await readProjectOneOffFlag(options), null);
  });
});
