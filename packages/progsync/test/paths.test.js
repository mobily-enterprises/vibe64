import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  implementationToProgramPath,
  programToImplementationPath,
  projectionPathForProgram,
  resolveModulePair,
  targetForImplementationPath
} from "../src/index.js";

test("maps implementation, Program, and projection paths mechanically", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-paths-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  assert.equal(
    implementationToProgramPath("src/server/alerts.js"),
    "program/src/server/alerts.js.md"
  );
  assert.equal(
    programToImplementationPath("program/src/server/alerts.js.md"),
    "src/server/alerts.js"
  );
  assert.equal(
    projectionPathForProgram("program/src/server/alerts.js.md"),
    ".program/index/src/server/alerts.js.md.json"
  );
  assert.deepEqual(
    resolveModulePair(root, "src/server/alerts.js"),
    {
      projectRoot: root,
      programPath: "program/src/server/alerts.js.md",
      implementationPath: "src/server/alerts.js",
      target: {
        extension: ".js",
        kind: "javascript",
        prompt: "javascript.txt"
      }
    }
  );
  assert.deepEqual(targetForImplementationPath("bin/task.mjs"), {
    extension: ".mjs",
    kind: "javascript",
    prompt: "javascript.txt"
  });
  assert.deepEqual(targetForImplementationPath("public/index.html"), {
    extension: ".html",
    kind: "html",
    prompt: "html.txt"
  });
  assert.deepEqual(targetForImplementationPath("src/App.vue"), {
    extension: ".vue",
    kind: "vue",
    prompt: "vue.txt"
  });
});

test("rejects unsupported and outside-project targets", async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "progsync-paths-"));
  t.after(() => fs.rm(root, { recursive: true, force: true }));

  assert.throws(
    () => implementationToProgramPath("src/theme.css"),
    (error) => error.code === "UNSUPPORTED_TARGET"
  );
  assert.throws(
    () => resolveModulePair(root, path.join(root, "..", "outside.js")),
    (error) => error.code === "PATH_OUTSIDE_PROJECT"
  );
});
