import assert from "node:assert/strict";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  __testables,
  clearProjectRuntimeOpenState,
  readProjectRuntimeOpenState,
  writeProjectRuntimeOpenState
} from "@local/vibe64-core/server/projectRuntimeOpenState";
import {
  projectRuntimeRoot,
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

const { projectRuntimeOpenStatePath } = __testables;

test("project runtime open state lives under the explicit runtime root", async () => {
  await withTemporaryRoot(async (targetRoot) => {
    const runtimeRoot = projectRuntimeRoot(targetRoot);
    const expectedPath = path.join(runtimeRoot, "runtime", "open.json");

    assert.equal(projectRuntimeOpenStatePath(runtimeRoot), expectedPath);
    assert.equal((await readProjectRuntimeOpenState({
      projectRuntimeRoot: runtimeRoot
    })).open, false);

    const written = await writeProjectRuntimeOpenState({
      projectRuntimeRoot: runtimeRoot,
      projectSlug: "alpha",
      reason: "project-open"
    });

    assert.equal(written.open, true);
    assert.equal(written.projectSlug, "alpha");
    assert.equal(JSON.parse(await readFile(expectedPath, "utf8")).open, true);
    assert.equal((await readProjectRuntimeOpenState({
      projectRuntimeRoot: runtimeRoot
    })).open, true);

    const cleared = await clearProjectRuntimeOpenState({
      projectRuntimeRoot: runtimeRoot
    });

    assert.equal(cleared.open, false);
    assert.equal(Object.hasOwn(cleared, "filePath"), false);
    await assert.rejects(access(expectedPath), {
      code: "ENOENT"
    });
  });
});
