import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES,
  parseVibe64ArchitectureInspectionLines,
  readArchitecturePreviewLocator
} from "../../packages/vibe64-genesis/src/server/architectureInspection.js";

const RECIPE = Object.freeze([
  "### Inspector `vue`: Routes and calls",
  "- Runtime: `nodejs`",
  "- Directory: `.`",
  "- Command: `node` `inspect.mjs`"
]);

function inspector(...fields) {
  return parseVibe64ArchitectureInspectionLines([...RECIPE, ...fields])[0];
}

function invalid(fields, message) {
  assert.throws(() => inspector(...fields), (error) => {
    assert.equal(error.code, "VIBE64_ARCHITECTURE_INSPECTION_INVALID");
    assert.match(error.message, message);
    return true;
  });
}

async function withSource(operation) {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-preview-locator-"));
  try {
    const sourceRoot = path.join(root, "source");
    await mkdir(path.join(sourceRoot, "node_modules", "@scope", "inspector", "src"), { recursive: true });
    await operation({ root, sourceRoot });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
}

test("inspection limits reach 120 seconds and 64 MiB of output, and no further", () => {
  const largest = inspector("- Timeout seconds: `120`", "- Max output bytes: `67108864`");
  assert.equal(largest.timeout, 120_000);
  assert.equal(largest.maxBuffer, 67_108_864);
  invalid(["- Timeout seconds: `121`", "- Max output bytes: `1`"], /Timeout seconds must be from 1 to 120\./u);
  invalid(["- Timeout seconds: `1`", "- Max output bytes: `67108865`"], /Max output bytes must be from 1 to 67108864\./u);
  invalid(["- Timeout seconds: `0`", "- Max output bytes: `1`"], /Timeout seconds must be from 1 to 120\./u);
});

test("a Preview locator is an optional project-relative .js path", () => {
  const limits = ["- Timeout seconds: `90`", "- Max output bytes: `33554432`"];
  assert.equal(inspector(...limits).previewLocator, undefined);
  assert.equal(
    inspector(...limits, "- Preview locator: `node_modules/@scope/inspector/src/previewLocator.js`").previewLocator,
    "node_modules/@scope/inspector/src/previewLocator.js"
  );
  for (const value of ["../locator.js", "/abs/locator.js", "src/../locator.js", "src//locator.js"]) {
    invalid([...limits, `- Preview locator: \`${value}\``], /Preview locator must be a canonical project-relative path\./u);
  }
  for (const value of ["src/locator.mjs", "src/locator.ts", "src/locator.JS", "src/locator"]) {
    invalid([...limits, `- Preview locator: \`${value}\``], /Preview locator must name a \.js file\./u);
  }
  invalid([...limits, "- Preview locator: `a.js` `b.js`"], /Preview locator must contain exactly 1 backticked value\./u);
  invalid([...limits, "- Preview locator: `a.js`", "- Preview locator: `b.js`"], /Duplicate Preview locator\./u);
});

test("a Preview locator file is a regular file of at most 64 KiB inside the source, reached without symlinks", async () => {
  await withSource(async ({ root, sourceRoot }) => {
    const locator = "node_modules/@scope/inspector/src/previewLocator.js";
    await writeFile(path.join(sourceRoot, locator), "export default () => null;\n");
    assert.deepEqual(await readArchitecturePreviewLocator(sourceRoot, locator), {
      path: locator,
      source: "export default () => null;\n"
    });

    const rejects = async (value, message) => assert.rejects(readArchitecturePreviewLocator(sourceRoot, value), (error) => {
      assert.equal(error.code, "VIBE64_ARCHITECTURE_INSPECTION_INVALID");
      assert.match(error.message, message);
      return true;
    });

    await writeFile(path.join(sourceRoot, "largest.js"), "x".repeat(ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES));
    assert.equal((await readArchitecturePreviewLocator(sourceRoot, "largest.js")).source.length, 65_536);
    await writeFile(path.join(sourceRoot, "large.js"), "x".repeat(ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES + 1));
    await rejects("large.js", /must be at most 65536 bytes/u);

    await rejects("missing.js", /`missing\.js` is not a file in this project/u);
    await mkdir(path.join(sourceRoot, "folder.js"));
    await rejects("folder.js", /`folder\.js` must be a regular file/u);

    await writeFile(path.join(root, "outside.js"), "secret");
    await symlink(path.join(root, "outside.js"), path.join(sourceRoot, "linked.js"));
    await rejects("linked.js", /`linked\.js` must not be or pass through a symlink/u);
    await symlink(path.join(sourceRoot, "node_modules", "@scope", "inspector"), path.join(sourceRoot, "node_modules", "linked-package"));
    await rejects("node_modules/linked-package/src/previewLocator.js", /must not be or pass through a symlink/u);

    await rejects("../outside.js", /Preview locator must be a canonical project-relative path\./u);
    await rejects("src/locator.mjs", /Preview locator must name a \.js file\./u);
  });
});
