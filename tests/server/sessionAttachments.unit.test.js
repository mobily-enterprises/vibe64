import assert from "node:assert/strict";
import { readFile, utimes, mkdir, rm, symlink } from "node:fs/promises";
import path from "node:path";
import { Readable } from "node:stream";
import test from "node:test";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { createSessionAttachments } from "../../packages/vibe64-terminals/src/server/sessionAttachments.js";
import { createSessionAgentManager } from "../../packages/vibe64-terminals/src/server/agent/sessionAgentManager.js";
import { prepareCodexAttachmentStorage } from "../../packages/vibe64-terminals/src/server/codexAttachments.js";
import { codexTurnInput } from "../../packages/vibe64-runtime/src/server/codexAppServerProvider.js";
import { sendCodexAppServerPromptForSession } from "../../packages/vibe64-runtime/src/server/codexAppServerSessionBridge.js";
import { createOpenCodeServerClient } from "@jskit-ai/assistant-core/server/opencode-client";
import { projectRuntimeRoot, sourceMetadata, withTemporaryRoot } from "./vibe64TestHelpers.js";

async function fixture(root) {
  const store = createVibe64SessionStore({ projectContextRoot: root, projectRuntimeRoot: projectRuntimeRoot(root) });
  for (const sessionId of ["one", "two"]) {
    await store.createSession({ runtimeKind: "genesis", sessionId, metadata: sourceMetadata(root, sessionId) });
  }
  const runtime = { store, getSession: (id) => store.readSession(id) };
  const env = { VIBE64_CODEX_ATTACHMENTS_ROOT: path.join(root, "uploads") };
  const projectService = { createRuntime: async () => runtime };
  const attachments = createSessionAttachments({ env, projectService });
  return { attachments, env, projectService, runtime, store };
}

async function upload(attachments, fileName = "screen.png") {
  const result = await attachments.uploadAttachment({ sessionId: "one" }, {
    fileName, contentType: "text/html", stream: Readable.from([Buffer.from("attachment bytes")])
  });
  assert.equal(result.ok, true);
  return result;
}

for (const engine of ["codex", "opencode"]) {
  test(`${engine}: shared attachment admission resolves IDs, persists metadata, and keeps files beyond upload expiry`, async () => {
    await withTemporaryRoot(async (root) => {
      const { attachments, env, projectService, runtime, store } = await fixture(root);
      let delivered;
      const manager = createSessionAgentManager({
        attachments, defaultProviderId: engine,
        providers: [{ id: engine, transportId: `${engine}_test`, async sendMessage(_context, input) {
          delivered = input;
          await store.writeConversationUserMessage("one", { text: input.displayMessage, messageId: "message-1", attachments: input.displayAttachments });
          return { ok: true, delivered: true };
        } }]
      });
      const uploaded = await manager.uploadAttachment("one", { fileName: "screen.png", stream: Readable.from(["attachment bytes"]) });
      await manager.sendMessage("one", {
        message: "Inspect [Image #1]", attachmentIds: [uploaded.attachmentId], attachmentsPrepared: true,
        attachments: [{ path: "/etc/passwd", contentType: "image/png" }],
        displayAttachments: [{ attachmentId: uploaded.attachmentId, fileName: "forged.html", reference: "[Image #1]" }]
      }, { runtime });
      assert.equal(delivered.attachments[0].fileName, "screen.png");
      assert.equal(delivered.attachments[0].contentType, "image/png");
      assert.equal(await readFile(delivered.attachments[0].path, "utf8"), "attachment bytes");
      assert.ok(delivered.attachments[0].path.startsWith(store.paths("one").artifactsRoot));
      assert.ok(!delivered.message.includes("/etc/passwd"));
      const old = new Date(Date.now() - 60 * 60 * 1000);
      await utimes(uploaded.path, old, old);
      await prepareCodexAttachmentStorage({ env });
      await assert.rejects(readFile(uploaded.path), { code: "ENOENT" });
      const restarted = createSessionAttachments({ env, projectService });
      for (let turn = 0; turn < 5; turn++) {
        await store.writeConversationUserMessage("one", { text: `Follow-up ${turn}`, messageId: `follow-${turn}` });
      }
      const opened = await restarted.readAttachment({ sessionId: "one" }, uploaded.attachmentId);
      assert.equal(await opened.fileHandle.readFile("utf8"), "attachment bytes");
      await opened.fileHandle.close();
      const history = await store.readConversationLog("one");
      assert.equal(history[0].user.attachments[0].attachmentId, uploaded.attachmentId);
      assert.equal(history[0].user.attachments[0].reference, "[Image #1]");
      assert.ok(!JSON.stringify(history).includes(store.paths("one").artifactsRoot));
      const retried = await restarted.prepareMessage({ sessionId: "one" }, { message: "Retry", attachmentIds: [uploaded.attachmentId] });
      assert.equal(retried.attachments[0].path, delivered.attachments[0].path);
      assert.equal((await restarted.deleteAttachment({ sessionId: "one" }, { attachmentId: uploaded.attachmentId })).ok, false);
      await store.writeStatus("one", VIBE64_SESSION_STATUS.ARCHIVED);
      await store.publishSessionArchive("one");
      const archived = await restarted.readAttachment({ sessionId: "one" }, uploaded.attachmentId);
      assert.equal(await archived.fileHandle.readFile("utf8"), "attachment bytes");
      await archived.fileHandle.close();
    });
  });
}

test("attachment reads and sends reject other sessions, invalid IDs and expired uploads", async () => {
  await withTemporaryRoot(async (root) => {
    const { attachments, env } = await fixture(root);
    const uploaded = await upload(attachments);
    for (const id of [uploaded.attachmentId, "../../etc/passwd"]) {
      await assert.rejects(attachments.readAttachment({ sessionId: "two" }, id));
      await assert.rejects(attachments.prepareMessage({ sessionId: "two" }, { message: "Inspect", attachmentIds: [id] }));
    }
    const old = new Date(Date.now() - 60 * 60 * 1000);
    await utimes(uploaded.path, old, old);
    await prepareCodexAttachmentStorage({ env });
    await assert.rejects(attachments.prepareMessage({ sessionId: "one" }, { message: "Inspect", attachmentIds: [uploaded.attachmentId] }), /no longer available/u);
  });
});

test("draft uploads support preview, pin/unpin and explicit deletion without becoming session artifacts", async () => {
  await withTemporaryRoot(async (root) => {
    const { attachments, env } = await fixture(root);
    const uploaded = await upload(attachments, "unsafe.svg");
    const opened = await attachments.readAttachment({ sessionId: "one" }, uploaded.attachmentId);
    assert.equal(opened.attachment.contentType, "application/octet-stream");
    await opened.fileHandle.close();
    const input = { attachmentIds: [uploaded.attachmentId], suggestionId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa" };
    await attachments.pinAttachments({ sessionId: "one" }, input);
    await prepareCodexAttachmentStorage({ env, now: Date.now() + 3600000 });
    assert.equal(await readFile(uploaded.path, "utf8"), "attachment bytes");
    await assert.rejects(attachments.deleteAttachment({ sessionId: "one" }, { attachmentId: uploaded.attachmentId }), /pending owner suggestion/u);
    await attachments.unpinAttachments({ sessionId: "one" }, input);
    await attachments.deleteAttachment({ sessionId: "one" }, { attachmentId: uploaded.attachmentId });
    await assert.rejects(readFile(uploaded.path), { code: "ENOENT" });
  });
});

test("Codex and OpenCode translate the same resolved image into native input and leave other files as path references", async () => {
  const attachments = [
    { attachmentId: "image", fileName: "a b.png", path: "/session/artifacts/a b.png", contentType: "image/png" },
    { attachmentId: "file", fileName: "data.csv", path: "/session/artifacts/data.csv", contentType: "application/octet-stream" }
  ];
  let codexInput;
  await sendCodexAppServerPromptForSession({
    attachments, prompt: "Inspect [Image #1] and [File #1]", threadId: "thread", workdir: "/session",
    provider: { async sendTurn(_id, input) { codexInput = codexTurnInput(input); return { id: "turn" }; } }
  });
  assert.deepEqual(codexInput, [
    { type: "text", text: "Inspect [Image #1] and [File #1]", text_elements: [] },
    { type: "localImage", path: attachments[0].path }
  ]);
  let openCodeInput;
  const client = createOpenCodeServerClient({
    baseUrl: "http://127.0.0.1:4096", password: "test",
    fetchImpl: async (url, init) => {
      if (init.method === "GET") return new Response(JSON.stringify({ permission: [] }));
      if (new URL(url).pathname.endsWith("/prompt_async")) openCodeInput = JSON.parse(init.body);
      return new Response(JSON.stringify({ info: { id: "message" } }), { headers: { "content-type": "application/json" } });
    }
  });
  await client.prompt("session", { prompt: { text: "Inspect" }, attachments });
  assert.deepEqual(openCodeInput.parts, [
    { type: "text", text: "Inspect" },
    { type: "file", mime: "image/png", filename: "a b.png", url: "file:///session/artifacts/a%20b.png" }
  ]);
});

test("temporary conversation sends resolve shared uploads without retaining them past explicit cleanup", async () => {
  await withTemporaryRoot(async (root) => {
    const { attachments, runtime, store } = await fixture(root);
    let delivered;
    const manager = createSessionAgentManager({
      attachments,
      providers: [{ id: "codex", transportId: "codex_test", async startConversationTurn(_context, input) {
        delivered = input;
        return { ok: true };
      } }]
    });
    const uploaded = await upload(attachments);
    await manager.startConversationTurn("one", {
      message: "Inspect", attachmentIds: [uploaded.attachmentId]
    }, { runtime });
    assert.equal(delivered.attachments[0].path, uploaded.path);
    assert.equal(delivered.displayAttachments[0].reference, "[Image #1]");
    await assert.rejects(readFile(path.join(store.paths("one").artifactsRoot, "attachments", uploaded.attachmentId, "file")), { code: "ENOENT" });
    await attachments.deleteAttachment({ sessionId: "one" }, { attachmentId: uploaded.attachmentId });
    await assert.rejects(readFile(uploaded.path), { code: "ENOENT" });
  });
});


test("saved attachment reads reject symlink replacement and other project identities", async () => {
  await withTemporaryRoot(async (root) => {
    const { attachments, env } = await fixture(root);
    const uploaded = await upload(attachments);
    const prepared = await attachments.prepareMessage({ sessionId: "one" }, { message: "Inspect", attachmentIds: [uploaded.attachmentId] });
    const otherRoot = path.join(root, "other-project");
    await mkdir(otherRoot);
    const other = await fixture(otherRoot);
    const otherAttachments = createSessionAttachments({ env, projectService: other.projectService });
    await assert.rejects(otherAttachments.readAttachment({ sessionId: "one" }, uploaded.attachmentId));
    await rm(prepared.attachments[0].path);
    await symlink(uploaded.path, prepared.attachments[0].path);
    await assert.rejects(attachments.readAttachment({ sessionId: "one" }, uploaded.attachmentId), { code: "ELOOP" });
  });
});

test("shared admission rejects excess files and closing sessions before upload", async () => {
  await withTemporaryRoot(async (root) => {
    const { attachments, store } = await fixture(root);
    await assert.rejects(attachments.prepareMessage({ sessionId: "one" }, { message: "Inspect", attachmentIds: Array.from({ length: 11 }, (_, i) => String(i)) }), /at most 10/u);
    await store.writeStatus("one", VIBE64_SESSION_STATUS.ARCHIVED);
    await assert.rejects(attachments.uploadAttachment({ sessionId: "one" }, { fileName: "closed.png", stream: Readable.from(["data"]) }), /closing/u);
  });
});
