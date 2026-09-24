import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import crypto from "node:crypto";
import { lstat, mkdtemp, mkdir, readFile, readdir, rename, rm, symlink, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { test } from "node:test";

import {
  createService,
  pathMatchesPolicyPattern,
  sourceEditorLanguageForPath
} from "../../packages/vibe64-source-editor/src/server/service.js";
import {
  SESSION_SOURCE_PATH_AUTHORITY_MANAGED
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  createVibe64SessionStore
} from "@local/vibe64-runtime/server";
import {
  VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
  VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT
} from "@local/vibe64-core/server/sourceEditorRealtimeEvents";

const RIPGREP_AVAILABLE = spawnSync("rg", ["--version"], {
  encoding: "utf8"
}).status === 0;

function resolvedSourceExplanationProfile() {
  return {
    limits: {
      maxInputCharacters: 80_000,
      maxOutputCharacters: 32_000,
      timeoutMs: 180_000
    },
    model: "gpt-5.6-luna",
    policy: {
      environmentAccess: false,
      networkAccess: false,
      repositoryWrite: false,
      tools: "none"
    },
    profileId: "economy",
    providerId: "codex",
    request: {
      allowProviderModelFallback: false,
      reasoning: true,
      summary: false
    },
    revision: "codex-economy-v1",
    thinking: "low",
    workloadId: "source_explanation"
  };
}

function sourceRoutingDecision(engineId = "codex", connectionIdentity = "codex-account-fixture-v1") {
  return { available: true, effectiveSelection: { engineId, modelId: "gpt-5.6-luna",
    modelProviderId: "openai", agentId: "build", variantId: "", catalogRevision: `sha256:${"a".repeat(64)}`,
    schema: "vibe64.assistant-selection.v1" }, connectionIdentity };
}

function structuredExplanation(answer = "") {
  return JSON.stringify({ answer });
}

function sourceMetadata(sourceRoot) {
  return {
    source_kind: "session_clone",
    source_path: sourceRoot,
    source_path_authority: SESSION_SOURCE_PATH_AUTHORITY_MANAGED
  };
}

async function createSourceEditorFixture({
  agentAccountIdentitySignature = "codex-account-fixture-v1",
  agentProviderId = "",
  explanationCacheNow = Date.now,
  explanationFollowupGenerator = null,
  explanationGenerator = null,
  extraFiles = [],
  sessionState = null,
  sourceFileObserver = null,
  terminalService = null,
  writeExclusive = null
} = {}) {
  const root = await mkdtemp(path.join(os.tmpdir(), "vibe64-source-editor-"));
  const sessionId = "session-1";
  const temporaryRoot = path.join(root, "runtime-temp");
  const sourceEditorTempRoot = path.join(
    temporaryRoot,
    "vibe64-source-editor",
    crypto.createHash("sha256").update(sessionId).digest("hex").slice(0, 24)
  );
  const sourceRoot = path.join(root, "managed-source", "sessions", "active", sessionId, "source");
  await mkdir(temporaryRoot, {
    recursive: true
  });
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

  const helperScopes = [];
  const fixtureTerminalService = {
    async resolveAssistantPurpose() {
      const providerId = typeof agentProviderId === "function" ? agentProviderId() : agentProviderId;
      const connectionIdentity = typeof agentAccountIdentitySignature === "function"
        ? agentAccountIdentitySignature() : agentAccountIdentitySignature;
      return sourceRoutingDecision(providerId || "codex", connectionIdentity);
    },
    resolveEphemeralAgentExecutionProfile() {
      const providerId = typeof agentProviderId === "function" ? agentProviderId() : agentProviderId;
      return { ...resolvedSourceExplanationProfile(), providerId: providerId || "codex" };
    },
    async deleteEphemeralAgentConversation(_scope, input) {
      return input.conversationId ? { ok: false, error: "No native cleanup mock supplied." } : { ok: true };
    },
    ...(terminalService || {})
  };
  for (const method of ["resolveEphemeralAgentExecutionProfile", "runEphemeralAgentChatTurn", "deleteEphemeralAgentConversation", "stopEphemeralAgentConversation"]) {
    const operation = fixtureTerminalService[method];
    if (typeof operation !== "function") continue;
    fixtureTerminalService[method] = async (scope, input, options = {}) => {
      assert.match(scope.id, /^source_[a-f0-9-]+$/u);
      assert.equal(scope.workdir, path.join(root, "state/assistant-helpers", scope.id, "workdir"));
      assert.deepEqual(scope.environment, {});
      assert.equal(options.session, undefined);
      assert.equal(options.runtime, undefined);
      assert.equal(options.assistantSelection.engineId.length > 0, true);
      helperScopes.push(scope);
      if (method !== "runEphemeralAgentChatTurn") return operation(scope, input, options);
      // This test boundary stands in for the manager: AbortSignal stops the exact
      // observed native turn and settlement waits for its acknowledgement.
      let conversationId = input.threadId || "";
      let runId = "";
      let stopping;
      const abort = () => {
        if (conversationId && runId) {
          stopping = fixtureTerminalService.stopEphemeralAgentConversation(scope, {
            conversationId, runId, executionProfile: input.executionProfile
          }, options);
          void stopping.catch(() => {});
        }
      };
      options.signal?.addEventListener("abort", abort, { once: true });
      try {
        return await operation(scope, input, { ...options, async onEvent(event) {
          if (event.type === "thread") conversationId = event.threadId;
          if (event.type === "turn") runId = event.turnId;
          await options.onEvent?.(event);
        } });
      } finally {
        options.signal?.removeEventListener("abort", abort);
        await stopping;
        options.signal?.throwIfAborted();
      }
    };
  }
  const serviceOptions = {
    explanationCacheNow,
    explanationFollowupGenerator,
    explanationGenerator,
    projectService: {
      async createRuntime() {
        return {
          stateRoot: path.join(root, "state"),
          get adapter() {
            throw new Error("The neutral source editor must not inspect a legacy adapter.");
          },
          async getSession(sessionId = "") {
            const providerId = typeof agentProviderId === "function"
              ? agentProviderId()
              : agentProviderId;
            const currentSessionState = typeof sessionState === "function"
              ? sessionState()
              : (sessionState || {});
            return {
              ...currentSessionState,
              metadata: {
                assistant_selection: JSON.stringify({ ...sourceRoutingDecision(providerId || "codex").effectiveSelection, modelId: "gpt-6-astra" }),
                ...sourceMetadata(path.join(path.dirname(path.dirname(sourceRoot)), sessionId, "source")),
                ...(providerId ? { agent_identity_provider: providerId } : {}),
                ...(currentSessionState.metadata || {})
              },
              sessionId,
              sourceReady: true
            };
          },
          ...(typeof writeExclusive === "function"
            ? {
                store: {
                  runSessionExclusive: writeExclusive
                }
              }
            : {})
        };
      }
    },
    sourceFileObserver,
    terminalService: fixtureTerminalService,
    temporaryRoot
  };
  const service = createService(serviceOptions);

  return {
    root,
    service,
    helperScopes,
    restartService: () => createService(serviceOptions),
    sourceEditorTempRoot,
    sourceRoot
  };
}

test("starred files are durable, personal, project-scoped and shared across sessions", async (t) => {
  const fixture = await createSourceEditorFixture();
  const other = await createSourceEditorFixture();
  t.after(() => Promise.all([fixture, other].map(({ root }) => rm(root, { recursive: true, force: true }))));
  const input = { sessionId: "session-1", vibe64User: { uid: 1001, username: "ada" } };
  const secondSource = path.join(path.dirname(path.dirname(fixture.sourceRoot)), "session-2/source/src");
  await mkdir(secondSource, { recursive: true });
  await writeFile(path.join(secondSource, "app.js"), "session two\n");
  assert.equal((await fixture.service.setStarredFile({ ...input, path: "src/app.js", starred: true })).ok, true);
  assert.deepEqual((await fixture.service.readStarredFiles({ ...input, sessionId: "session-2" })).files,
    [{ path: "src/app.js", available: true }]);
  assert.deepEqual((await fixture.service.readStarredFiles({ ...input, vibe64User: { uid: 1002, username: "bob" } })).files, []);
  assert.deepEqual((await other.service.readStarredFiles(input)).files, []);
  const records = await readdir(path.join(fixture.root, "state/source-editor/stars"));
  assert.equal(records.length, 1);
  const record = path.join(fixture.root, "state/source-editor/stars", records[0]);
  assert.deepEqual(JSON.parse(await readFile(record, "utf8")).paths, ["src/app.js"]);
  assert.equal((await lstat(record)).mode & 0o777, 0o600);
  await rm(path.join(fixture.sourceRoot, "src/app.js"));
  assert.deepEqual((await fixture.service.readStarredFiles(input)).files,
    [{ path: "src/app.js", available: false, reason: "Not found in this session" }]);
  assert.deepEqual((await fixture.service.setStarredFile({ ...input, path: "src/app.js", starred: false })).paths, []);
});

test("concurrent stars do not lose updates and reject excluded paths and symlinks", async (t) => {
  const { root, sourceRoot, service } = await createSourceEditorFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const input = { sessionId: "session-1", vibe64User: { username: "ada" }, starred: true };
  const results = await Promise.all(["src/app.js", "src/pages-index.jsx"].map((filePath) => service.setStarredFile({ ...input, path: filePath })));
  assert.ok(results.every((result) => result.ok));
  assert.equal((await service.readStarredFiles(input)).files.length, 2);
  await symlink(path.join(sourceRoot, "src/app.js"), path.join(sourceRoot, "link.js"));
  for (const filePath of ["../secret", ".git/config", "link.js", "src", "missing.js"]) {
    assert.equal((await service.setStarredFile({ ...input, path: filePath })).ok, false, filePath);
    assert.equal((await service.downloadFile({ ...input, path: filePath })).ok, false, filePath);
  }
  assert.equal((await service.setStarredFile({ ...input, path: "src/app.js", starred: "yes" })).ok, false);
});

test("downloads preserve binary bytes and allow files larger than the text editor limit", async (t) => {
  const { root, sourceRoot, service } = await createSourceEditorFixture();
  t.after(() => rm(root, { recursive: true, force: true }));
  const bytes = Buffer.alloc(2 * 1024 * 1024, 0x82);
  bytes[0] = 0;
  await writeFile(path.join(sourceRoot, "résumé.bin"), bytes);
  const input = { sessionId: "session-1", path: "résumé.bin" };
  assert.equal((await service.readFile(input)).ok, false);
  const download = await service.downloadFile(input);
  assert.equal(download.ok, true);
  assert.equal(download.name, "résumé.bin");
  const chunks = [];
  for await (const chunk of download.fileHandle.createReadStream({ autoClose: true })) chunks.push(chunk);
  assert.deepEqual(Buffer.concat(chunks), bytes);
  assert.equal(download.fileHandle.fd, -1);
  assert.equal((await service.setStarredFile({ ...input, starred: true })).ok, true);
});

test("source editor pattern matching handles directory excludes", () => {
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

test("source editor tree uses a neutral policy and excludes VCS internals", async () => {
  const fixture = await createSourceEditorFixture({
    extraFiles: [{
      path: ".git/config",
      text: "[core]\n"
    }]
  });
  try {
    const response = await fixture.service.readTree({
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    const childNames = response.tree.children.map((child) => child.name);
    assert.deepEqual(childNames, ["dist", "node_modules", "src"]);
    assert.equal(childNames.includes(".git"), false);
    assert.deepEqual(response.policy.preexpandedDirectories, []);
    assert.deepEqual(response.policy.preloadDirectories, []);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor observes only an explicitly opened, policy-approved file", async () => {
  let closeStream = null;
  let observed = null;
  let observerListener = null;
  let unsubscribed = false;
  let markObserverSubscribed;
  const observerSubscribed = new Promise((resolve) => {
    markObserverSubscribed = resolve;
  });
  const sourceFileObserver = {
    close() {},
    subscribe(options, listener) {
      observed = options;
      observerListener = listener;
      markObserverSubscribed();
      return () => {
        unsubscribed = true;
      };
    }
  };
  const fixture = await createSourceEditorFixture({
    extraFiles: [{
      path: ".git/config",
      text: "[core]\n"
    }],
    sourceFileObserver
  });
  try {
    const emitted = [];
    const streaming = fixture.service.streamFileChanges({
      path: "src/app.js",
      sessionId: "session-1"
    }, {
      emit(event, payload) {
        emitted.push({
          event,
          payload
        });
      },
      isClosed: () => false,
      onClose(handler) {
        closeStream = handler;
      }
    });
    await observerSubscribed;

    assert.deepEqual(observed, {
      relativePath: "src/app.js",
      sourceRoot: fixture.sourceRoot
    });
    observerListener({
      kind: "ready"
    });
    observerListener({
      kind: "change",
      updatedAt: "2026-08-13T00:00:00.000Z"
    });
    assert.equal(emitted[0].event, VIBE64_SOURCE_EDITOR_SYNC_READY_EVENT);
    assert.deepEqual(emitted[1], {
      event: VIBE64_SOURCE_EDITOR_FILE_CHANGED_EVENT,
      payload: {
        originId: "filesystem",
        path: "src/app.js",
        sessionId: "session-1",
        updatedAt: "2026-08-13T00:00:00.000Z"
      }
    });

    closeStream();
    await streaming;
    assert.equal(unsubscribed, true);

    for (const excludedPath of [".git/config"]) {
      await assert.rejects(() => fixture.service.streamFileChanges({
        path: excludedPath,
        sessionId: "session-1"
      }, {
        emit() {},
        isClosed: () => false,
        onClose() {}
      }), /excluded from source editing/u);
    }
  } finally {
    fixture.service.close();
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor does not invent technology-specific preload directories", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    const response = await fixture.service.readTree({
      sessionId: "session-1"
    });
    assert.equal(response.ok, true);
    assert.deepEqual(response.policy.preexpandedDirectories, []);
    assert.deepEqual(response.policy.preloadDirectories, []);
    const srcNode = response.tree.children.find((child) => child.path === "src");
    assert.equal(srcNode?.loaded, false);
    assert.deepEqual(srcNode?.children, []);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor root pages preserve neutral metadata for query-style inputs", async () => {
  const fixture = await createSourceEditorFixture({
    extraFiles: [{ path: "a-root.txt", text: "Root file\n" }]
  });
  try {
    for (const page of [
      { offset: "0", nextOffset: 2, hasMore: true, paths: ["dist", "node_modules"] },
      { offset: "2", nextOffset: 4, hasMore: false, paths: ["src", "a-root.txt"] }
    ]) {
      const response = await fixture.service.readTree({
        limit: "2",
        offset: page.offset,
        path: ".",
        sessionId: "session-1"
      });
      assert.equal(response.ok, true);
      assert.equal(response.root, "");
      assert.deepEqual(response.policy.defaultOpenFiles, []);
      assert.deepEqual(response.policy.preexpandedDirectories, []);
      assert.deepEqual(response.policy.preloadDirectories, []);
      const { children, ...metadata } = response.tree;
      assert.deepEqual(metadata, {
        hasMore: page.hasMore,
        limit: 2,
        loaded: true,
        name: "",
        nextOffset: page.nextOffset,
        offset: Number(page.offset),
        path: "",
        total: 4,
        truncated: false,
        type: "directory"
      });
      assert.deepEqual(children.map((child) => child.path), page.paths);
      for (const child of children) {
        if (child.path === "a-root.txt") {
          assert.equal(child.type, "file");
        } else {
          assert.equal(child.type, "directory");
          assert.equal(child.loaded, false);
          assert.deepEqual(child.children, []);
        }
      }
    }

    const acceptedPath = await fixture.service.readTree({
      limit: "2",
      offset: "0",
      path: "./ src",
      sessionId: "session-1"
    });
    assert.equal(acceptedPath.ok, true);
    assert.equal(acceptedPath.tree.path, "src");
    assert.deepEqual(acceptedPath.tree.children.map((child) => child.path), ["src/index", "src/pages"]);
  } finally {
    fixture.service.close();
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
    assert.deepEqual(
      (await readdir(path.join(fixture.sourceRoot, "src"))).filter((entry) => entry.startsWith(".vibe64-editor-")),
      []
    );
    assert.equal(
      (await readdir(fixture.sourceEditorTempRoot)).length,
      0
    );

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
    assert.equal(createResponse.fileChange.hash, createResponse.file.hash);
    assert.equal(createResponse.fileChange.originId, "tab-1");
    assert.equal(createResponse.fileChange.path, "src/features/new-view.ts");
    assert.equal(createResponse.fileChange.projectSlug, "beepollen");
    assert.equal(createResponse.fileChange.sessionId, "session-1");
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
      path: ".git/generated.js",
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

    const text = '{"version":1,"actors":[]}\n';
    const initialized = await fixture.service.createFile({ path: "data-overview.json", sessionId: "session-1", text });
    assert.equal(initialized.ok, true);
    assert.equal(initialized.file.text, text);
    assert.equal(await readFile(path.join(fixture.sourceRoot, "data-overview.json"), "utf8"), text);
    const binary = await fixture.service.createFile({ path: "invalid.json", sessionId: "session-1", text: "a\u0000b" });
    assert.equal(binary.ok, false);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor serializes writes with session renewal and keeps quiesced source read-only", async () => {
  const lockCalls = [];
  let quiesced = false;
  const fixture = await createSourceEditorFixture({
    async writeExclusive(sessionId, operationName, operation) {
      lockCalls.push({ operationName, sessionId });
      if (quiesced) {
        const error = new Error("Session renewal is in progress.");
        error.code = "vibe64_session_renewal_quiesced";
        error.statusCode = 409;
        throw error;
      }
      return {
        acquired: true,
        value: await operation()
      };
    }
  });
  try {
    const read = await fixture.service.readFile({
      path: "src/app.js",
      sessionId: "session-1"
    });
    const saved = await fixture.service.saveFile({
      baseHash: read.file.hash,
      path: "src/app.js",
      sessionId: "session-1",
      text: "console.log('before renewal');\n"
    });
    assert.equal(saved.ok, true);
    quiesced = true;

    const blockedSave = await fixture.service.saveFile({
      baseHash: saved.file.hash,
      path: "src/app.js",
      sessionId: "session-1",
      text: "console.log('after renewal');\n"
    });
    const blockedCreate = await fixture.service.createFile({
      path: "src/created-during-renewal.js",
      sessionId: "session-1"
    });

    assert.equal(blockedSave.ok, false);
    assert.equal(blockedSave.statusCode, 409);
    assert.equal(blockedSave.errors[0].code, "vibe64_session_renewal_quiesced");
    assert.equal(blockedCreate.ok, false);
    assert.equal(blockedCreate.errors[0].code, "vibe64_session_renewal_quiesced");
    assert.equal(
      await readFile(path.join(fixture.sourceRoot, "src", "app.js"), "utf8"),
      "console.log('before renewal');\n"
    );
    await assert.rejects(
      readFile(path.join(fixture.sourceRoot, "src", "created-during-renewal.js")),
      { code: "ENOENT" }
    );
    assert.deepEqual(lockCalls, [
      { operationName: "agent-write-mode", sessionId: "session-1" },
      { operationName: "agent-write-mode", sessionId: "session-1" },
      { operationName: "agent-write-mode", sessionId: "session-1" }
    ]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor rejects assistant-backed explanations before inspecting a quiesced provider", async () => {
  let providerInspections = 0;
  const fixture = await createSourceEditorFixture({
    sessionState: {
      status: "renewal_quiesced"
    },
    terminalService: {
      resolveAssistantPurpose() {
        providerInspections += 1;
        throw new Error("The provider must not be inspected after renewal quiescence.");
      }
    }
  });
  try {
    const blocked = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.errors[0].code, "vibe64_session_renewal_quiesced");
    assert.equal(providerInspections, 0);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor rejects explanation admission before provider inspection or ledger writes", async () => {
  let providerInspections = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      resolveAssistantPurpose() {
        providerInspections += 1;
        throw new Error("Provider inspection must stay behind session admission.");
      }
    },
    async writeExclusive() {
      return {
        acquired: false,
        value: {
          code: "vibe64_session_renewal_quiesced",
          error: "Session renewal is in progress.",
          ok: false,
          retryable: true
        }
      };
    }
  });
  try {
    const blocked = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(blocked.ok, false);
    assert.equal(blocked.statusCode, 409);
    assert.equal(blocked.errors[0].code, "vibe64_source_explanation_busy");
    assert.equal(providerInspections, 0);
    await assert.rejects(
      readFile(path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor keeps provider failure cleanup ownership inside its conversation admission", async () => {
  let fixture = null;
  let lockHeld = false;
  let lockReleased = false;
  const providerStages = [];
  fixture = await createSourceEditorFixture({
    terminalService: {
      resolveAssistantPurpose() {
        assert.equal(lockHeld, true);
        providerStages.push("describe");
        return sourceRoutingDecision("codex", "codex-account-fixture-v1");
      },
      async deleteEphemeralAgentConversation(_sessionId, input = {}) {
        assert.equal(lockHeld, true);
        providerStages.push("cleanup");
        return {
          code: "unit_cleanup_failed",
          error: "Unit cleanup failed.",
          ok: false,
          threadId: input.conversationId
        };
      },
      resolveEphemeralAgentExecutionProfile() {
        assert.equal(lockHeld, true);
        providerStages.push("profile");
        return resolvedSourceExplanationProfile();
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        assert.equal(lockHeld, true);
        providerStages.push("turn");
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-admission-failure",
          type: "thread"
        });
        await options.onEvent({
          threadId: "agent-thread-admission-failure",
          turnId: "agent-turn-admission-failure",
          type: "turn"
        });
        const error = new Error("Unit detached turn failed.");
        error.code = "unit_detached_turn_failed";
        error.statusCode = 502;
        throw error;
      }
    },
    async writeExclusive(_sessionId, operationName, operation) {
      assert.match(operationName, /^source-explanation-/u);
      assert.equal(lockHeld, false);
      lockHeld = true;
      try {
        return {
          acquired: true,
          value: await operation()
        };
      } catch (error) {
        const ledger = JSON.parse(await readFile(path.join(
          fixture.sourceEditorTempRoot,
          "source-editor-explanation-cleanup.json"
        ), "utf8"));
        assert.equal(ledger.records.length, 1);
        assert.equal(ledger.records[0].agentThreadId, "agent-thread-admission-failure");
        throw error;
      } finally {
        lockHeld = false;
        lockReleased = true;
      }
    }
  });
  try {
    const failed = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(failed.ok, false);
    assert.equal(failed.code, "unit_detached_turn_failed");
    assert.equal(lockReleased, true);
    assert.deepEqual(providerStages, ["describe", "profile", "turn", "cleanup"]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("explanations overlap source work and exclude only a second turn in the same conversation", async (t) => {
  const entered = Promise.withResolvers();
  const finish = Promise.withResolvers();
  let store;
  const fixture = await createSourceEditorFixture({
    writeExclusive(...args) {
      return store.runSessionExclusive(...args);
    },
    terminalService: {
      async runEphemeralAgentChatTurn(_sessionId, _input, options) {
        await options.onEvent({ threadId: "thread-concurrent", type: "thread" });
        await options.onEvent({ threadId: "thread-concurrent", turnId: "turn-concurrent", type: "turn" });
        entered.resolve();
        await finish.promise;
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("This logs one."),
          threadId: "thread-concurrent",
          turnId: "turn-concurrent"
        };
      }
    }
  });
  t.after(async () => {
    finish.resolve();
    fixture.service.close();
    await rm(fixture.root, { force: true, recursive: true });
  });
  store = createVibe64SessionStore({
    projectContextRoot: fixture.sourceRoot,
    projectRuntimeRoot: path.join(fixture.root, "session-runtime")
  });
  await store.createSession({ sessionId: "session-1" });
  const input = {
    explanationId: "exp_concurrent",
    path: "src/app.js",
    scope: "file",
    sessionId: "session-1"
  };
  let explaining;
  const foreground = await store.runSessionExclusive("session-1", "agent-write-mode", async () => {
    explaining = fixture.service.streamExplanation(input);
    await entered.promise;
    return "foreground completed while explanation was answering";
  });
  assert.equal(foreground.acquired, true);
  const duplicate = await fixture.service.addExplanationFollowup({
    explanationId: input.explanationId,
    message: "Another question",
    sessionId: input.sessionId
  });
  assert.equal(duplicate.code, "vibe64_source_explanation_busy");
  const current = await fixture.service.readFile(input);
  const saved = await fixture.service.saveFile({
    ...input,
    baseHash: current.file.hash,
    text: "console.log('two');\n"
  });
  assert.equal(saved.ok, true);
  finish.resolve();
  await explaining;
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

test("source editor does not resolve import targets into VCS internals", async () => {
  const fixture = await createSourceEditorFixture({
    extraFiles: [{
      path: ".git/config",
      text: "[core]\n"
    }]
  });
  try {
    const response = await fixture.service.resolvePath({
      fromPath: "src/app.js",
      sessionId: "session-1",
      target: "../.git/config"
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
      async deleteEphemeralAgentConversation(sessionId, input = {}) {
        deletedThreads.push({
          threadId: input.conversationId
        });
        return {
          ok: true,
          status: "deleted",
          threadId: input.conversationId
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
      async runEphemeralAgentChatTurn(sessionId, input = {}, options = {}) {
        streamCalls.push({ ...input, expectedConnectionIdentity: options.expectedConnectionIdentity });
        if (input.promptLabel === "Source code explanation follow-up") {
          assert.equal(input.threadId, "agent-thread-1");
          await options.onEvent({
            status: "inProgress",
            threadId: "agent-thread-1",
            turnId: "agent-turn-followup",
            type: "turn"
          });
          return {
            executionProfile: resolvedSourceExplanationProfile(),
            ok: true,
            text: structuredExplanation("Follow-up complete."),
            threadId: "agent-thread-1",
            turnId: "agent-turn-followup"
          };
        }
        assert.equal(input.promptLabel, "Source code explanation");
        assert.match(input.prompt, /role in the system/u);
        await options.onEvent({
          threadId: "agent-thread-1",
          type: "thread"
        });
        await options.onEvent({
          status: "inProgress",
          threadId: "agent-thread-1",
          turnId: "agent-turn-1",
          type: "turn"
        });
        await options.onEvent({
          classification: {
            kind: "live_progress",
            text: "## Role\nStreaming"
          },
          threadId: "agent-thread-1",
          turnId: "agent-turn-1",
          type: "notification"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("## Role\nStreaming complete"),
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

    assert.equal(events.find((event) => event.type === "source-explanation.error"), undefined, JSON.stringify(events));
    assert.deepEqual(events.map((event) => event.type), [
      "source-explanation.started",
      "source-explanation.thread",
      "source-explanation.turn",
      "source-explanation.execution-profile",
      "source-explanation.message",
      "source-explanation.finished"
    ]);
    assert.equal(events[0].explanation.status, "running");
    assert.deepEqual(events[3].executionProfile, resolvedSourceExplanationProfile());
    assert.equal(events[4].text, "## Role\nStreaming complete");
    assert.equal(events[5].explanation.agentThreadId, "agent-thread-1");
    assert.equal(events[5].explanation.agentTurnId, "agent-turn-1");
    assert.equal(events[5].explanation.model, "gpt-5.6-luna");
    assert.equal(events[5].explanation.agentSettings, null);
    assert.deepEqual(events[5].explanation.executionProfile, resolvedSourceExplanationProfile());
    assert.equal(events[5].explanation.messages.at(-1).text, "## Role\nStreaming complete");
    assert.equal(streamCalls[0].agentSettings, undefined);
    assert.deepEqual(streamCalls[0].executionProfile, resolvedSourceExplanationProfile());
    assert.equal(
      streamCalls[0].expectedConnectionIdentity,
      "codex-account-fixture-v1"
    );
    assert.deepEqual(streamCalls[0].outputSchema.required, ["answer"]);
    assert.equal(streamCalls[0].outputSchema.properties.answer.maxLength, 5_000);
    assert.match(streamCalls[0].prompt, /5,000 characters/u);
    assert.match(streamCalls[0].prompt, /Use only the bounded source context/u);
    assert.doesNotMatch(streamCalls[0].prompt, /inspect the repository read-only/iu);

    const followupEvents = [];
    await fixture.service.streamExplanationFollowup({
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
    assert.equal(streamCalls[1].agentSettings, undefined);
    assert.equal(streamCalls[1].outputSchema.properties.answer.maxLength, 4_000);
    assert.match(streamCalls[1].prompt, /4,000 characters/u);
    assert.equal(
      streamCalls[1].expectedConnectionIdentity,
      "codex-account-fixture-v1"
    );
    assert.deepEqual(streamCalls[1].executionProfile, resolvedSourceExplanationProfile());
    assert.equal(followupFinished.explanation.model, "gpt-5.6-luna");
    assert.equal(followupFinished.explanation.agentSettings, null);
    assert.deepEqual(followupFinished.explanation.executionProfile, resolvedSourceExplanationProfile());
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor persists the resolved profile while running and through an interrupted failure", async () => {
  const events = [];
  let cleanupAttempts = 0;
  let markTurnReady = () => {};
  let releaseTurn = () => {};
  const turnReady = new Promise((resolve) => {
    markTurnReady = resolve;
  });
  const turnReleased = new Promise((resolve) => {
    releaseTurn = resolve;
  });
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation() {
        cleanupAttempts += 1;
        return { ok: true };
      },
      async stopEphemeralAgentConversation(_sessionId, input = {}) {
        assert.deepEqual(input.executionProfile, resolvedSourceExplanationProfile());
        releaseTurn();
        return {
          ok: true,
          status: "interrupted"
        };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-audited-stop",
          type: "thread"
        });
        await options.onEvent({
          status: "inProgress",
          threadId: "agent-thread-audited-stop",
          turnId: "agent-turn-audited-stop",
          type: "turn"
        });
        markTurnReady();
        await turnReleased;
        return {
          code: "vibe64_codex_turn_interrupted",
          error: "The source explanation was interrupted.",
          executionProfile: resolvedSourceExplanationProfile(),
          ok: false,
          threadId: "agent-thread-audited-stop",
          turnId: "agent-turn-audited-stop"
        };
      }
    }
  });
  try {
    const streaming = fixture.service.streamExplanation({
      assistantMessageId: "msg_audited_stop_assistant",
      endColumn: 20,
      endLine: 1,
      explanationId: "exp_audited_stop",
      path: "src/app.js",
      scope: "selection",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      userMessageId: "msg_audited_stop_user"
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });

    await turnReady;
    const profileEvent = events.find((event) => event.type === "source-explanation.execution-profile");
    assert.deepEqual(profileEvent.explanation.executionProfile, resolvedSourceExplanationProfile());
    assert.equal(profileEvent.explanation.status, "running");

    const stopped = await fixture.service.stopExplanation({
      explanationId: "exp_audited_stop",
      sessionId: "session-1"
    });
    assert.equal(stopped.ok, true);
    assert.equal(stopped.explanation.status, "stopped");
    assert.deepEqual(stopped.explanation.executionProfile, resolvedSourceExplanationProfile());

    releaseTurn();
    await streaming;
    const finished = events.filter((event) => event.type === "source-explanation.finished").at(-1);
    assert.equal(finished.explanation.status, "stopped");
    assert.deepEqual(finished.explanation.executionProfile, resolvedSourceExplanationProfile());
    assert.equal(cleanupAttempts, 0);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor deletes announced streaming threads when the resulting explanation is unusable", async (t) => {
  const outcomes = [
    "throws",
    "rejected",
    "missing-profile",
    "wrong-profile",
    "invalid-output"
  ];
  for (const outcome of outcomes) {
    await t.test(outcome, async () => {
      const deletedThreads = [];
      const threadId = `agent-thread-stream-${outcome}`;
      const turnId = `agent-turn-stream-${outcome}`;
      const fixture = await createSourceEditorFixture({
        terminalService: {
          async deleteEphemeralAgentConversation(sessionId, input = {}) {
            deletedThreads.push({
              executionProfile: input.executionProfile,
              threadId: input.conversationId
            });
            return { ok: true };
          },
          async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
            await options.onEvent({
              executionProfile: resolvedSourceExplanationProfile(),
              type: "execution-profile"
            });
            await options.onEvent({
              threadId,
              type: "thread"
            });
            await options.onEvent({
              threadId,
              turnId,
              type: "turn"
            });
            if (outcome === "throws") {
              const error = new Error("Unit streaming turn threw.");
              error.code = "unit_stream_threw";
              throw Object.freeze(error);
            }
            if (outcome === "rejected") {
              return {
                code: "unit_stream_rejected",
                error: "Unit streaming turn was rejected.",
                executionProfile: resolvedSourceExplanationProfile(),
                ok: false,
                threadId,
                turnId
              };
            }
            const result = {
              ok: true,
              text: structuredExplanation("A structurally valid streaming answer."),
              threadId,
              turnId
            };
            if (outcome !== "missing-profile") {
              result.executionProfile = outcome === "wrong-profile"
                ? {
                    ...resolvedSourceExplanationProfile(),
                    workloadId: "commit_title"
                  }
                : resolvedSourceExplanationProfile();
            }
            if (outcome === "invalid-output") {
              result.text = "not-json";
            }
            return result;
          }
        }
      });
      const events = [];
      try {
        await fixture.service.streamExplanation({
          assistantMessageId: `msg_assistant_${outcome}`,
          endColumn: 20,
          endLine: 1,
          explanationId: `exp_stream_${outcome}`,
          path: "src/app.js",
          sessionId: "session-1",
          startColumn: 1,
          startLine: 1,
          userMessageId: `msg_user_${outcome}`
        }, {
          emit(event) {
            events.push(event);
          },
          isClosed() {
            return false;
          }
        });

        assert.deepEqual(deletedThreads, [{
          executionProfile: resolvedSourceExplanationProfile(),
          threadId
        }]);
        const failed = events.find((event) => event.type === "source-explanation.failed");
        assert.equal(failed.explanation.status, "failed");
        assert.equal(failed.explanation.agentThreadId, "");
        assert.equal(failed.explanation.agentTurnId, "");
        assert.deepEqual(
          failed.explanation.executionProfile,
          resolvedSourceExplanationProfile()
        );
        await assert.rejects(
          readFile(path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json"), "utf8"),
          { code: "ENOENT" }
        );
      } finally {
        await rm(fixture.root, {
          force: true,
          recursive: true
        });
      }
    });
  }
});

test("source editor retains streaming ownership unless cleanup explicitly succeeds", async () => {
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation() {
        cleanupAttempts += 1;
        return cleanupAttempts === 1 ? undefined : { ok: true };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-stream-retry",
          type: "thread"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: "not-json",
          threadId: "agent-thread-stream-retry",
          turnId: "agent-turn-stream-retry"
        };
      }
    }
  });
  const events = [];
  try {
    await fixture.service.streamExplanation({
      endColumn: 20,
      endLine: 1,
      explanationId: "exp_stream_retry",
      path: "src/app.js",
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

    const failed = events.find((event) => event.type === "source-explanation.failed");
    assert.equal(failed.explanation.status, "failed");
    assert.equal(failed.explanation.agentThreadId, "agent-thread-stream-retry");
    const ledgerPath = path.join(
      fixture.sourceEditorTempRoot,
      "source-editor-explanation-cleanup.json"
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.equal(ledger.records[0].agentThreadId, "agent-thread-stream-retry");

    const retry = await fixture.service.deleteExplanation({
      explanationId: "exp_stream_retry",
      sessionId: "session-1"
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.deleted, true);
    assert.equal(cleanupAttempts, 2);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor immediately cleans a non-stream result missing its final audit profile", async () => {
  const deletedThreads = [];
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation(sessionId, input = {}) {
        deletedThreads.push({
          threadId: input.conversationId
        });
        return {
          ok: true,
          status: "deleted"
        };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-invalid-cleaned",
          type: "thread"
        });
        return {
          ok: true,
          text: structuredExplanation("This answer lacks a final audit profile."),
          threadId: "agent-thread-invalid-cleaned",
          turnId: "agent-turn-invalid-cleaned"
        };
      }
    }
  });
  try {
    const response = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      originId: "tab:invalid-cleaned",
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(response.ok, false);
    assert.equal(response.code, "vibe64_source_explanation_execution_profile_missing");
    assert.deepEqual(deletedThreads, [{
      threadId: "agent-thread-invalid-cleaned"
    }]);
    await assert.rejects(
      readFile(path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor isolates helper execution while retaining the selected connection and user", async () => {
  const operationOptions = [];
  const vibe64User = {
    email: "ada@example.test",
    username: "ada"
  };
  const fixture = await createSourceEditorFixture({
    agentAccountIdentitySignature: "codex-account-ada-v1",
    agentProviderId: "codex",
    terminalService: {
      resolveAssistantPurpose(_input, options = {}) {
        assert.equal(options.session.metadata.agent_identity_provider, "codex");
        assert.deepEqual(options.vibe64User, vibe64User);
        assert.equal(typeof options.runtime.getSession, "function");
        return sourceRoutingDecision("codex", "codex-account-ada-v1");
      },
      async deleteEphemeralAgentConversation(_sessionId, input, options = {}) {
        assert.deepEqual(input.executionProfile, resolvedSourceExplanationProfile());
        operationOptions.push(options);
        return {
          ok: true,
          status: "deleted"
        };
      },
      async runEphemeralAgentChatTurn(_sessionId, input, options = {}) {
        assert.equal(options.expectedConnectionIdentity, "codex-account-ada-v1");
        operationOptions.push(options);
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-provider-context",
          type: "thread"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("Provider context answer."),
          threadId: "agent-thread-provider-context",
          turnId: "agent-turn-provider-context"
        };
      }
    }
  });
  try {
    const created = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      vibe64User
    });
    assert.equal(created.ok, true);
    const deleted = await fixture.service.deleteExplanation({
      explanationId: created.explanation.id,
      sessionId: "session-1",
      vibe64User
    });
    assert.equal(deleted.ok, true);
    assert.equal(operationOptions.length, 2);
    for (const options of operationOptions) {
      assert.equal(options.assistantSelection.engineId, "codex");
      assert.equal(options.session, undefined);
      assert.equal(options.runtime, undefined);
      assert.deepEqual(options.vibe64User, vibe64User);
    }
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor cleans a rejected non-stream agent result after its thread is announced", async () => {
  const deletedThreads = [];
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation(sessionId, input = {}) {
        deletedThreads.push({
          executionProfile: input.executionProfile,
          threadId: input.conversationId
        });
        return {
          ok: true,
          status: "deleted"
        };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-rejected-cleaned",
          type: "thread"
        });
        return {
          code: "unit_agent_rejected",
          error: "Unit agent rejected the explanation.",
          executionProfile: resolvedSourceExplanationProfile(),
          ok: false,
          threadId: "agent-thread-rejected-cleaned",
          turnId: "agent-turn-rejected-cleaned"
        };
      }
    }
  });
  try {
    const response = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(response.ok, false);
    assert.equal(response.code, "unit_agent_rejected");
    assert.deepEqual(deletedThreads, [{
      executionProfile: resolvedSourceExplanationProfile(),
      threadId: "agent-thread-rejected-cleaned"
    }]);
    await assert.rejects(
      readFile(path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json"), "utf8"),
      { code: "ENOENT" }
    );
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor retains cleanup ownership when a non-stream agent throws after announcing a thread", async () => {
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation(_sessionId, input = {}) {
        cleanupAttempts += 1;
        return cleanupAttempts === 1
          ? {
              code: "unit_cleanup_failed",
              error: "Unit cleanup failed.",
              ok: false,
              threadId: input.conversationId
            }
          : {
              ok: true,
              status: "deleted",
              threadId: input.conversationId
            };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-thrown-retry",
          type: "thread"
        });
        await options.onEvent({
          threadId: "agent-thread-thrown-retry",
          turnId: "agent-turn-thrown-retry",
          type: "turn"
        });
        const error = new Error("Unit detached turn failed.");
        error.code = "unit_detached_turn_failed";
        error.statusCode = 502;
        throw Object.freeze(error);
      }
    }
  });
  try {
    const response = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(response.ok, false);
    assert.equal(response.code, "unit_detached_turn_failed");
    assert.equal(response.details.cleanupRequired, true);
    assert.equal(response.details.cleanupThreadId, "agent-thread-thrown-retry");
    assert.match(response.details.cleanupExplanationId, /^exp_/u);
    const retry = await fixture.service.deleteExplanation({
      explanationId: response.details.cleanupExplanationId,
      sessionId: "session-1"
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.deleted, true);
    assert.equal(cleanupAttempts, 2);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor does not accept a missing cleanup acknowledgement for an invalid result", async () => {
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation(_sessionId, input = {}) {
        cleanupAttempts += 1;
        return cleanupAttempts === 1
          ? undefined
          : {
              ok: true,
              status: "deleted",
              threadId: input.conversationId
            };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-invalid-retry",
          type: "thread"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: "not-json",
          threadId: "agent-thread-invalid-retry",
          turnId: "agent-turn-invalid-retry"
        };
      }
    }
  });
  try {
    const response = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      originId: "tab:invalid-retry",
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(response.ok, false);
    assert.equal(response.details.cleanupRequired, true);
    assert.equal(response.details.cleanupThreadId, "agent-thread-invalid-retry");
    const cleanupExplanationId = response.details.cleanupExplanationId;
    assert.match(cleanupExplanationId, /^exp_/u);
    const ledgerPath = path.join(
      fixture.sourceEditorTempRoot,
      "source-editor-explanation-cleanup.json"
    );
    const ledger = JSON.parse(await readFile(ledgerPath, "utf8"));
    assert.equal(ledger.records.length, 1);
    assert.equal(ledger.records[0].id, cleanupExplanationId);
    assert.equal(ledger.records[0].status, "failed");
    assert.equal(ledger.records[0].agentThreadId, "agent-thread-invalid-retry");
    assert.equal(ledger.records[0].agentTurnId, "agent-turn-invalid-retry");

    const retry = await fixture.service.deleteExplanation({
      explanationId: cleanupExplanationId,
      sessionId: "session-1"
    });
    assert.equal(retry.ok, true);
    assert.equal(retry.deleted, true);
    assert.equal(cleanupAttempts, 2);
    await assert.rejects(readFile(ledgerPath, "utf8"), { code: "ENOENT" });
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor cache invalidates on source or provider changes and force bypasses", async () => {
  let initialCalls = 0;
  let followupCalls = 0;
  let accountIdentitySignature = "codex-account-ada-v1";
  let providerId = "codex";
  let vibe64User = {
    username: "ada"
  };
  const fixture = await createSourceEditorFixture({
    agentProviderId: () => providerId,
    terminalService: {
      resolveAssistantPurpose(_input, options = {}) {
        assert.equal(options.session.metadata.agent_identity_provider, providerId);
        assert.deepEqual(options.vibe64User, vibe64User);
        assert.equal(typeof options.runtime.getSession, "function");
        return sourceRoutingDecision(providerId, accountIdentitySignature);
      },
      async runEphemeralAgentChatTurn(_sessionId, input = {}, options = {}) {
        assert.equal(options.assistantSelection.engineId, providerId);
        assert.deepEqual(options.vibe64User, vibe64User);
        if (input.promptLabel === "Source code explanation follow-up") {
          followupCalls += 1;
          assert.equal(input.threadId, "");
          await options.onEvent({
            executionProfile: resolvedSourceExplanationProfile(),
            type: "execution-profile"
          });
          await options.onEvent({
            threadId: "agent-thread-cache-followup",
            type: "thread"
          });
          return {
            executionProfile: resolvedSourceExplanationProfile(),
            ok: true,
            text: structuredExplanation("Cached explanation follow-up."),
            threadId: "agent-thread-cache-followup",
            turnId: "agent-turn-cache-followup"
          };
        }
        initialCalls += 1;
        const threadId = `agent-thread-cache-${initialCalls}`;
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId,
          type: "thread"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation(`Cached answer ${initialCalls}.`),
          threadId,
          turnId: `agent-turn-cache-${initialCalls}`
        };
      }
    }
  });
  const explanationRequest = (explanationId, force = false) => ({
    assistantMessageId: `${explanationId}_assistant`,
    endColumn: 20,
    endLine: 1,
    explanationId,
    force,
    path: "src/app.js",
    scope: "selection",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1,
    userMessageId: `${explanationId}_user`,
    vibe64User
  });
  const streamEvents = async (request) => {
    const events = [];
    await fixture.service.streamExplanation(request, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });
    return events;
  };
  try {
    const firstEvents = await streamEvents(explanationRequest("exp_cache_first"));
    const cachedEvents = await streamEvents(explanationRequest("exp_cache_second"));
    const cachedFinished = cachedEvents.find((event) => event.type === "source-explanation.finished");
    assert.equal(initialCalls, 1);
    assert.equal(cachedFinished.cacheHit, true);
    assert.equal(cachedFinished.coalesced, false);
    assert.equal(cachedFinished.explanation.engine, "agent-cache");
    assert.equal(cachedFinished.explanation.agentThreadId, "");
    assert.deepEqual(cachedFinished.explanation.executionProfile, resolvedSourceExplanationProfile());
    assert.equal(
      firstEvents.find((event) => event.type === "source-explanation.finished").explanation.engine,
      "agent-chat"
    );

    const followupEvents = [];
    await fixture.service.streamExplanationFollowup({
      explanationId: cachedFinished.explanation.id,
      message: "Continue from the cached context.",
      sessionId: "session-1",
      vibe64User
    }, {
      emit(event) {
        followupEvents.push(event);
      },
      isClosed() {
        return false;
      }
    });
    assert.equal(followupCalls, 1);
    assert.equal(
      followupEvents.find((event) => event.type === "source-explanation.finished").explanation.agentThreadId,
      "agent-thread-cache-followup"
    );

    await streamEvents({
      ...explanationRequest("exp_cache_different_range"),
      endColumn: 8
    });
    assert.equal(initialCalls, 2);

    await writeFile(path.join(fixture.sourceRoot, "src", "app.js"), "console.log('changed cache key');\n");
    await streamEvents(explanationRequest("exp_cache_changed"));
    assert.equal(initialCalls, 3);

    await streamEvents(explanationRequest("exp_cache_forced", true));
    assert.equal(initialCalls, 4);

    vibe64User = {
      username: "grace"
    };
    await streamEvents(explanationRequest("exp_cache_account_changed"));
    assert.equal(initialCalls, 5);
    await streamEvents(explanationRequest("exp_cache_account_cached"));
    assert.equal(initialCalls, 5);

    accountIdentitySignature = "codex-account-grace-v2";
    await streamEvents(explanationRequest("exp_cache_provider_account_changed"));
    assert.equal(initialCalls, 6);

    providerId = "opencode";
    await streamEvents(explanationRequest("exp_cache_provider_changed"));
    assert.equal(initialCalls, 7);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor cache identity follows the resolved economy profile revision and model", async () => {
  let agentCalls = 0;
  let executionProfile = resolvedSourceExplanationProfile();
  const fixture = await createSourceEditorFixture({
    explanationGenerator(_input, { context } = {}) {
      agentCalls += 1;
      const resolvedProfile = context.agentExecutionProfile;
      return {
        agentThreadId: `agent-thread-profile-cache-${agentCalls}`,
        agentTurnId: `agent-turn-profile-cache-${agentCalls}`,
        body: `Profile cache answer ${agentCalls}.`,
        engine: "agent-chat",
        executionProfile: resolvedProfile,
        messages: [],
        model: resolvedProfile.model,
        summary: `Profile cache answer ${agentCalls}.`,
        title: "Profile cache explanation"
      };
    },
    terminalService: {
      resolveAssistantPurpose() {
        return sourceRoutingDecision("codex", "codex-account-profile-cache");
      },
      resolveEphemeralAgentExecutionProfile() {
        return executionProfile;
      }
    }
  });
  const explain = (explanationId) => fixture.service.explainSelection({
    endColumn: 20,
    endLine: 1,
    explanationId,
    path: "src/app.js",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1
  });
  try {
    const initial = await explain("exp_profile_cache_initial");
    executionProfile = {
      ...executionProfile,
      revision: "codex-economy-v2"
    };
    const revised = await explain("exp_profile_cache_revised");
    executionProfile = {
      ...executionProfile,
      model: "gpt-5.4-nano",
      revision: "codex-economy-v3"
    };
    const replacedModel = await explain("exp_profile_cache_replaced_model");
    const cachedReplacement = await explain("exp_profile_cache_replaced_model_cached");

    assert.equal(agentCalls, 3);
    assert.equal(initial.explanation.executionProfile.revision, "codex-economy-v1");
    assert.equal(revised.explanation.executionProfile.revision, "codex-economy-v2");
    assert.equal(replacedModel.explanation.executionProfile.model, "gpt-5.4-nano");
    assert.equal(replacedModel.explanation.engine, "agent-chat");
    assert.equal(cachedReplacement.explanation.engine, "agent-cache");
    assert.equal(cachedReplacement.explanation.executionProfile.model, "gpt-5.4-nano");
    assert.equal(cachedReplacement.explanation.executionProfile.revision, "codex-economy-v3");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source explanation access denial precedes provider inspection, cache reuse, regeneration, streaming, and follow-ups", async () => {
  let restricted = false;
  let accessCalls = 0;
  let providerCalls = 0;
  let profileCalls = 0;
  let generationCalls = 0;
  let followupCalls = 0;
  const fixture = await createSourceEditorFixture({
    explanationFollowupGenerator() {
      followupCalls += 1;
      return "This follow-up must not run.";
    },
    explanationGenerator(_input, { context } = {}) {
      generationCalls += 1;
      return {
        agentThreadId: `thread-restricted-${generationCalls}`,
        agentTurnId: `turn-restricted-${generationCalls}`,
        body: "Authorized explanation.",
        engine: "agent-chat",
        executionProfile: context.agentExecutionProfile,
        messages: [],
        model: context.agentExecutionProfile.model,
        summary: "Authorized explanation.",
        title: "Authorized explanation"
      };
    },
    terminalService: {
      resolveAssistantPurpose(input, options) {
        accessCalls += 1;
        assert.equal(input.purpose, "source_explanation");
        assert.equal(options.vibe64User.username, "member");
        if (restricted) return { available: false, reasonCode: "vibe64_assistant_owner_required",
          message: "Only the workspace owner can use this personal AI connection." };
        providerCalls += 1;
        return sourceRoutingDecision("codex", "codex-account-restricted-cache");
      },
      resolveEphemeralAgentExecutionProfile() {
        profileCalls += 1;
        return resolvedSourceExplanationProfile();
      }
    }
  });
  const request = (explanationId, extra = {}) => ({
    endColumn: 20,
    endLine: 1,
    explanationId,
    path: "src/app.js",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1,
    vibe64User: { username: "member" },
    ...extra
  });
  try {
    const created = await fixture.service.explainSelection(request("exp_restricted_initial"));
    assert.equal(created.ok, true);
    assert.equal(generationCalls, 1);
    assert.equal(providerCalls > 0, true);
    assert.equal(profileCalls > 0, true);
    const authorizedProviderCalls = providerCalls;
    const authorizedProfileCalls = profileCalls;

    restricted = true;
    const cached = await fixture.service.explainSelection(request("exp_restricted_cached"));
    const regenerated = await fixture.service.explainSelection(request(
      "exp_restricted_regenerated",
      { force: true }
    ));
    assert.equal(cached.ok, false);
    assert.equal(cached.code, "vibe64_assistant_owner_required");
    assert.equal(regenerated.ok, false);
    assert.equal(regenerated.code, "vibe64_assistant_owner_required");

    const explanationEvents = [];
    await fixture.service.streamExplanation(request("exp_restricted_stream"), {
      emit(event) {
        explanationEvents.push(event);
      },
      isClosed: () => false
    });
    assert.equal(explanationEvents.at(-1).code, "vibe64_assistant_owner_required");

    const followup = await fixture.service.addExplanationFollowup({
      explanationId: created.explanation.id,
      message: "Why?",
      sessionId: "session-1",
      vibe64User: { username: "member" }
    });
    assert.equal(followup.ok, false);
    assert.equal(followup.code, "vibe64_assistant_owner_required");

    const followupEvents = [];
    await fixture.service.streamExplanationFollowup({
      explanationId: created.explanation.id,
      message: "Why?",
      sessionId: "session-1",
      vibe64User: { username: "member" }
    }, {
      emit(event) {
        followupEvents.push(event);
      },
      isClosed: () => false
    });
    assert.equal(followupEvents.at(-1).code, "vibe64_assistant_owner_required");

    assert.equal(accessCalls, authorizedProviderCalls + 5);
    assert.equal(providerCalls, authorizedProviderCalls);
    assert.equal(profileCalls, authorizedProfileCalls);
    assert.equal(generationCalls, 1);
    assert.equal(followupCalls, 0);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor never coalesces an in-flight explanation across resolved profile identity", async () => {
  let agentCalls = 0;
  let executionProfile = resolvedSourceExplanationProfile();
  let markFirstStarted = () => {};
  let releaseFirst = () => {};
  const firstStarted = new Promise((resolve) => {
    markFirstStarted = resolve;
  });
  const firstReleased = new Promise((resolve) => {
    releaseFirst = resolve;
  });
  const fixture = await createSourceEditorFixture({
    async explanationGenerator(_input, { context } = {}) {
      agentCalls += 1;
      const call = agentCalls;
      const resolvedProfile = context.agentExecutionProfile;
      if (call === 1) {
        markFirstStarted();
        await firstReleased;
      }
      return {
        agentThreadId: `agent-thread-profile-flight-${call}`,
        agentTurnId: `agent-turn-profile-flight-${call}`,
        body: `Profile flight answer ${call}.`,
        engine: "agent-chat",
        executionProfile: resolvedProfile,
        messages: [],
        model: resolvedProfile.model,
        summary: `Profile flight answer ${call}.`,
        title: "Profile flight explanation"
      };
    },
    terminalService: {
      resolveAssistantPurpose() {
        return sourceRoutingDecision("codex", "codex-account-profile-flight");
      },
      resolveEphemeralAgentExecutionProfile() {
        return executionProfile;
      }
    }
  });
  const explain = (explanationId) => fixture.service.explainSelection({
    endColumn: 20,
    endLine: 1,
    explanationId,
    path: "src/app.js",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1
  });
  try {
    const first = explain("exp_profile_flight_first");
    await firstStarted;
    executionProfile = {
      ...executionProfile,
      model: "gpt-5.4-nano",
      revision: "codex-economy-v2"
    };
    const second = await explain("exp_profile_flight_second");
    assert.equal(agentCalls, 2);
    releaseFirst();
    const initial = await first;
    const cachedSecond = await explain("exp_profile_flight_second_cached");

    assert.equal(agentCalls, 2);
    assert.equal(initial.explanation.executionProfile.model, "gpt-5.6-luna");
    assert.equal(second.explanation.executionProfile.model, "gpt-5.4-nano");
    assert.equal(second.explanation.engine, "agent-chat");
    assert.equal(cachedSecond.explanation.engine, "agent-cache");
    assert.equal(cachedSecond.explanation.executionProfile.revision, "codex-economy-v2");
  } finally {
    releaseFirst();
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor does not cache output across an account switch during generation", async () => {
  let accountIdentitySignature = "codex-account-a";
  const expectedAccountIdentitySignatures = [];
  let generationCalls = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      resolveAssistantPurpose() {
        return sourceRoutingDecision("codex", accountIdentitySignature);
      },
      async runEphemeralAgentChatTurn(_sessionId, input, options = {}) {
        generationCalls += 1;
        expectedAccountIdentitySignatures.push(options.expectedConnectionIdentity);
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: `agent-thread-account-race-${generationCalls}`,
          type: "thread"
        });
        if (generationCalls === 1) {
          accountIdentitySignature = "codex-account-b";
        }
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation(`Account-race answer ${generationCalls}.`),
          threadId: `agent-thread-account-race-${generationCalls}`,
          turnId: `agent-turn-account-race-${generationCalls}`
        };
      }
    }
  });
  const request = (explanationId) => ({
    endColumn: 20,
    endLine: 1,
    explanationId,
    path: "src/app.js",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1,
    vibe64User: {
      username: "ada"
    }
  });
  const run = async (explanationId) => {
    const events = [];
    await fixture.service.streamExplanation(request(explanationId), {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });
    return events.find((event) => event.type === "source-explanation.finished");
  };
  try {
    const switchedDuringGeneration = await run("exp_account_race_a");
    const generatedForCurrentAccount = await run("exp_account_race_b");
    const cachedForCurrentAccount = await run("exp_account_race_b_cached");

    assert.equal(switchedDuringGeneration.explanation.engine, "agent-chat");
    assert.equal(generatedForCurrentAccount.explanation.engine, "agent-chat");
    assert.equal(cachedForCurrentAccount.explanation.engine, "agent-cache");
    assert.equal(generationCalls, 2);
    assert.deepEqual(expectedAccountIdentitySignatures, [
      "codex-account-a",
      "codex-account-b"
    ]);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor rechecks the account before serving a completed cache entry", async () => {
  let accountIdentitySignature = "codex-account-a";
  let descriptionCalls = 0;
  let generationCalls = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      resolveAssistantPurpose() {
        descriptionCalls += 1;
        const description = sourceRoutingDecision("codex", accountIdentitySignature);
        if (descriptionCalls === 3) {
          accountIdentitySignature = "codex-account-b";
        }
        return description;
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        generationCalls += 1;
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: `agent-thread-cache-race-${generationCalls}`,
          type: "thread"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation(`Cache-race answer ${generationCalls}.`),
          threadId: `agent-thread-cache-race-${generationCalls}`,
          turnId: `agent-turn-cache-race-${generationCalls}`
        };
      }
    }
  });
  const run = async (explanationId) => {
    const events = [];
    await fixture.service.streamExplanation({
      endColumn: 20,
      endLine: 1,
      explanationId,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      vibe64User: {
        username: "ada"
      }
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });
    return events.find((event) => event.type === "source-explanation.finished");
  };
  try {
    const first = await run("exp_cache_race_a");
    const switchedBeforeReuse = await run("exp_cache_race_b");

    assert.equal(first.explanation.engine, "agent-chat");
    assert.equal(switchedBeforeReuse.explanation.engine, "agent-chat");
    assert.equal(generationCalls, 2);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor explanation cache expires entries using its bounded TTL", async () => {
  let agentCalls = 0;
  let nowMs = 10_000;
  const fixture = await createSourceEditorFixture({
    explanationCacheNow: () => nowMs,
    explanationGenerator(input = {}) {
      agentCalls += 1;
      return {
        agentThreadId: `agent-thread-ttl-${agentCalls}`,
        agentTurnId: `agent-turn-ttl-${agentCalls}`,
        body: `TTL answer ${agentCalls}.`,
        engine: "agent-chat",
        executionProfile: resolvedSourceExplanationProfile(),
        messages: [],
        model: resolvedSourceExplanationProfile().model,
        summary: `TTL answer ${agentCalls}.`,
        title: `TTL explanation for ${input.file?.path || "source"}`
      };
    }
  });
  const request = (explanationId) => ({
    endColumn: 20,
    endLine: 1,
    explanationId,
    path: "src/app.js",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1
  });
  try {
    const first = await fixture.service.explainSelection(request("exp_ttl_first"));
    const cached = await fixture.service.explainSelection(request("exp_ttl_cached"));
    assert.equal(first.ok, true);
    assert.equal(cached.ok, true);
    assert.equal(cached.explanation.engine, "agent-cache");
    assert.equal(agentCalls, 1);

    nowMs += 5 * 60 * 1000;
    const expired = await fixture.service.explainSelection(request("exp_ttl_expired"));
    assert.equal(expired.ok, true);
    assert.equal(expired.explanation.engine, "agent-chat");
    assert.equal(agentCalls, 2);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor never reuses a completed explanation without an authoritative account signature", async () => {
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    agentAccountIdentitySignature: "",
    explanationGenerator() {
      agentCalls += 1;
      return {
        agentThreadId: `agent-thread-unsigned-${agentCalls}`,
        agentTurnId: `agent-turn-unsigned-${agentCalls}`,
        body: `Unsigned answer ${agentCalls}.`,
        engine: "agent-chat",
        executionProfile: resolvedSourceExplanationProfile(),
        messages: [],
        model: resolvedSourceExplanationProfile().model,
        summary: `Unsigned answer ${agentCalls}.`,
        title: "Unsigned explanation"
      };
    }
  });
  const request = (explanationId) => ({
    endColumn: 20,
    endLine: 1,
    explanationId,
    path: "src/app.js",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1,
    vibe64User: {
      username: "ada"
    }
  });
  try {
    const first = await fixture.service.explainSelection(request("exp_unsigned_first"));
    const second = await fixture.service.explainSelection(request("exp_unsigned_second"));
    assert.equal(first.ok, true);
    assert.equal(second.ok, true);
    assert.equal(first.explanation.engine, "agent-chat");
    assert.equal(second.explanation.engine, "agent-chat");
    assert.equal(agentCalls, 2);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor coalesces concurrent identical explanation requests", async () => {
  let agentCalls = 0;
  let markStarted = () => {};
  let releaseAgent = () => {};
  const started = new Promise((resolve) => {
    markStarted = resolve;
  });
  const released = new Promise((resolve) => {
    releaseAgent = resolve;
  });
  const fixture = await createSourceEditorFixture({
    agentAccountIdentitySignature: "",
    terminalService: {
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        agentCalls += 1;
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-coalesced",
          type: "thread"
        });
        markStarted();
        await released;
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("One shared generation."),
          threadId: "agent-thread-coalesced",
          turnId: "agent-turn-coalesced"
        };
      }
    }
  });
  const request = (suffix) => ({
    assistantMessageId: `msg_${suffix}_assistant`,
    endColumn: 20,
    endLine: 1,
    explanationId: `exp_${suffix}`,
    path: "src/app.js",
    scope: "selection",
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1,
    userMessageId: `msg_${suffix}_user`
  });
  const eventsA = [];
  const eventsB = [];
  try {
    const first = fixture.service.streamExplanation(request("coalesce_a"), {
      emit(event) {
        eventsA.push(event);
      },
      isClosed() {
        return false;
      }
    });
    await started;
    const second = fixture.service.streamExplanation(request("coalesce_b"), {
      emit(event) {
        eventsB.push(event);
      },
      isClosed() {
        return false;
      }
    });
    releaseAgent();
    await Promise.all([first, second]);

    assert.equal(agentCalls, 1);
    const firstFinished = eventsA.find((event) => event.type === "source-explanation.finished");
    const secondFinished = eventsB.find((event) => event.type === "source-explanation.finished");
    assert.equal(firstFinished.explanation.engine, "agent-chat");
    assert.equal(secondFinished.explanation.engine, "agent-cache");
    assert.equal(secondFinished.cacheHit, true);
    assert.equal(secondFinished.coalesced, true);
    assert.equal(secondFinished.explanation.agentThreadId, "");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor explanation cache evicts its least-recently-used entry at the fixed bound", async () => {
  const cacheFileCount = 65;
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    extraFiles: Array.from({ length: cacheFileCount }, (_, index) => ({
      path: `src/cache-${index}.js`,
      text: `export const cachedValue${index} = ${index};\n`
    })),
    terminalService: {
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        agentCalls += 1;
        const threadId = `agent-thread-cache-bound-${agentCalls}`;
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId,
          type: "thread"
        });
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation(`Bounded cache answer ${agentCalls}.`),
          threadId,
          turnId: `agent-turn-cache-bound-${agentCalls}`
        };
      }
    }
  });
  const explainFile = (index) => fixture.service.explainSelection({
    endColumn: 32,
    endLine: 1,
    path: `src/cache-${index}.js`,
    sessionId: "session-1",
    startColumn: 1,
    startLine: 1
  });
  try {
    for (let index = 0; index < cacheFileCount; index += 1) {
      const response = await explainFile(index);
      assert.equal(response.ok, true);
    }
    assert.equal(agentCalls, cacheFileCount);

    const evicted = await explainFile(0);
    assert.equal(evicted.ok, true);
    assert.equal(evicted.explanation.engine, "agent-chat");
    assert.equal(agentCalls, cacheFileCount + 1);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor preserves failed explanation details for recovery", async () => {
  const events = [];
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          type: "execution-profile"
        });
        await options.onEvent({
          threadId: "agent-thread-failed",
          type: "thread"
        });
        await options.onEvent({
          status: "failed",
          threadId: "agent-thread-failed",
          turnId: "agent-turn-failed",
          type: "turn"
        });
        return {
          code: "invalid_value",
          error: "Invalid value: 'max'. Use 'medium'.",
          executionProfile: resolvedSourceExplanationProfile(),
          ok: false,
          statusCode: 400,
          threadId: "agent-thread-failed",
          turnId: "agent-turn-failed"
        };
      }
    }
  });
  try {
    await fixture.service.streamExplanation({
      assistantMessageId: "msg_assistant_failed",
      endColumn: 20,
      endLine: 1,
      explanationId: "exp_failed",
      path: "src/app.js",
      scope: "selection",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      userMessageId: "msg_user_failed"
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });

    const failed = events.find((event) => event.type === "source-explanation.failed");
    const terminalError = events.find((event) => event.type === "source-explanation.error");
    assert.equal(failed.error, "Invalid value: 'max'. Use 'medium'.");
    assert.equal(failed.explanation.error, "Invalid value: 'max'. Use 'medium'.");
    assert.equal(failed.explanation.status, "failed");
    assert.equal(failed.explanation.agentThreadId, "agent-thread-failed");
    assert.equal(failed.explanation.agentTurnId, "agent-turn-failed");
    assert.equal(failed.explanation.model, "gpt-5.6-luna");
    assert.deepEqual(failed.explanation.executionProfile, resolvedSourceExplanationProfile());
    assert.equal(failed.explanation.messages.at(-1).status, "failed");
    assert.equal(failed.explanation.messages.at(-1).text, "Invalid value: 'max'. Use 'medium'.");
    assert.equal(terminalError.error, "Invalid value: 'max'. Use 'medium'.");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor fails closed when the economy profile observation is missing", async () => {
  const events = [];
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async runEphemeralAgentChatTurn() {
        return {
          ok: true,
          text: structuredExplanation("Unverified explanation."),
          threadId: "agent-thread-unverified",
          turnId: "agent-turn-unverified"
        };
      }
    }
  });
  try {
    await fixture.service.streamExplanation({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      scope: "selection",
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

    const failure = events.find((event) => event.type === "source-explanation.failed");
    assert.equal(failure.code, "vibe64_source_explanation_execution_profile_missing");
    assert.match(failure.error, /low-cost assistant required/u);
    assert.equal(events.some((event) => event.type === "source-explanation.finished"), false);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor fails closed before generation when economy profile resolution is unavailable", async () => {
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      resolveEphemeralAgentExecutionProfile: null,
      async runEphemeralAgentChatTurn() {
        agentCalls += 1;
        return { ok: true };
      }
    }
  });
  try {
    const response = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });

    assert.equal(response.ok, false);
    assert.equal(response.code, "vibe64_source_explanation_execution_profile_missing");
    assert.match(response.error, /cannot resolve the low-cost profile/u);
    assert.equal(agentCalls, 0);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor blocks required explanations when the selected assistant account is unauthenticated", async () => {
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async resolveAssistantPurpose() {
        const error = new Error("Codex authentication is required.");
        error.code = "vibe64_codex_auth_required";
        error.statusCode = 401;
        throw error;
      },
      async runEphemeralAgentChatTurn() {
        agentCalls += 1;
        throw new Error("Unauthenticated source work must not start.");
      }
    }
  });
  try {
    const response = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1,
      vibe64User: { username: "ada" }
    });

    assert.equal(response.ok, false);
    assert.equal(response.code, "vibe64_codex_auth_required");
    assert.equal(response.statusCode, 401);
    assert.match(response.error, /Codex authentication is required/u);
    assert.equal(agentCalls, 0);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor surfaces economy availability blockers without an interactive fallback", async (t) => {
  for (const outcome of [
    {
      code: "vibe64_agent_execution_profile_model_unavailable",
      error: "The provider economy model is unavailable. Retry after refreshing the model catalog.",
      name: "model-unavailable",
      statusCode: 503
    },
    {
      code: "vibe64_agent_rate_limited",
      error: "The selected assistant account is rate limited. Wait and retry this explanation.",
      name: "rate-limited",
      statusCode: 429
    }
  ]) {
    await t.test(outcome.name, async () => {
      let agentCalls = 0;
      const fixture = await createSourceEditorFixture({
        terminalService: {
          async runEphemeralAgentChatTurn(_sessionId, input = {}) {
            agentCalls += 1;
            assert.deepEqual(input.executionProfile, resolvedSourceExplanationProfile());
            assert.equal(input.agentSettings, undefined);
            return {
              code: outcome.code,
              error: outcome.error,
              ok: false,
              statusCode: outcome.statusCode
            };
          }
        }
      });
      try {
        const response = await fixture.service.explainSelection({
          endColumn: 20,
          endLine: 1,
          path: "src/app.js",
          sessionId: "session-1",
          startColumn: 1,
          startLine: 1
        });

        assert.equal(response.ok, false);
        assert.equal(response.code, outcome.code);
        assert.equal(response.statusCode, outcome.statusCode);
        assert.equal(response.error, outcome.error);
        assert.equal(agentCalls, 1);
      } finally {
        await rm(fixture.root, {
          force: true,
          recursive: true
        });
      }
    });
  }
});

test("source editor never reuses an unverified explanation thread for follow-ups", async () => {
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    explanationGenerator() {
      return {
        agentThreadId: "interactive-thread",
        body: "Legacy explanation.",
        model: "interactive-model",
        title: "Legacy explanation"
      };
    },
    terminalService: {
      async runEphemeralAgentChatTurn() {
        agentCalls += 1;
        throw new Error("Unverified thread reached the provider.");
      }
    }
  });
  try {
    const created = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    const events = [];
    await fixture.service.streamExplanationFollowup({
      explanationId: created.explanation.id,
      message: "Continue this thread.",
      sessionId: "session-1"
    }, {
      emit(event) {
        events.push(event);
      },
      isClosed() {
        return false;
      }
    });

    assert.equal(agentCalls, 0);
    const failure = events.find((event) => event.type === "source-explanation.error");
    assert.equal(failure.code, "vibe64_source_explanation_execution_profile_missing");
    assert.match(failure.error, /Regenerate this explanation/u);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor asks for regeneration when an economy follow-up thread is unavailable", async () => {
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async runEphemeralAgentChatTurn() {
        agentCalls += 1;
        if (agentCalls > 1) {
          return {
            code: "vibe64_agent_execution_profile_policy_unenforceable",
            error: "The recorded economy thread is no longer available.",
            ok: false,
            statusCode: 409
          };
        }
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("Verified explanation."),
          threadId: "economy-thread",
          turnId: "economy-turn"
        };
      }
    }
  });
  try {
    const initialEvents = [];
    await fixture.service.streamExplanation({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      scope: "selection",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    }, {
      emit(event) {
        initialEvents.push(event);
      },
      isClosed() {
        return false;
      }
    });
    const explanation = initialEvents.find((event) => event.type === "source-explanation.finished").explanation;
    const followupEvents = [];
    await fixture.service.streamExplanationFollowup({
      explanationId: explanation.id,
      message: "Continue.",
      sessionId: "session-1"
    }, {
      emit(event) {
        followupEvents.push(event);
      },
      isClosed() {
        return false;
      }
    });

    const failure = followupEvents.find((event) => event.type === "source-explanation.failed");
    assert.match(failure.error, /Regenerate this explanation/u);
    assert.equal(failure.code, "vibe64_agent_execution_profile_policy_unenforceable");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor retires a non-stream economy thread after an invalid follow-up", async () => {
  const deletedThreads = [];
  let agentCalls = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation(sessionId, input = {}) {
        deletedThreads.push({
          executionProfile: input.executionProfile,
          threadId: input.conversationId
        });
        return {
          ok: true,
          status: "deleted",
          threadId: input.conversationId
        };
      },
      async runEphemeralAgentChatTurn() {
        agentCalls += 1;
        return agentCalls === 1
          ? {
              executionProfile: resolvedSourceExplanationProfile(),
              ok: true,
              text: structuredExplanation("Verified explanation."),
              threadId: "economy-followup-invalid",
              turnId: "economy-turn-initial"
            }
          : {
              executionProfile: resolvedSourceExplanationProfile(),
              ok: true,
              text: "not-json",
              threadId: "economy-followup-invalid",
              turnId: "economy-turn-invalid"
            };
      }
    }
  });
  try {
    const created = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    assert.equal(created.ok, true);

    const invalidFollowup = await fixture.service.addExplanationFollowup({
      explanationId: created.explanation.id,
      message: "What happens next?",
      sessionId: "session-1"
    });
    assert.equal(invalidFollowup.ok, false);
    assert.equal(invalidFollowup.code, "vibe64_source_explanation_agent_invalid");
    assert.equal(invalidFollowup.details.cleanupRequired, false);
    assert.deepEqual(deletedThreads, [{
      executionProfile: resolvedSourceExplanationProfile(),
      threadId: "economy-followup-invalid"
    }]);

    const blockedFollowup = await fixture.service.addExplanationFollowup({
      explanationId: created.explanation.id,
      message: "Try the same conversation again.",
      sessionId: "session-1"
    });
    assert.equal(blockedFollowup.ok, false);
    assert.equal(blockedFollowup.code, "vibe64_source_explanation_agent_thread_failed");
    assert.match(blockedFollowup.error, /will not reuse that conversation/u);
    assert.equal(agentCalls, 2);
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor preserves retryable ownership when a failed non-stream follow-up cannot retire its thread", async () => {
  let agentCalls = 0;
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async deleteEphemeralAgentConversation(_sessionId, input = {}) {
        cleanupAttempts += 1;
        return cleanupAttempts === 1
          ? undefined
          : {
              ok: true,
              status: "deleted",
              threadId: input.conversationId
            };
      },
      async runEphemeralAgentChatTurn(_sessionId, _input, options = {}) {
        agentCalls += 1;
        if (agentCalls === 1) {
          return {
            executionProfile: resolvedSourceExplanationProfile(),
            ok: true,
            text: structuredExplanation("Verified explanation."),
            threadId: "economy-followup-retry",
            turnId: "economy-turn-initial"
          };
        }
        await options.onEvent({
          executionProfile: resolvedSourceExplanationProfile(),
          threadId: "economy-followup-retry",
          turnId: "economy-turn-failed",
          type: "turn"
        });
        throw new Error("The follow-up transport failed.");
      }
    }
  });
  try {
    const created = await fixture.service.explainSelection({
      endColumn: 20,
      endLine: 1,
      path: "src/app.js",
      sessionId: "session-1",
      startColumn: 1,
      startLine: 1
    });
    assert.equal(created.ok, true);

    const failedFollowup = await fixture.service.addExplanationFollowup({
      explanationId: created.explanation.id,
      message: "Trigger the failed turn.",
      sessionId: "session-1"
    });
    assert.equal(failedFollowup.ok, false);
    assert.equal(failedFollowup.details.cleanupRequired, true);
    assert.equal(failedFollowup.details.cleanupThreadId, "economy-followup-retry");

    const blockedFollowup = await fixture.service.addExplanationFollowup({
      explanationId: created.explanation.id,
      message: "Do not reuse it.",
      sessionId: "session-1"
    });
    assert.equal(blockedFollowup.ok, false);
    assert.equal(blockedFollowup.code, "vibe64_source_explanation_agent_thread_failed");
    assert.equal(agentCalls, 2);

    const cleanup = await fixture.service.deleteExplanation({
      explanationId: created.explanation.id,
      sessionId: "session-1"
    });
    assert.equal(cleanup.ok, true);
    assert.equal(cleanup.deleted, true);
    assert.equal(cleanupAttempts, 2);
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
      async deleteEphemeralAgentConversation(sessionId, input = {}) {
        deletedThreads.push({
          threadId: input.conversationId
        });
        return {
          ok: true,
          status: "deleted",
          threadId: input.conversationId
        };
      },
      async runEphemeralAgentChatTurn() {
        streamCount += 1;
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation(`Explanation ${streamCount}.`),
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
        force: true,
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
      fixture.sourceEditorTempRoot,
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
        "helper",
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
        threadId: "agent-thread-1"
      },
      {
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
      async stopEphemeralAgentConversation(sessionId, input = {}) {
        interruptedTurns.push({
          executionProfile: input.executionProfile,
          threadId: input.conversationId,
          turnId: input.runId
        });
        releaseAgentTurn();
        return {
          ok: true,
          status: "interrupted"
        };
      },
      async runEphemeralAgentChatTurn(_sessionId, input = {}, options = {}) {
        assert.equal(input.promptLabel, "Source code explanation");
        await options.onEvent({
          threadId: "agent-thread-stop",
          type: "thread"
        });
        await options.onEvent({
          status: "inProgress",
          threadId: "agent-thread-stop",
          turnId: "agent-turn-stop",
          type: "turn"
        });
        markTurnReady();
        await releaseTurn;
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("Late answer should not revive the stopped explanation."),
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
      executionProfile: resolvedSourceExplanationProfile(),
      threadId: "agent-thread-stop",
      turnId: "agent-turn-stop"
    }]);

    releaseAgentTurn();
    await streamPromise;
    const finished = events.filter((event) => event.type === "source-explanation.finished").at(-1);
    assert.equal(finished.explanation.status, "stopped");
    assert.deepEqual(finished.explanation.executionProfile, resolvedSourceExplanationProfile());
    assert.equal(finished.explanation.messages.at(-1).status, "stopped");
    assert.notEqual(finished.explanation.body, "Late answer should not revive the stopped explanation.");
  } finally {
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

for (const stopBoundary of [
  "a newer same-ID follow-up",
  "a follow-up before its new provider turn",
  "a removed explanation",
  "the latest answer of the original turn"
]) {
  test(`source editor late stop acknowledgement preserves ${stopBoundary}`, async () => {
    const firstReady = Promise.withResolvers();
    const firstFinished = Promise.withResolvers();
    const secondReady = Promise.withResolvers();
    const secondFinished = Promise.withResolvers();
    const interruptReady = Promise.withResolvers();
    const interruptFinished = Promise.withResolvers();
    const interruptedTurns = [];
    const deletedThreads = [];
    const operations = [];
    let turnCount = 0;
    let store;
    const fixture = await createSourceEditorFixture({
      writeExclusive(...args) {
        return store.runSessionExclusive(...args);
      },
      terminalService: {
        async deleteEphemeralAgentConversation(sessionId, input) {
          deletedThreads.push({ threadId: input.conversationId });
          return { ok: true };
        },
        async stopEphemeralAgentConversation(sessionId, input) {
          interruptedTurns.push({ ...input });
          interruptReady.resolve();
          await interruptFinished.promise;
          return { ok: true, status: "interrupted" };
        },
        async runEphemeralAgentChatTurn(_sessionId, input, options) {
          const turn = ["initial", "a", "b"][turnCount++];
          assert.ok(turn, "only the initial explanation and two follow-ups are generated");
          const threadId = "agent-thread-late-stop";
          const turnId = `agent-turn-${turn}`;
          await options.onEvent({ threadId, type: "thread" });
          if (turn === "b" && stopBoundary === "a follow-up before its new provider turn") {
            secondReady.resolve();
            await secondFinished.promise;
          }
          await options.onEvent({ status: "inProgress", threadId, turnId, type: "turn" });
          if (turn === "a") {
            assert.match(input.prompt, /Question A/u);
            firstReady.resolve();
            await firstFinished.promise;
          } else if (turn === "b") {
            assert.match(input.prompt, /Question B/u);
            secondReady.resolve();
            await secondFinished.promise;
          }
          return {
            executionProfile: resolvedSourceExplanationProfile(),
            ok: true,
            text: structuredExplanation(`Answer ${turn}.`),
            threadId,
            turnId
          };
        }
      }
    });
    try {
      store = createVibe64SessionStore({
        projectContextRoot: fixture.sourceRoot,
        projectRuntimeRoot: path.join(fixture.root, "session-runtime")
      });
      await store.createSession({ sessionId: "session-1" });
      await fixture.service.streamExplanation({
        assistantMessageId: "msg_initial_assistant",
        endColumn: 20,
        endLine: 1,
        explanationId: "exp_late_stop",
        path: "src/app.js",
        scope: "selection",
        sessionId: "session-1",
        startColumn: 1,
        startLine: 1,
        userMessageId: "msg_initial_user"
      });

      const first = fixture.service.streamExplanationFollowup({
        assistantMessageId: "msg_a_assistant",
        explanationId: "exp_late_stop",
        message: "Question A",
        sessionId: "session-1",
        userMessageId: "msg_a_user"
      });
      operations.push(first);
      await firstReady.promise;
      firstFinished.resolve();
      await first;
      const stopping = fixture.service.stopExplanation({
        explanationId: "exp_late_stop",
        sessionId: "session-1"
      });
      operations.push(stopping);
      await interruptReady.promise;
      assert.deepEqual(interruptedTurns, [{
        executionProfile: resolvedSourceExplanationProfile(),
        conversationId: "agent-thread-late-stop",
        runId: "agent-turn-a",
        cleanupExecutionId: ""
      }]);
      firstFinished.resolve();
      await first;

      if (stopBoundary === "a removed explanation") {
        const deleted = await fixture.service.deleteExplanation({
          explanationId: "exp_late_stop",
          sessionId: "session-1"
        });
        assert.equal(deleted.ok, true);
        assert.equal(deleted.deleted, true);
        interruptFinished.resolve();
        const stopped = await stopping;
        assert.equal(stopped.ok, false);
        assert.equal(stopped.code, "vibe64_source_explanation_not_found");
        const repeatedDelete = await fixture.service.deleteExplanation({
          explanationId: "exp_late_stop",
          sessionId: "session-1"
        });
        assert.equal(repeatedDelete.deleted, false);
        assert.deepEqual(deletedThreads, [{
          threadId: "agent-thread-late-stop"
        }]);
        await assert.rejects(readFile(
          path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json")
        ), { code: "ENOENT" });
        return;
      }

      if (stopBoundary === "the latest answer of the original turn") {
        interruptFinished.resolve();
        const stopped = await stopping;
        assert.equal(stopped.ok, true);
        assert.equal(stopped.explanation.status, "stopped");
        assert.equal(stopped.explanation.agentTurnId, "agent-turn-a");
        assert.equal(stopped.explanation.body, "Answer a.");
        assert.equal(stopped.explanation.messages.at(-1).id, "msg_a_assistant");
        assert.equal(stopped.explanation.messages.at(-1).text, "Answer a.");
        return;
      }

      const secondEvents = [];
      const second = fixture.service.streamExplanationFollowup({
        assistantMessageId: "msg_b_assistant",
        explanationId: "exp_late_stop",
        message: "Question B",
        sessionId: "session-1",
        userMessageId: "msg_b_user"
      }, { emit: (event) => secondEvents.push(event) });
      operations.push(second);
      await secondReady.promise;
      interruptFinished.resolve();
      assert.equal((await stopping).ok, true);
      secondFinished.resolve();
      await second;

      const finished = secondEvents.findLast((event) => event.type === "source-explanation.finished");
      assert.equal(finished.explanation.agentTurnId, "agent-turn-b");
      assert.equal(finished.explanation.status, "ready");
      assert.equal(finished.explanation.body, "Answer b.");
      assert.equal(finished.explanation.messages.find((message) => message.id === "msg_b_user")?.text, "Question B");
      assert.equal(finished.explanation.messages.at(-1).id, "msg_b_assistant");
      assert.equal(finished.explanation.messages.at(-1).text, "Answer b.");
      assert.deepEqual(finished.explanation.followups.map((message) => message.text), [
        "Question A", "Answer a.", "Question B", "Answer b."
      ]);
    } finally {
      firstFinished.resolve();
      secondFinished.resolve();
      interruptFinished.resolve();
      await Promise.allSettled(operations);
      await rm(fixture.root, { force: true, recursive: true });
    }
  });
}

test("source editor allows whole-file explanations for files larger than selected-range limits", async () => {
  const fixture = await createSourceEditorFixture({
    terminalService: {
      async runEphemeralAgentChatTurn(_sessionId, input = {}) {
        assert.match(input.prompt, /Target: whole file/u);
        assert.match(input.prompt, /bounded excerpt may omit content/u);
        assert.doesNotMatch(input.prompt, /Inspect the repository file path/u);
        assert.ok(input.prompt.length < 75_000);
        return {
          executionProfile: resolvedSourceExplanationProfile(),
          ok: true,
          text: structuredExplanation("Whole file explained."),
          threadId: "agent-thread-large-file",
          turnId: "agent-turn-large-file"
        };
      }
    }
  });
  try {
    await writeFile(
      path.join(fixture.sourceRoot, "src", "app.js"),
      Array.from({ length: 260 }, (_, index) => `${index}: ${"x".repeat(500)}`).join("\n")
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
      async deleteEphemeralAgentConversation(_sessionId, input = {}) {
        cleanupAttempts += 1;
        if (cleanupAttempts === 1) {
          return {
            code: "unit_cleanup_failed",
            error: "Unit cleanup failed.",
            ok: false,
            statusCode: 502,
            threadId: input.conversationId
          };
        }
        return {
          ok: true,
          status: "deleted",
          threadId: input.conversationId
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

test("source editor keeps temporary explanation chat retryable when cleanup is not explicitly confirmed", async () => {
  let cleanupAttempts = 0;
  const fixture = await createSourceEditorFixture({
    explanationGenerator(input) {
      return {
        agentThreadId: "thread-cleanup-unconfirmed",
        body: `Generated explanation for:\n${input.selectedText}`,
        title: "Generated app.js explanation"
      };
    },
    terminalService: {
      async deleteEphemeralAgentConversation(_sessionId, input = {}) {
        cleanupAttempts += 1;
        return cleanupAttempts === 1
          ? undefined
          : {
              ok: true,
              status: "deleted",
              threadId: input.conversationId
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
    assert.equal(
      failedDeleteResponse.code,
      "vibe64_source_explanation_agent_cleanup_unconfirmed"
    );

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

test("source editor file matcher uses ripgrep with the neutral policy", async (t) => {
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

test("source editor filename index discovers editor creates and explicit tree refreshes", async (t) => {
  if (!RIPGREP_AVAILABLE) return t.skip("ripgrep is not installed in this test environment");
  const fixture = await createSourceEditorFixture({
    extraFiles: [{ path: ".gitignore", text: "dist/\n" }]
  });
  t.after(async () => {
    fixture.service.close();
    await rm(fixture.root, { force: true, recursive: true });
  });
  const search = () => fixture.service.listFiles({ query: "indexed-check", sessionId: "session-1" });
  assert.deepEqual((await search()).files, []);
  const created = await fixture.service.createFile({ path: "dist/indexed-check.txt", sessionId: "session-1" });
  assert.equal(created.ok, true);
  assert.deepEqual((await search()).files.map((file) => file.path), ["dist/indexed-check.txt"]);

  await rm(path.join(fixture.sourceRoot, "dist/indexed-check.txt"));
  await writeFile(path.join(fixture.sourceRoot, "src/indexed-check.txt"), "External edit\n");
  await fixture.service.readTree({ sessionId: "session-1" });
  assert.deepEqual((await search()).files.map((file) => file.path), ["src/indexed-check.txt"]);
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

test("source editor content index includes ignored files and excludes VCS internals", async () => {

  const fixture = await createSourceEditorFixture({
    extraFiles: [{
      path: ".git/hidden.txt",
      text: "source editor VCS needle\n"
    }]
  });
  try {
    let response;
    const deadline = Date.now() + 10000;
    do {
      response = await fixture.service.search({ query: "source editor", sessionId: "session-1" });
      assert.equal(response.ok, true);
      assert.notEqual(response.index.state, "error", response.index.error);
      if (response.index.state === "ready") break;
      await new Promise((resolve) => setTimeout(resolve, 20));
    } while (Date.now() < deadline);
    assert.equal(response.index.state, "ready");
    assert.equal(response.ok, true);
    assert.equal(response.truncated, false);
    assert.deepEqual(response.results.map((result) => result.path), [
      "dist/bundle.js",
      "node_modules/pkg/index.js",
      "src/search-target-with-a-long-file-name.js"
    ]);
    const sourceResult = response.results.find((result) => (
      result.path === "src/search-target-with-a-long-file-name.js"
    ));
    assert.equal(sourceResult?.line, 1);
    assert.match(sourceResult?.preview || "", /visible needle/u);
  } finally {
    await fixture.service.close();
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor reports unavailable when its source root is missing or not a directory", async () => {
  const fixture = await createSourceEditorFixture();
  try {
    await rename(fixture.sourceRoot, path.join(fixture.root, "original-source"));
    const missing = await fixture.service.readTree({ sessionId: "session-1" });
    assert.equal(missing.ok, false);
    assert.equal(missing.statusCode, 409);
    assert.equal(missing.errors[0].code, "vibe64_source_editor_source_unavailable");

    await writeFile(fixture.sourceRoot, "This is not a source directory.\n");
    const notDirectory = await fixture.service.listFiles({ sessionId: "session-1" });
    assert.equal(notDirectory.ok, false);
    assert.equal(notDirectory.statusCode, 409);
    assert.equal(notDirectory.errors[0].code, "vibe64_source_editor_source_unavailable");
  } finally {
    fixture.service.close();
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor rejects a symbolic link as the session source root", async (t) => {
  const fixture = await createSourceEditorFixture();
  const outsideRoot = path.join(fixture.root, "outside");
  try {
    await mkdir(outsideRoot);
    await writeFile(path.join(outsideRoot, "outside-file.js"), "export const outsideNeedle = true;\n");
    await rename(fixture.sourceRoot, path.join(fixture.root, "original-source"));
    await symlink(outsideRoot, fixture.sourceRoot, "dir");

    await t.test("does not list files through a linked source root", async () => {
      const result = await fixture.service.listFiles({
        query: "outside-file",
        sessionId: "session-1"
      });
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].code, "vibe64_source_editor_symlink");
      assert.equal(result.files, undefined);
    });

    await t.test("does not search files through a linked source root", async () => {
      const result = await fixture.service.search({
        query: "outsideNeedle",
        sessionId: "session-1"
      });
      assert.equal(result.ok, false);
      assert.equal(result.errors[0].code, "vibe64_source_editor_symlink");
      assert.equal(result.results, undefined);
    });
  } finally {
    fixture.service.close();
    await rm(fixture.root, {
      force: true,
      recursive: true
    });
  }
});

test("source editor rejects symbolic links in ancestor directories", async (t) => {
  let observedFiles = 0;
  const fixture = await createSourceEditorFixture({
    sourceFileObserver: {
      close() {},
      subscribe() {
        observedFiles += 1;
        throw new Error("A linked source path must not reach file observation.");
      }
    }
  });
  const outsideRoot = path.join(fixture.root, "outside");
  const originalText = "export const linked = 'original';\n";
  try {
    for (const target of [
      { name: "outside", root: outsideRoot },
      { name: "inside", root: path.join(fixture.sourceRoot, "ordinary") }
    ]) {
      await mkdir(path.join(target.root, "nested"), { recursive: true });
      const targetFile = path.join(target.root, "nested", "linked.js");
      await writeFile(targetFile, originalText);
      const linkPath = `linked-${target.name}`;
      await symlink(target.root, path.join(fixture.sourceRoot, linkPath), "dir");
      const linkedFile = `${linkPath}/nested/linked.js`;
      const input = { path: linkedFile, sessionId: "session-1" };

      await t.test(`rejects reading through a link to ${target.name} source`, async () => {
        const result = await fixture.service.readFile(input);
        assert.equal(result.ok, false);
        assert.equal(result.errors[0].code, "vibe64_source_editor_symlink");
      });

      await t.test(`rejects browsing beneath a link to ${target.name} source`, async () => {
        const result = await fixture.service.readTree({
          ...input,
          path: `${linkPath}/nested`
        });
        assert.equal(result.ok, false);
        assert.equal(result.errors[0].code, "vibe64_source_editor_symlink");
      });

      await t.test(`does not resolve a file through a link to ${target.name} source`, async () => {
        const result = await fixture.service.resolvePath({
          fromPath: "src/app.js",
          sessionId: "session-1",
          target: `../${linkedFile}`
        });
        assert.equal(result.ok, true);
        assert.equal(result.resolved, false);
      });

      await t.test(`does not save through a link to ${target.name} source`, async () => {
        const result = await fixture.service.saveFile({
          ...input,
          baseHash: crypto.createHash("sha256").update(originalText).digest("hex"),
          text: "export const linked = 'overwritten';\n"
        });
        assert.deepEqual({
          code: result.errors?.[0]?.code,
          ok: result.ok,
          text: await readFile(targetFile, "utf8")
        }, {
          code: "vibe64_source_editor_symlink",
          ok: false,
          text: originalText
        });
      });

      await t.test(`does not create files through a link to ${target.name} source`, async () => {
        const result = await fixture.service.createFile({
          ...input,
          path: `${linkPath}/nested/created.js`
        });
        assert.equal(result.ok, false);
        assert.equal(result.errors[0].code, "vibe64_source_editor_symlink");
        await assert.rejects(readFile(path.join(target.root, "nested", "created.js")), { code: "ENOENT" });
      });

      await t.test(`does not observe files through a link to ${target.name} source`, async () => {
        await assert.rejects(fixture.service.streamFileChanges(input, {
          emit() {},
          isClosed: () => false,
          onClose() {}
        }), { code: "vibe64_source_editor_symlink" });
        assert.equal(observedFiles, 0);
      });
    }
  } finally {
    fixture.service.close();
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

test("source explanations use a member's shared Economy without the personal working conversation", async (t) => {
  const member = { role: "member", username: "ada" };
  const selection = { ...sourceRoutingDecision("opencode").effectiveSelection,
    modelProviderId: "deepseek", modelId: "deepseek-chat" };
  const profile = { ...resolvedSourceExplanationProfile(), providerId: "opencode", model: "deepseek-chat" };
  const nativeScopes = [];
  const deleted = [];
  const fixture = await createSourceEditorFixture({
    terminalService: {
      requireAssistantAccess() { throw new Error("The working conversation must not authorize this helper."); },
      resolveAssistantPurpose(input, options) {
        assert.equal(input.purpose, "source_explanation");
        assert.equal(input.workflowEngineId, "codex");
        assert.deepEqual(options.vibe64User, member);
        assert.equal(JSON.parse(options.session.metadata.assistant_selection).modelId, "gpt-6-astra");
        return { available: true, effectiveSelection: selection, connectionIdentity: "workspace-deepseek" };
      },
      resolveEphemeralAgentExecutionProfile(_scope, input, options) {
        assert.equal(input.workloadId, "source_explanation");
        assert.deepEqual(options.assistantSelection, selection);
        assert.equal(options.expectedConnectionIdentity, "workspace-deepseek");
        return profile;
      },
      async runEphemeralAgentChatTurn(scope, input, options) {
        nativeScopes.push(scope.id);
        assert.equal(input.executionProfile, profile, "the manager's profile provenance survives until execution");
        assert.deepEqual(options.assistantSelection, selection);
        assert.deepEqual(options.vibe64User, member);
        await options.onEvent({ type: "thread", threadId: "member-explanation" });
        await options.onEvent({ type: "turn", turnId: `turn-${nativeScopes.length}` });
        return { ok: true, text: structuredExplanation("Only bounded source context."), executionProfile: profile,
          threadId: "member-explanation", turnId: `turn-${nativeScopes.length}` };
      },
      async deleteEphemeralAgentConversation(scope, input, options) {
        deleted.push({ scope: scope.id, conversation: input.conversationId });
        assert.deepEqual(options.assistantSelection, selection);
        return { ok: true };
      }
    }
  });
  t.after(async () => { await fixture.service.close(); await rm(fixture.root, { recursive: true, force: true }); });
  const input = { sessionId: "session-1", explanationId: "exp_member_shared", path: "src/app.js", scope: "file", vibe64User: member };
  const initial = await fixture.service.explainSelection(input);
  assert.equal(initial.ok, true, JSON.stringify(initial));
  const followup = await fixture.service.addExplanationFollowup({ ...input, message: "Why does it log?" });
  assert.equal(followup.ok, true, JSON.stringify(followup));
  assert.equal(followup.explanation.model, "deepseek-chat");
  assert.equal(nativeScopes.length, 2);
  assert.equal(nativeScopes[0], nativeScopes[1]);
  assert.doesNotMatch(JSON.stringify(followup), /workspace-deepseek|assistant-helpers|actorIdentity|runtimeRoot/);
  const ledgerPath = path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json");
  const ledgerText = await readFile(ledgerPath, "utf8");
  assert.doesNotMatch(ledgerText, /Why does it log|Only bounded source context|console\.log/);
  const record = JSON.parse(ledgerText).records[0];
  assert.equal(record.helper.selection.modelId, "deepseek-chat");
  assert.equal((await fixture.service.deleteExplanation(input)).ok, true);
  assert.deepEqual(deleted, [{ scope: nativeScopes[0], conversation: "member-explanation" }]);
  await assert.rejects(lstat(path.dirname(record.helper.scope.runtimeRoot)), { code: "ENOENT" });
  await assert.rejects(readFile(ledgerPath), { code: "ENOENT" });
});

for (const changed of ["connection", "model", "actor"]) {
  test(`source follow-ups cannot reuse a native conversation after its ${changed} changes`, async (t) => {
    let connectionIdentity = "connection-a";
    let model = "gpt-5.6-luna";
    let actor = { role: "member", username: "ada" };
    let runs = 0;
    const deleted = [];
    const fixture = await createSourceEditorFixture({ terminalService: {
      resolveAssistantPurpose() {
        const decision = sourceRoutingDecision("codex", connectionIdentity);
        return { ...decision, effectiveSelection: { ...decision.effectiveSelection, modelId: model } };
      },
      resolveEphemeralAgentExecutionProfile() { return { ...resolvedSourceExplanationProfile(), model }; },
      async runEphemeralAgentChatTurn(scope, _input, options) {
        runs += 1;
        await options.onEvent({ type: "thread", threadId: `thread-${runs}` });
        return { ok: true, text: structuredExplanation("Explanation."), threadId: `thread-${runs}`,
          executionProfile: { ...resolvedSourceExplanationProfile(), model } };
      },
      async deleteEphemeralAgentConversation(scope, input) {
        deleted.push({ scope: scope.id, thread: input.conversationId });
        return { ok: true };
      }
    } });
    t.after(async () => { await fixture.service.close(); await rm(fixture.root, { recursive: true, force: true }); });
    const input = { sessionId: "session-1", explanationId: `exp_changed_${changed}`, path: "src/app.js", scope: "file" };
    assert.equal((await fixture.service.explainSelection({ ...input, vibe64User: actor })).ok, true);
    const firstScope = fixture.helperScopes[0].id;
    if (changed === "connection") connectionIdentity = "connection-b";
    if (changed === "model") model = "gpt-5.4-nano";
    if (changed === "actor") actor = { role: "member", username: "grace" };
    const blocked = await fixture.service.addExplanationFollowup({ ...input, vibe64User: actor, message: "Continue" });
    assert.equal(blocked.code, "vibe64_source_explanation_destination_changed");
    assert.equal(runs, 1);
    assert.deepEqual(deleted, []);
    const regenerated = await fixture.service.explainSelection({ ...input, vibe64User: actor, force: true });
    assert.equal(regenerated.ok, true, JSON.stringify(regenerated));
    assert.equal(runs, 2);
    assert.deepEqual(deleted, [{ scope: firstScope, thread: "thread-1" }]);
    assert.notEqual(fixture.helperScopes.at(-1).id, firstScope);
  });
}

for (const action of ["Close", "session close"]) {
  test(`source ${action} waits for late native startup and removes its owned scope`, async (t) => {
    const starting = Promise.withResolvers();
    const release = Promise.withResolvers();
    let deletedScope;
    const fixture = await createSourceEditorFixture({ terminalService: {
      async runEphemeralAgentChatTurn(_scope, _input, options) {
        starting.resolve();
        await release.promise;
        await options.onEvent({ type: "thread", threadId: "late-native-thread" });
        options.signal.throwIfAborted();
        throw new Error("No turn may start after cancellation.");
      },
      async deleteEphemeralAgentConversation(scope, input) {
        deletedScope = scope;
        assert.equal(input.conversationId, "late-native-thread");
        return { ok: true };
      }
    } });
    t.after(async () => { release.resolve(); await fixture.service.close(); await rm(fixture.root, { recursive: true, force: true }); });
    const input = { sessionId: "session-1", explanationId: "exp_late_start", path: "src/app.js", scope: "file" };
    const generating = fixture.service.streamExplanation(input);
    await starting.promise;
    let closed = false;
    const closing = (action === "Close" ? fixture.service.deleteExplanation(input)
      : fixture.service.closeExplanationsForSession(input.sessionId)).then((result) => { closed = true; return result; });
    await new Promise((resolve) => setImmediate(resolve));
    assert.equal(closed, false);
    release.resolve();
    const result = await closing;
    assert.equal(result.ok, true, JSON.stringify(result));
    await generating;
    assert.ok(deletedScope);
    await assert.rejects(lstat(path.dirname(deletedScope.runtimeRoot)), { code: "ENOENT" });
    await assert.rejects(readFile(path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json")), { code: "ENOENT" });
  });
}

test("source cleanup survives a restart and uses the captured destination without another inference", async (t) => {
  let cleanupAvailable = false;
  let routingAllowed = true;
  let runs = 0;
  const deletes = [];
  const fixture = await createSourceEditorFixture({ terminalService: {
    resolveAssistantPurpose() {
      assert.equal(routingAllowed, true, "restart cleanup does not resolve new inference");
      return sourceRoutingDecision();
    },
    async runEphemeralAgentChatTurn(_scope, _input, options) {
      runs += 1;
      await options.onEvent({ type: "thread", threadId: "restart-thread" });
      return { ok: true, text: structuredExplanation("Ready."), threadId: "restart-thread",
        executionProfile: resolvedSourceExplanationProfile() };
    },
    async deleteEphemeralAgentConversation(scope, input, options) {
      deletes.push({ scope: scope.id, thread: input.conversationId, selection: options.assistantSelection });
      return cleanupAvailable ? { ok: true } : { ok: false, code: "native_cleanup_failed", error: "Retry cleanup." };
    }
  } });
  let restarted;
  t.after(async () => { await fixture.service.close(); await restarted?.close(); await rm(fixture.root, { recursive: true, force: true }); });
  const input = { sessionId: "session-1", explanationId: "exp_restart", path: "src/app.js", scope: "file" };
  assert.equal((await fixture.service.explainSelection(input)).ok, true);
  assert.equal((await fixture.service.deleteExplanation(input)).code, "native_cleanup_failed");
  const ledgerPath = path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json");
  const retained = JSON.parse(await readFile(ledgerPath, "utf8")).records[0];
  assert.equal(retained.helper.conversationId, "restart-thread");
  assert.equal((await fixture.service.closeExplanationsForSession(input.sessionId)).ok, false);
  await fixture.service.close();
  routingAllowed = false;
  cleanupAvailable = true;
  restarted = fixture.restartService();
  assert.equal((await restarted.closeExplanationsForSession(input.sessionId)).ok, true);
  assert.equal(runs, 1);
  assert.equal(deletes.length, 3);
  assert.deepEqual(deletes[0], deletes[1]);
  assert.deepEqual(deletes[1], deletes[2]);
  await assert.rejects(readFile(ledgerPath), { code: "ENOENT" });
  await assert.rejects(lstat(path.dirname(retained.helper.scope.runtimeRoot)), { code: "ENOENT" });
});

test("source Stop reports a rejected provider acknowledgement and preserves cleanup ownership", async (t) => {
  const ready = Promise.withResolvers();
  const release = Promise.withResolvers();
  const fixture = await createSourceEditorFixture({ terminalService: {
    async runEphemeralAgentChatTurn(_scope, _input, options) {
      await options.onEvent({ type: "thread", threadId: "unconfirmed-stop" });
      await options.onEvent({ type: "turn", turnId: "unconfirmed-turn" });
      ready.resolve();
      await release.promise;
      return { ok: true, text: structuredExplanation("Late answer."), threadId: "unconfirmed-stop",
        executionProfile: resolvedSourceExplanationProfile() };
    },
    async stopEphemeralAgentConversation() {
      release.resolve();
      throw Object.assign(new Error("The provider could not stop."), { code: "native_stop_failed" });
    },
    async deleteEphemeralAgentConversation() { return { ok: false, error: "Still running." }; }
  } });
  t.after(async () => { release.resolve(); await fixture.service.close(); await rm(fixture.root, { recursive: true, force: true }); });
  const input = { sessionId: "session-1", explanationId: "exp_unconfirmed_stop", path: "src/app.js", scope: "file" };
  const events = [];
  const generating = fixture.service.streamExplanation(input, { emit: (event) => events.push(event) });
  await ready.promise;
  const stopped = await fixture.service.stopExplanation(input);
  await generating;
  assert.equal(stopped.ok, false);
  assert.equal(stopped.code, "native_stop_failed");
  assert.equal(events.some((event) => event.type === "source-explanation.finished"), false);
  const retained = JSON.parse(await readFile(path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json"), "utf8"));
  assert.equal(retained.records[0].helper.conversationId, "unconfirmed-stop");
});

test("source Stop can cancel before profile resolution without starting or leaking a native conversation", async (t) => {
  const preparing = Promise.withResolvers();
  const release = Promise.withResolvers();
  let runs = 0;
  let cleanedScope;
  const fixture = await createSourceEditorFixture({ terminalService: {
    async resolveEphemeralAgentExecutionProfile() {
      preparing.resolve();
      await release.promise;
      return resolvedSourceExplanationProfile();
    },
    async runEphemeralAgentChatTurn() { runs += 1; throw new Error("Cancelled preparation must not infer."); },
    async deleteEphemeralAgentConversation(scope, input) {
      cleanedScope = scope;
      assert.equal(input.conversationId, "");
      return { ok: true };
    }
  } });
  t.after(async () => { release.resolve(); await fixture.service.close(); await rm(fixture.root, { recursive: true, force: true }); });
  const input = { sessionId: "session-1", explanationId: "exp_cancel_prepare", path: "src/app.js", scope: "file" };
  const generating = fixture.service.streamExplanation(input);
  await preparing.promise;
  const stopping = fixture.service.stopExplanation(input);
  await new Promise((resolve) => setImmediate(resolve));
  release.resolve();
  const stopped = await stopping;
  await generating;
  assert.equal(stopped.ok, true, JSON.stringify(stopped));
  assert.equal(stopped.explanation.status, "stopped");
  assert.equal(runs, 0);
  await assert.rejects(lstat(path.dirname(cleanedScope.runtimeRoot)), { code: "ENOENT" });
});

test("source cleanup retires old thread-only references without resolving a new helper", async (t) => {
  const deleted = [];
  const fixture = await createSourceEditorFixture({ terminalService: {
    resolveAssistantPurpose() { throw new Error("Cleanup must not resolve inference."); },
    async deleteDetachedAgentChatThread(sessionId, input) {
      deleted.push({ sessionId, threadId: input.threadId });
      return { ok: true };
    }
  } });
  t.after(async () => { await fixture.service.close(); await rm(fixture.root, { recursive: true, force: true }); });
  await mkdir(fixture.sourceEditorTempRoot, { recursive: true });
  const cleanupPath = path.join(fixture.sourceEditorTempRoot, "source-editor-explanation-cleanup.json");
  await writeFile(cleanupPath, JSON.stringify({ records: [{ id: "exp_legacy", sessionId: "session-1",
    agentThreadId: "old-native-thread", sourcePath: "src/app.js", updatedAt: "2000-01-01T00:00:00.000Z" }] }));
  const closed = await fixture.service.closeExplanationsForSession("session-1");
  assert.equal(closed.ok, true, JSON.stringify(closed));
  assert.deepEqual(deleted, [{ sessionId: "session-1", threadId: "old-native-thread" }]);
  await assert.rejects(readFile(cleanupPath), { code: "ENOENT" });
});
