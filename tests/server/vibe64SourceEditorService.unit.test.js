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
import {
  clearSessionUiSyncState,
  readSessionUiSyncState
} from "@local/vibe64-core/server/sessionUiSyncState";
import {
  defaultVibe64SourceExplanationAgentSettings,
  normalizeVibe64AgentSettings
} from "../../packages/vibe64-runtime/src/shared/agentSettings.js";
import {
  vibe64SessionToolDashboardSuffix
} from "../../src/lib/vibe64SessionToolDefinitions.js";

const RIPGREP_AVAILABLE = spawnSync("rg", ["--version"], {
  encoding: "utf8"
}).status === 0;

async function createSourceEditorFixture({
  exclude = ["node_modules", "dist"],
  explanationFollowupGenerator = null,
  explanationGenerator = null,
  extraFiles = [],
  preexpandedDirectories = [],
  preloadDirectories = [],
  terminalService = null
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-editor-"));
  const sessionRoot = path.join(root, "sessions", "active", "session-1");
  const metadataRoot = path.join(sessionRoot, "metadata");
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
  for (const file of extraFiles) {
    const relativePath = String(file?.path || "").replaceAll("\\", "/");
    if (!relativePath) {
      continue;
    }
    const absolutePath = path.join(sourceRoot, relativePath);
    await mkdir(path.dirname(absolutePath), {
      recursive: true
    });
    await writeFile(absolutePath, String(file?.text ?? ""));
  }

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
              metadataRoot,
              sourceReady: true
            };
          }
        };
      }
    },
    terminalService
  });

  return {
    metadataRoot,
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
    const srcNode = response.tree.children.find((child) => child.path === "src");
    assert.equal(srcNode?.loaded, true);
    assert.ok(srcNode.children.some((child) => child.path === "src/app.js"));
    const pagesNode = srcNode.children.find((child) => child.path === "src/pages");
    assert.equal(pagesNode?.loaded, true);
    assert.equal(pagesNode.children.find((child) => child.path === "src/pages/admin")?.loaded, true);
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
  clearSessionUiSyncState();
  const fixture = await createSourceEditorFixture();
  try {
    const readResponse = await fixture.service.readFile({
      path: "src/app.js",
      sessionId: "session-1"
    });
    assert.equal(readResponse.ok, true);
    assert.equal(readResponse.file.text, "console.log('one');\n");
    const nestedReadResponse = await fixture.service.readFile({
      path: "src/pages/admin/index.jsx",
      sessionId: "session-1"
    });
    assert.equal(nestedReadResponse.ok, true);
    assert.equal(nestedReadResponse.revealTree.children[0].path, "src");
    assert.equal(nestedReadResponse.revealTree.children[0].children[0].path, "src/pages");
    assert.equal(nestedReadResponse.revealTree.children[0].children[0].children[0].path, "src/pages/admin");
    assert.equal(
      nestedReadResponse.revealTree.children[0].children[0].children[0].children[0].path,
      "src/pages/admin/index.jsx"
    );

    const openResponse = await fixture.service.broadcastOpenFile({
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "beepollen",
      sessionId: "session-1"
    });
    assert.equal(openResponse.ok, true);
    assert.equal(openResponse.fileOpen.originId, "tab-1");
    assert.equal(openResponse.fileOpen.path, "src/app.js");
    assert.equal(openResponse.fileOpen.projectSlug, "beepollen");
    assert.equal(openResponse.fileOpen.sessionId, "session-1");
    assert.match(openResponse.fileOpen.updatedAt, /^\d{4}-\d{2}-\d{2}T/u);
    assert.deepEqual(readSessionUiSyncState({
      projectSlug: "beepollen",
      sessionId: "session-1"
    }).sourceEditor, openResponse.fileOpen);
    const editorRoutePath = `/app/project/beepollen${vibe64SessionToolDashboardSuffix("editor")}`;
    assert.equal(readSessionUiSyncState({
      projectSlug: "beepollen",
      sessionId: "session-1"
    }).viewState.routeFullPath, editorRoutePath);
    assert.equal(editorRoutePath, "/app/project/beepollen/dashboard/files");

    const saveResponse = await fixture.service.saveFile({
      baseHash: readResponse.file.hash,
      originId: "tab-1",
      path: "src/app.js",
      projectSlug: "beepollen",
      sessionId: "session-1",
      text: "console.log('two');\n"
    });
    assert.equal(saveResponse.ok, true);
    assert.equal(saveResponse.fileChange.hash, saveResponse.file.hash);
    assert.equal(saveResponse.fileChange.originId, "tab-1");
    assert.equal(saveResponse.fileChange.path, "src/app.js");
    assert.equal(saveResponse.fileChange.projectSlug, "beepollen");
    assert.equal(saveResponse.fileChange.sessionId, "session-1");
    assert.equal(saveResponse.fileChange.size, saveResponse.file.size);
    assert.match(saveResponse.fileChange.updatedAt, /^\d{4}-\d{2}-\d{2}T/u);
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

test("source editor creates new files without overwriting existing or excluded paths", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const createResponse = await fixture.service.createFile({
      originId: "tab-1",
      path: "src/features/new-view.ts",
      projectSlug: "beepollen",
      sessionId: "session-1"
    });
    assert.equal(createResponse.ok, true);
    assert.equal(createResponse.file.path, "src/features/new-view.ts");
    assert.equal(createResponse.file.text, "");
    assert.equal(createResponse.fileOpen.path, "src/features/new-view.ts");
    assert.equal(createResponse.fileOpen.projectSlug, "beepollen");
    assert.equal(createResponse.revealTree.children[0].path, "src");
    assert.equal(createResponse.revealTree.children[0].children[0].path, "src/features");
    assert.equal(
      await readFile(path.join(fixture.sourceRoot, "src", "features", "new-view.ts"), "utf8"),
      ""
    );

    const existingResponse = await fixture.service.createFile({
      path: "src/features/new-view.ts",
      sessionId: "session-1"
    });
    assert.equal(existingResponse.ok, false);
    assert.equal(existingResponse.statusCode, 409);
    assert.equal(existingResponse.errors[0].code, "vibe64_source_editor_file_exists");

    const excludedResponse = await fixture.service.createFile({
      path: "dist/generated.js",
      sessionId: "session-1"
    });
    assert.equal(excludedResponse.ok, false);
    assert.equal(excludedResponse.statusCode, 403);
    assert.equal(excludedResponse.errors[0].code, "vibe64_source_editor_file_excluded");

    const traversalResponse = await fixture.service.createFile({
      path: "src/../other.js",
      sessionId: "session-1"
    });
    assert.equal(traversalResponse.ok, false);
    assert.equal(traversalResponse.errors[0].code, "vibe64_invalid_source_editor_path");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor resolves relative import targets inside the session source", async () => {
  const fixture = await createSourceEditorFixture({
    extraFiles: [
      {
        path: "src/client/App.vue",
        text: "import { startServer } from '../server';\n"
      },
      {
        path: "src/server.ts",
        text: "export function startServer() {}\n"
      },
      {
        path: "src/lib/index.js",
        text: "export const lib = true;\n"
      }
    ]
  });
  try {
    const extensionResponse = await fixture.service.resolvePath({
      fromPath: "src/client/App.vue",
      sessionId: "session-1",
      target: "../server"
    });
    const indexResponse = await fixture.service.resolvePath({
      fromPath: "src/client/App.vue",
      sessionId: "session-1",
      target: "../lib"
    });

    assert.equal(extensionResponse.ok, true);
    assert.equal(extensionResponse.resolved, true);
    assert.equal(extensionResponse.path, "src/server.ts");
    assert.equal(indexResponse.ok, true);
    assert.equal(indexResponse.resolved, true);
    assert.equal(indexResponse.path, "src/lib/index.js");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor does not resolve import targets into excluded folders", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.resolvePath({
      fromPath: "src/app.js",
      sessionId: "session-1",
      target: "../node_modules/pkg/index.js"
    });

    assert.equal(response.ok, true);
    assert.equal(response.resolved, false);
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
        agentThreadId: `thread-${generatorCalls.length}`,
        body: `Generated explanation for:\n${input.selectedText}`,
        model: "unit-explainer",
        summary: "Generated source explanation.",
        title: "Generated app.js explanation"
      };
    },
    terminalService: {
      async deleteDetachedAgentChatThread(sessionId, input = {}) {
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
    assert.equal(createResponse.explanation.agentThreadId, "thread-1");
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

test("source editor streams explanation chat events through the agent service", async () => {
  const events = [];
  const streamCalls = [];
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async streamDetachedAgentChatTurn(sessionId, input = {}, options = {}) {
        streamCalls.push(input);
        assert.equal(sessionId, "session-1");
        if (input.promptLabel === "Source code explanation follow-up") {
          assert.equal(input.threadId, "agent-thread-1");
          options.onEvent({
            status: "inProgress",
            threadId: "agent-thread-1",
            turnId: "agent-turn-followup",
            type: "turn"
          });
          return {
            ok: true,
            text: "Follow-up complete.",
            threadId: "agent-thread-1",
            turnId: "agent-turn-followup"
          };
        }
        assert.equal(input.promptLabel, "Source code explanation");
        assert.match(input.prompt, /role in the system/u);
        options.onEvent({
          threadId: "agent-thread-1",
          type: "thread"
        });
        options.onEvent({
          status: "inProgress",
          threadId: "agent-thread-1",
          turnId: "agent-turn-1",
          type: "turn"
        });
        options.onEvent({
          classification: {
            kind: "live_progress",
            text: "## Role\nStreaming"
          },
          threadId: "agent-thread-1",
          turnId: "agent-turn-1",
          type: "notification"
        });
        return {
          ok: true,
          text: "## Role\nStreaming complete",
          threadId: "agent-thread-1",
          turnId: "agent-turn-1"
        };
      }
    }
  });
  try {
    await fixture.service.streamExplanation({
      assistantMessageId: "msg_assistant",
      endColumn: 20,
      endLine: 1,
      explanationId: "exp_stream",
      path: "src/app.js",
      scope: "selection",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      userMessageId: "msg_user"
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });

    assert.deepEqual(events.map((event) => event.type), [
      "source-explanation.started",
      "source-explanation.thread",
      "source-explanation.turn",
      "source-explanation.message",
      "source-explanation.finished"
    ]);
    assert.equal(events[0].explanation.status, "running");
    assert.equal(events[3].text, "## Role\nStreaming");
    assert.equal(events[4].explanation.agentThreadId, "agent-thread-1");
    assert.equal(events[4].explanation.agentTurnId, "agent-turn-1");
    assert.equal(events[4].explanation.model, "gpt-5.3-codex-spark");
    assert.deepEqual(events[4].explanation.agentSettings, defaultVibe64SourceExplanationAgentSettings());
    assert.equal(events[4].explanation.messages.at(-1).text, "## Role\nStreaming complete");
    assert.deepEqual(streamCalls[0].agentSettings, defaultVibe64SourceExplanationAgentSettings());

    const followupEvents = [];
    await fixture.service.streamExplanationFollowup({
      agentSettings: {
        model: "gpt-5.5",
        providerId: "codex",
        thinking: "low"
      },
      assistantMessageId: "msg_followup_assistant",
      explanationId: "exp_stream",
      message: "Can you go deeper?",
      sessionId: "session-1",
      userMessageId: "msg_followup_user"
    }, {
      emit(event) {
        followupEvents.push(event);
      },
      isClosed() {
        return false;
      }
    });
    const followupFinished = followupEvents.find((event) => event.type === "source-explanation.finished");
    assert.deepEqual(streamCalls[1].agentSettings, {
      model: "gpt-5.5",
      providerId: "codex",
      thinking: "low"
    });
    assert.equal(followupFinished.explanation.model, "gpt-5.5");
    assert.deepEqual(followupFinished.explanation.agentSettings, normalizeVibe64AgentSettings({
      model: "gpt-5.5",
      providerId: "codex",
      thinking: "low"
    }));
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor cleans abandoned explanation chats from its disk cleanup ledger", async () => {
  const deletedThreads = [];
  let streamCount = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteDetachedAgentChatThread(sessionId, input = {}) {
        deletedThreads.push({
          sessionId,
          threadId: input.threadId
        });
        return {
          ok: true,
          status: "deleted",
          threadId: input.threadId
        };
      },
      async streamDetachedAgentChatTurn() {
        streamCount += 1;
        return {
          ok: true,
          text: `Explanation ${streamCount}.`,
          threadId: `agent-thread-${streamCount}`,
          turnId: `agent-turn-${streamCount}`
        };
      }
    }
  });
  try {
    for (const explanationId of ["exp_abandoned", "exp_active"]) {
      await fixture.service.streamExplanation({
        assistantMessageId: `${explanationId}_assistant`,
        endColumn: 20,
        endLine: 1,
        explanationId,
        originId: "tab:source-editor",
        path: "src/app.js",
        scope: "selection",
        sessionId: "session-1",
        startColumn: 1,
        startLine: 1,
        userMessageId: `${explanationId}_user`
      }, {
        emit() {},
        isClosed() {
          return false;
        }
      });
    }

    const ledgerPath = path.join(
      fixture.metadataRoot,
      "source-editor-explanation-cleanup.json"
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.deepEqual(ledger.records.map((record) => record.id), [
      "exp_abandoned",
      "exp_active"
    ]);
    for (const record of ledger.records) {
      assert.deepEqual(Object.keys(record).sort(), [
        "agentThreadId",
        "agentTurnId",
        "createdAt",
        "id",
        "originId",
        "sessionId",
        "sourcePath",
        "status",
        "updatedAt"
      ]);
      assert.equal(record.originId, "tab:source-editor");
      assert.equal(record.sourcePath, "src/app.js");
      assert.equal("body" in record, false);
      assert.equal("messages" in record, false);
      assert.equal("followups" in record, false);
      assert.equal("summary" in record, false);
      assert.equal("title" in record, false);
    }

    const cleanupResponse = await fixture.service.cleanupExplanations({
      activeExplanationIds: ["exp_active"],
      originId: "tab:source-editor",
      sessionId: "session-1"
    });
    assert.equal(cleanupResponse.ok, true);
    assert.deepEqual(cleanupResponse.cleaned.map((record) => record.id), ["exp_abandoned"]);
    assert.deepEqual(deletedThreads, [{
      sessionId: "session-1",
      threadId: "agent-thread-1"
    }]);

    const updatedLedger = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.deepEqual(updatedLedger.records.map((record) => record.id), ["exp_active"]);

    updatedLedger.records[0].updatedAt = "2000-01-01T00:00:00.000Z";
    await writeFile(ledgerPath, `${JSON.stringify(updatedLedger, null, 2)}\n`);

    const staleCleanupResponse = await fixture.service.cleanupExplanations({
      activeExplanationIds: [],
      originId: "tab:other",
      sessionId: "session-1"
    });
    assert.equal(staleCleanupResponse.ok, true);
    assert.deepEqual(staleCleanupResponse.cleaned.map((record) => record.id), ["exp_active"]);
    assert.deepEqual(deletedThreads, [
      {
        sessionId: "session-1",
        threadId: "agent-thread-1"
      },
      {
        sessionId: "session-1",
        threadId: "agent-thread-2"
      }
    ]);
    await assert.rejects(
      readFile(ledgerPath, "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor stop is not overwritten by late streaming output", async () => {
  const events = [];
  const interruptedTurns = [];
  let releaseAgentTurn = () => {};
  let markTurnReady = () => {};
  const turnReady = new Promise((resolve) => {
    markTurnReady = resolve;
  });
  const releaseTurn = new Promise((resolve) => {
    releaseAgentTurn = resolve;
  });
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async interruptDetachedAgentChatTurn(sessionId, input = {}) {
        interruptedTurns.push({
          sessionId,
          threadId: input.threadId,
          turnId: input.turnId
        });
        return {
          ok: true,
          status: "interrupted"
        };
      },
      async streamDetachedAgentChatTurn(_sessionId, input = {}, options = {}) {
        assert.equal(input.promptLabel, "Source code explanation");
        options.onEvent({
          threadId: "agent-thread-stop",
          type: "thread"
        });
        options.onEvent({
          status: "inProgress",
          threadId: "agent-thread-stop",
          turnId: "agent-turn-stop",
          type: "turn"
        });
        markTurnReady();
        await releaseTurn;
        return {
          ok: true,
          text: "Late answer should not revive the stopped explanation.",
          threadId: "agent-thread-stop",
          turnId: "agent-turn-stop"
        };
      }
    }
  });
  try {
    const streamPromise = fixture.service.streamExplanation({
      assistantMessageId: "msg_assistant",
      endColumn: 20,
      endLine: 1,
      explanationId: "exp_stop",
      path: "src/app.js",
      scope: "selection",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      userMessageId: "msg_user"
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });

    await turnReady;
    const stopResponse = await fixture.service.stopExplanation({
      explanationId: "exp_stop",
      sessionId: "session-1"
    });
    assert.equal(stopResponse.ok, true);
    assert.equal(stopResponse.explanation.status, "stopped");
    assert.deepEqual(interruptedTurns, [{
      sessionId: "session-1",
      threadId: "agent-thread-stop",
      turnId: "agent-turn-stop"
    }]);

    releaseAgentTurn();
    await streamPromise;
    const finished = events.filter((event) => event.type === "source-explanation.finished").at(-1);
    assert.equal(finished.explanation.status, "stopped");
    assert.equal(finished.explanation.messages.at(-1).status, "stopped");
    assert.notEqual(finished.explanation.body, "Late answer should not revive the stopped explanation.");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor allows whole-file explanations for files larger than selected-range limits", async () => {
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async streamDetachedAgentChatTurn(_sessionId, input = {}) {
        assert.match(input.prompt, /Target: whole file/u);
        assert.match(input.prompt, /only an excerpt is inlined/u);
        assert.match(input.prompt, /Inspect the repository file path/u);
        return {
          ok: true,
          text: "Whole file explained.",
          threadId: "agent-thread-large-file",
          turnId: "agent-turn-large-file"
        };
      }
    }
  });
  try {
    await writeFile(
      path.join(fixture.sourceRoot, "src", "app.js"),
      Array.from({ length: 260 }, () => "x").join("\n")
    );
    const events = [];
    await fixture.service.streamExplanation({
      endColumn: 8,
      endLine: 260,
      path: "src/app.js",
      scope: "file",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });
    const finished = events.find((event) => event.type === "source-explanation.finished");
    assert.equal(finished.explanation.sourceRange.scope, "file");
    assert.equal(finished.explanation.body, "Whole file explained.");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor keeps temporary explanation chat retryable when agent cleanup fails", async () => {
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    explanationFollowupGenerator(_explanation, message) {
      return `Still available for ${message}.`;
    },
    explanationGenerator(input) {
      return {
        agentThreadId: "thread-cleanup-retry",
        body: `Generated explanation for:\n${input.selectedText}`,
        title: "Generated app.js explanation"
      };
    },
    terminalService: {
      async deleteDetachedAgentChatThread(_sessionId, input = {}) {
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

test("source editor file matcher ranks ordered path tokens first", async (t) => {
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
    assert.deepEqual(response.files.map((file) => file.path).slice(0, 2), [
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

test("source editor file matcher finds basename plus unordered path tokens", async (t) => {
  if (!RIPGREP_AVAILABLE) {
    t.skip("ripgrep is not installed in this test environment");
    return;
  }

  const fixture = await createSourceEditorFixture({
    extraFiles: [
      {
        path: "packages/allowed-login-email-policy/src/server/service.js",
        text: "export function allowedLoginEmailPolicy() {}\n"
      }
    ]
  });
  try {
    const allowResponse = await fixture.service.listFiles({
      query: "service allow",
      sessionId: "session-1"
    });
    const loginResponse = await fixture.service.listFiles({
      query: "service login",
      sessionId: "session-1"
    });

    assert.equal(allowResponse.ok, true);
    assert.equal(loginResponse.ok, true);
    assert.equal(allowResponse.files[0]?.path, "packages/allowed-login-email-policy/src/server/service.js");
    assert.equal(loginResponse.files[0]?.path, "packages/allowed-login-email-policy/src/server/service.js");
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
