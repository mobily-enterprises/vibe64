import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { lstat, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
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
  exclude = ["node_modules", "dist"],
  explanationFollowupGenerator = null,
  explanationGenerator = null,
  preexpandedDirectories = [],
  preloadDirectories = [],
  terminalService = null
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
    explanationFollowupGenerator,
    explanationGenerator,
    projectService: {
      async createRuntime() {
        return {
          adapter: {
            id: "unit",
            async sourceEditorFilePolicy() {
              return {
                adapterId: "unit",
                exclude,
                maxFileBytes: 1024,
                preexpandedDirectories,
                preloadDirectories
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
    },
    terminalService
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
    assert.equal(response.tree.children[0].loaded, false);
    assert.deepEqual(response.tree.children[0].children, []);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor exposes adapter-owned preload and preexpanded directories", async () => {
  const fixture = await createSourceEditorFixture({
    preexpandedDirectories: ["src"],
    preloadDirectories: ["src", "packages"]
  });
  try {
    const response = await fixture.service.readTree({
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    assert.deepEqual(response.policy.preexpandedDirectories, ["src"]);
    assert.deepEqual(response.policy.preloadDirectories, ["src", "packages"]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor tree reads one directory page at a time", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const manyRoot = path.join(fixture.sourceRoot, "many");
    await mkdir(manyRoot, {
      recursive: true
    });
    for (let index = 0; index < 25; index += 1) {
      await writeFile(path.join(manyRoot, `file-${String(index).padStart(2, "0")}.txt`), `${index}\n`);
    }

    const firstPage = await fixture.service.readTree({
      path: "many",
      sessionId: "session-1"
    });
    assert.equal(firstPage.ok, true);
    assert.equal(firstPage.tree.path, "many");
    assert.equal(firstPage.tree.children.length, 20);
    assert.equal(firstPage.tree.hasMore, true);
    assert.equal(firstPage.tree.nextOffset, 20);
    assert.equal(firstPage.tree.total, 25);
    assert.equal(firstPage.tree.children[0].path, "many/file-00.txt");

    const secondPage = await fixture.service.readTree({
      offset: 20,
      path: "many",
      sessionId: "session-1"
    });
    assert.equal(secondPage.ok, true);
    assert.equal(secondPage.tree.children.length, 5);
    assert.equal(secondPage.tree.hasMore, false);
    assert.equal(secondPage.tree.nextOffset, 25);
    assert.equal(secondPage.tree.children[0].path, "many/file-20.txt");
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

test("source editor runs temporary explanation chats, follow-ups, stale state, and cleanup", async () => {
  const generatorCalls = [];
  const deletedThreads = [];
  const fixture = await createSourceEditorFixture({
    explanationFollowupGenerator(explanation, message) {
      return `Answered ${message} for ${explanation.sourceRange.path}:${explanation.sourceRange.startLine}.`;
    },
    explanationGenerator(input) {
      generatorCalls.push(input);
      return {
        body: `Generated explanation for:\n${input.selectedText}`,
        codexSessionId: `thread-${generatorCalls.length}`,
        model: "unit-explainer",
        summary: "Generated source explanation.",
        title: "Generated app.js explanation"
      };
    },
    terminalService: {
      async deleteDetachedCodexChatThread(sessionId, input = {}) {
        deletedThreads.push({
          sessionId,
          threadId: input.threadId
        });
        return {
          ok: true,
          status: "deleted",
          threadId: input.threadId
        };
      }
    }
  });
  try {
    const createResponse = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    assert.equal(createResponse.ok, true);
    assert.equal(createResponse.explanation.title, "Generated app.js explanation");
    assert.equal(createResponse.explanation.model, "unit-explainer");
    assert.equal(createResponse.explanation.codexSessionId, "thread-1");
    assert.equal(createResponse.explanation.stale, false);
    assert.equal(generatorCalls.length, 1);

    const repeatedResponse = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    assert.equal(repeatedResponse.ok, true);
    assert.notEqual(repeatedResponse.explanation.id, createResponse.explanation.id);
    assert.equal(generatorCalls.length, 2);

    const partialResponse = await fixture.service.explainSelection({
      endColumn: 8,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    assert.equal(partialResponse.ok, true);
    assert.notEqual(partialResponse.explanation.id, createResponse.explanation.id);
    assert.equal(generatorCalls.length, 3);
    assert.equal(generatorCalls[2].selectedText, "console");

    const followupResponse = await fixture.service.addExplanationFollowup({
      explanationId: createResponse.explanation.id,
      message: "why?",
      sessionId: "session-1"
    });
    assert.equal(followupResponse.ok, true);
    assert.deepEqual(followupResponse.explanation.followups.map((entry) => entry.role), [
      "user",
      "assistant"
    ]);
    assert.match(followupResponse.explanation.followups[1].text, /Answered why\?/u);

    await writeFile(path.join(fixture.sourceRoot, "src", "app.js"), "console.log('changed');\n");
    const staleResponse = await fixture.service.addExplanationFollowup({
      explanationId: createResponse.explanation.id,
      message: "still current?",
      sessionId: "session-1"
    });
    assert.equal(staleResponse.ok, true);
    assert.equal(staleResponse.explanation.stale, true);
    assert.match(staleResponse.explanation.staleReason, /changed/u);

    const deleteResponse = await fixture.service.deleteExplanation({
      explanationId: createResponse.explanation.id,
      sessionId: "session-1"
    });
    assert.equal(deleteResponse.ok, true);
    assert.equal(deleteResponse.deleted, true);
    assert.deepEqual(deletedThreads, [{
      sessionId: "session-1",
      threadId: "thread-1"
    }]);

    const deletedFollowupResponse = await fixture.service.addExplanationFollowup({
      explanationId: createResponse.explanation.id,
      message: "after close?",
      sessionId: "session-1"
    });
    assert.equal(deletedFollowupResponse.ok, false);
    assert.equal(deletedFollowupResponse.code, "vibe64_source_explanation_not_found");

    await assert.rejects(
      lstat(path.join(fixture.root, "sessions", "active", "session-1", "source-explanations")),
      { code: "ENOENT" }
    );
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor keeps temporary explanation chat retryable when Codex cleanup fails", async () => {
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    explanationFollowupGenerator(_explanation, message) {
      return `Still available for ${message}.`;
    },
    explanationGenerator(input) {
      return {
        body: `Generated explanation for:\n${input.selectedText}`,
        codexSessionId: "thread-cleanup-retry",
        title: "Generated app.js explanation"
      };
    },
    terminalService: {
      async deleteDetachedCodexChatThread(_sessionId, input = {}) {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) {
          return {
            code: "unit_cleanup_failed",
            error: "Unit cleanup failed.",
            ok: false,
            statusCode: 502,
            threadId: input.threadId
          };
        }
        return {
          ok: true,
          status: "deleted",
          threadId: input.threadId
        };
      }
    }
  });
  try {
    const createResponse = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    assert.equal(createResponse.ok, true);

    const failedDeleteResponse = await fixture.service.deleteExplanation({
      explanationId: createResponse.explanation.id,
      sessionId: "session-1"
    });
    assert.equal(failedDeleteResponse.ok, false);
    assert.equal(failedDeleteResponse.code, "unit_cleanup_failed");

    const followupResponse = await fixture.service.addExplanationFollowup({
      explanationId: createResponse.explanation.id,
      message: "cleanup retry",
      sessionId: "session-1"
    });
    assert.equal(followupResponse.ok, true);
    assert.match(followupResponse.explanation.body, /Still available/u);

    const retryDeleteResponse = await fixture.service.deleteExplanation({
      explanationId: createResponse.explanation.id,
      sessionId: "session-1"
    });
    assert.equal(retryDeleteResponse.ok, true);
    assert.equal(retryDeleteResponse.deleted, true);
    assert.equal(cleanupAttempts, 2);
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
