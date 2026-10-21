import assert from "node:assert/strict";
import { mkdir, readFile, stat, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";

import {
  normalizeProjectPromptHints,
  projectPromptHintsPath,
  readProjectPromptHints,
  saveProjectPromptHints
} from "@local/vibe64-core/server/projectPromptHints";
import {
  withTemporaryRoot
} from "./vibe64TestHelpers.js";

test("project prompt hints default to enabled without creating state", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
    const result = await readProjectPromptHints({ projectRuntimeRoot });

    assert.deepEqual(result.settings, { promptHints: true });
    assert.equal(result.filePath, projectPromptHintsPath(projectRuntimeRoot));
    await assert.rejects(stat(result.filePath), { code: "ENOENT" });
  });
});

test("project prompt hints accept only one boolean setting", () => {
  assert.deepEqual(
    normalizeProjectPromptHints({ promptHints: false }),
    { promptHints: false }
  );
  assert.throws(
    () => normalizeProjectPromptHints({ promptHints: "yes" }),
    { code: "vibe64_project_prompt_hints_invalid" }
  );
  assert.throws(
    () => normalizeProjectPromptHints({ promptHints: true, tone: "direct" }),
    { code: "vibe64_project_prompt_hints_invalid" }
  );
});

test("project prompt hints save one small atomic runtime record", async () => {
  await withTemporaryRoot(async (temporaryRoot) => {
    const projectRuntimeRoot = path.join(temporaryRoot, "runtime");
    const saved = await saveProjectPromptHints({
      projectRuntimeRoot,
      settings: { promptHints: false }
    });

    assert.deepEqual(saved.settings, { promptHints: false });
    assert.deepEqual(
      (await readProjectPromptHints({ projectRuntimeRoot })).settings,
      saved.settings
    );
    assert.equal((await stat(saved.filePath)).mode & 0o777, 0o600);
    assert.deepEqual(JSON.parse(await readFile(saved.filePath, "utf8")), saved.settings);

    await writeFile(saved.filePath, "not-json\n", "utf8");
    await assert.rejects(
      readProjectPromptHints({ projectRuntimeRoot }),
      { code: "vibe64_project_prompt_hints_invalid" }
    );

    await mkdir(path.dirname(saved.filePath), { recursive: true });
    await writeFile(saved.filePath, '{"promptHints":true,"tone":"direct"}\n', "utf8");
    await assert.rejects(
      readProjectPromptHints({ projectRuntimeRoot }),
      { code: "vibe64_project_prompt_hints_invalid" }
    );
  });
});
