import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createService,
  pathMatchesPolicyPattern,
  sourceEditorLanguageForPath
} from "../../packages/vibe64-source-editor/src/server/service.js";

const RIPGREP_AVAILABLE = spawnSync("rg", ["--version"], {
  encoding: "utf8"
}).status === 0;

async function createSourceEditorFixture({
  exclude = ["node_modules", "dist"]
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-editor-"));
  const sessionRoot = path.join(root, "sessions", "active", "session-1");
  const sourceRoot = path.join(sessionRoot, "source");
  await mkdir(path.join(sourceRoot, "src"), {
    recursive: true
  });
  await mkdir(path.join(sourceRoot, "src", "index"), {
    recursive: true
  });
  await mkdir(path.join(sourceRoot, "src", "pages", "admin"), {
    recursive: true
  });
  await mkdir(path.join(sourceRoot, "node_modules", "pkg"), {
    recursive: true
  });
  await mkdir(path.join(sourceRoot, "dist"), {
    recursive: true
  });
  await writeFile(path.join(sourceRoot, "src", "app.js"), "console.log('one');\n");
  await writeFile(path.join(sourceRoot, "src", "index", "pages.jsx"), "export default null;\n");
  await writeFile(path.join(sourceRoot, "src", "pages", "admin", "index.jsx"), "export default null;\n");
  await writeFile(path.join(sourceRoot, "src", "pages", "dashboard.jsx"), "export default null;\n");
  await writeFile(path.join(sourceRoot, "src", "pages-index.jsx"), "export default null;\n");
  await writeFile(
    path.join(sourceRoot, "src", "search-target-with-a-long-file-name.js"),
    "export const visibleNeedle = 'source editor visible needle';\n"
  );
  await writeFile(path.join(sourceRoot, "node_modules", "pkg", "index.js"), "module.exports = 'source editor hidden needle';\n");
  await writeFile(path.join(sourceRoot, "dist", "bundle.js"), "source editor hidden needle\n");

  const service = createService({
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            id: "unit",
            async sourceEditorFilePolicy() {
              return {
                adapterId: "unit",
                exclude,
                maxFileBytes: 1024
              };
            }
          },
          async getSession(sessionId = "") {
            return {
              sessionId,
              sessionRoot,
              sourceReady: true
            };
          }
        };
      }
    }
  });

  return {
    root,
    service,
    sourceRoot
  };
}

test("source editor pattern matching handles adapter-owned directory excludes", () => {
  assert.equal(pathMatchesPolicyPattern("node_modules/pkg/index.js", "node_modules"), true);
  assert.equal(pathMatchesPolicyPattern("packages/app/dist/index.js", "dist"), true);
  assert.equal(pathMatchesPolicyPattern("cmake-build-debug/main.o", "cmake-build-*"), true);
  assert.equal(pathMatchesPolicyPattern("src/app.js", "node_modules"), false);
});

test("source editor reports language groups for supported file types", () => {
  assert.equal(sourceEditorLanguageForPath("src/app.jsx"), "javascript");
  assert.equal(sourceEditorLanguageForPath("config/settings.json"), "json");
  assert.equal(sourceEditorLanguageForPath("src/main.cpp"), "cpp");
  assert.equal(sourceEditorLanguageForPath("scripts/deploy.sh"), "shell");
  assert.equal(sourceEditorLanguageForPath("TODO"), "markdown");
  assert.equal(sourceEditorLanguageForPath("README.txt"), "text");
});

test("source editor tree excludes paths from the adapter policy", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.readTree({
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    const childNames = response.tree.children.map((child) => child.name);
    assert.deepEqual(childNames, ["src"]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor reads and saves files with hash conflict protection", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const readResponse = await fixture.service.readFile({
      path: "src/app.js",
      sessionId: "session-1"
    });
    assert.equal(readResponse.ok, true);
    assert.equal(readResponse.file.text, "console.log('one');\n");

    const saveResponse = await fixture.service.saveFile({
      baseHash: readResponse.file.hash,
      path: "src/app.js",
      sessionId: "session-1",
      text: "console.log('two');\n"
    });
    assert.equal(saveResponse.ok, true);
    assert.equal(await readFile(path.join(fixture.sourceRoot, "src", "app.js"), "utf8"), "console.log('two');\n");

    const conflictResponse = await fixture.service.saveFile({
      baseHash: readResponse.file.hash,
      path: "src/app.js",
      sessionId: "session-1",
      text: "console.log('three');\n"
    });
    assert.equal(conflictResponse.ok, false);
    assert.equal(conflictResponse.statusCode, 409);
    assert.equal(conflictResponse.errors[0].code, "vibe64_source_editor_conflict");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor file matcher uses ripgrep and adapter policy excludes", async (t) => {
  if (!RIPGREP_AVAILABLE) {
    t.skip("ripgrep is not installed in this test environment");
    return;
  }

  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.listFiles({
      query: "search-target",
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    assert.equal(response.truncated, false);
    assert.deepEqual(response.files.map((file) => file.path), [
      "src/search-target-with-a-long-file-name.js"
    ]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor file matcher treats spaces as ordered path tokens", async (t) => {
  if (!RIPGREP_AVAILABLE) {
    t.skip("ripgrep is not installed in this test environment");
    return;
  }

  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.listFiles({
      query: "pages index",
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    assert.equal(response.truncated, false);
    assert.deepEqual(response.files.map((file) => file.path).sort(), [
      "src/pages-index.jsx",
      "src/pages/admin/index.jsx"
    ]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor search uses ripgrep and does not enter excluded folders", async (t) => {
  if (!RIPGREP_AVAILABLE) {
    t.skip("ripgrep is not installed in this test environment");
    return;
  }

  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.search({
      query: "source editor",
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    assert.equal(response.truncated, false);
    assert.deepEqual(response.results.map((result) => result.path), [
      "src/search-target-with-a-long-file-name.js"
    ]);
    assert.equal(response.results[0].line, 1);
    assert.match(response.results[0].preview, /visible needle/u);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor rejects path traversal outside the session source", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.readFile({
      path: "../outside.js",
      sessionId: "session-1"
    });
    assert.equal(response.ok, false);
    assert.equal(response.errors[0].code, "vibe64_invalid_source_editor_path");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});
