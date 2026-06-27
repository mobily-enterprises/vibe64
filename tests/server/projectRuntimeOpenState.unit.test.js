import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  clearProjectRuntimeOpenState,
  projectRuntimeOpenStatePath,
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
} from "@local/vibe64-core/server/projectRuntimeOpenState";
import { withTemporaryRoot } from "./vibe64TestHelpers.js";

test("project runtime open state lives under project local runtime state", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const projectLocalRoot = path.join(targetRoot, ".vibe64-local");
    const expectedPath = path.join(projectLocalRoot, "runtime", "open.json");

    assert.equal(projectRuntimeOpenStatePath(projectLocalRoot), expectedPath);
    assert.equal((await readProjectRuntimeOpenState({
      projectLocalRoot
    })).open, false);

    const written = await writeProjectRuntimeOpenState({
      projectLocalRoot,
      projectSlug: "alpha",
      reason: "project-open",
      targetRoot
    });

    assert.equal(written.open, true);
    assert.equal(written.projectSlug, "alpha");
    assert.equal(JSON.parse(await readFile(expectedPath, "utf8")).open, true);
    assert.equal((await readProjectRuntimeOpenState({
      projectLocalRoot
    })).open, true);

    const cleared = await clearProjectRuntimeOpenState({
      projectLocalRoot
    });

    assert.equal(cleared.open, false);
    assert.equal(Object.hasOwn(cleared, "filePath"), false);
    await assert.rejects(access(expectedPath), {
      code: "ENOENT"
    });
  });
});
