import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { once } from "node:events";
import {
  access,
  mkdir,
  mkdtemp,
  open,
  readFile,
  readdir,
  rm,
  stat,
  utimes,
  writeFile
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { PassThrough, Readable } from "node:stream";
import test from "node:test";
import Fastify from "fastify";
import { createActionCatalogue } from "@jskit-ai/kernel/server/actions";
import { createVibe64SessionStore, VIBE64_SESSION_STATUS } from "@local/vibe64-runtime/server/sessionStore";
import { createSessionAttachments } from "../../packages/vibe64-terminals/src/server/sessionAttachments.js";
import { registerVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { createTerminalActions } from "../../packages/vibe64-terminals/src/server/actions.js";
import {
  registerMultipartSupport
} from "@jskit-ai/uploads-runtime/server/multipart/registerMultipartSupport";

import {
  CODEX_ATTACHMENT_MAX_BYTES,
  CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES,
  cleanupCodexAttachments,
  prepareCodexAttachmentStorage,
  releaseCodexSessionAttachments,
  renewCodexAttachments,
  storeCodexAttachment
} from "../../packages/vibe64-terminals/src/server/codexAttachments.js";
import {
  VIBE64_CODEX_ATTACHMENTS_ROOT_ENV,
  codexAttachmentHostRoot,
  prepareCodexAttachmentRoot
} from "../../packages/vibe64-runtime/src/server/codexAttachmentPaths.js";
import {
  registerRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";
import { createCodexSessionRegistration } from "../../packages/vibe64-terminals/src/server/service.js";
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";
import {
  tryAcquireExclusiveFileLock
} from "../../packages/vibe64-execution/src/server/engines/fileLock.js";

test("assistant attachment route reads one bounded multipart file into the upload action", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-route-test-"));
  const app = testApp();
  const source = Readable.from([Buffer.from("multipart bytes")]);
  const readSingleMultipartFile = test.mock.fn(async () => ({
    fileName: "café.txt",
    mimeType: "text/plain",
    stream: source
  }));
  const parts = test.mock.fn(() => (async function *attachmentParts() {
    yield {
      fieldname: "file",
      file: source,
      filename: "café.txt",
      mimetype: "text/plain",
      type: "file"
    };
  })());
  const executeAction = test.mock.fn(async ({ input }) => ({
    fileName: input.fileName,
    ok: true
  }));

  try {
    registerRoutes(app.http, {
      fastify: app.fastify,
      projectContext: explicitProjectContext(root),
      terminals: app.terminals,
      uploads: { readSingleMultipartFile }
    });

    const attachmentRoute = app.registeredRoutes.find((route) => {
      return route.method === "POST" && route.path.endsWith("/sessions/:sessionId/agent-attachments");
    });

    assert.ok(attachmentRoute);
    assert.equal(attachmentRoute.options.body, undefined);
    assert.equal(attachmentRoute.options.bodyLimit, CODEX_ATTACHMENT_REQUEST_BODY_LIMIT_BYTES);

    const reply = testReply();
    await attachmentRoute.handler({
      executeAction,
      headers: { host: "localhost" },
      ip: "127.0.0.1",
      params: {
        sessionId: "session-1",
        slug: "project"
      },
      parts
    }, reply);

    assert.equal(reply.statusCode, 200);
    assert.deepEqual(reply.body, {
      fileName: "café.txt",
      ok: true
    });
    assert.equal(readSingleMultipartFile.mock.callCount(), 0);
    assert.deepEqual(parts.mock.calls[0].arguments[0], {
      throwFileSizeLimit: true,
      limits: {
        fileSize: CODEX_ATTACHMENT_MAX_BYTES,
        files: 2,
        parts: 2
      }
    });
    const action = executeAction.mock.calls[0].arguments[0];
    assert.equal(action.actionId, "vibe64.terminals.agent-attachment.upload");
    assert.equal(action.input.sessionId, "session-1");
    assert.equal(action.input.stream, source);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("assistant attachment route fails closed without strict multipart iteration", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-route-no-parts-test-"));
  const app = testApp();
  const executeAction = test.mock.fn();
  try {
    registerRoutes(app.http, {
      fastify: app.fastify,
      projectContext: explicitProjectContext(root),
      terminals: app.terminals,
      uploads: { readSingleMultipartFile() {} }
    });
    const attachmentRoute = app.registeredRoutes.find((route) => {
      return route.method === "POST" && route.path.endsWith("/sessions/:sessionId/agent-attachments");
    });
    assert.ok(attachmentRoute);

    await assert.rejects(() => attachmentRoute.handler({
      executeAction,
      headers: { host: "localhost" },
      ip: "127.0.0.1",
      params: {
        sessionId: "session-1",
        slug: "project"
      }
    }, testReply()), {
      message: "Attachment uploads require strict multipart iteration support.",
      name: "TypeError"
    });
    assert.equal(executeAction.mock.callCount(), 0);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("real multipart parsing accepts exactly one file and removes a stored first file when extras follow", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-http-route-test-"));
  const captured = testApp();
  const fastify = Fastify();
  const actions = [];
  try {
    registerRoutes(captured.http, {
      fastify: captured.fastify,
      projectContext: explicitProjectContext(root),
      terminals: captured.terminals,
      uploads: { readSingleMultipartFile() {} }
    });
    const attachmentRoute = captured.registeredRoutes.find((route) => {
      return route.method === "POST" && route.path.endsWith("/sessions/:sessionId/agent-attachments");
    });
    assert.ok(attachmentRoute);

    await registerMultipartSupport(fastify);
    fastify.route({
      bodyLimit: attachmentRoute.options.bodyLimit,
      method: attachmentRoute.method,
      url: attachmentRoute.path,
      async handler(request, reply) {
        request.executeAction = async (action) => {
          actions.push(action);
          if (action.actionId === "vibe64.terminals.agent-attachment.delete") {
            return { ok: true };
          }
          let size = 0;
          for await (const chunk of action.input.stream) {
            size += chunk.length;
          }
          return {
            attachmentId: "11111111-1111-4111-8111-111111111111",
            ok: true,
            size
          };
        };
        return attachmentRoute.handler(request, reply);
      }
    });
    await fastify.ready();
    const url = attachmentRoute.path
      .replace(":slug", "project")
      .replace(":sessionId", "session-1");

    const accepted = multipartPayload([
      { contents: Buffer.from([0, 1, 2, 255]), fileName: "one.bin", name: "file" }
    ]);
    const acceptedReply = await fastify.inject({
      headers: { "content-type": accepted.contentType },
      method: "POST",
      payload: accepted.body,
      url
    });
    assert.equal(acceptedReply.statusCode, 200);
    assert.equal(acceptedReply.json().size, 4);
    assert.equal(actions.filter((action) => action.actionId.endsWith(".upload")).length, 1);

    actions.length = 0;
    const rejected = multipartPayload([
      { contents: "first", fileName: "first.txt", name: "file" },
      { contents: "second", fileName: "second.txt", name: "file" }
    ]);
    const rejectedReply = await fastify.inject({
      headers: { "content-type": rejected.contentType },
      method: "POST",
      payload: rejected.body,
      url
    });
    assert.equal(rejectedReply.statusCode, 400);
    assert.match(rejectedReply.body, /Validation failed/u);
    assert.deepEqual(actions.map((action) => action.actionId), [
      "vibe64.terminals.agent-attachment.upload",
      "vibe64.terminals.agent-attachment.delete"
    ]);
  } finally {
    await fastify.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("real multipart parsing rejects missing, ordered field, and misnamed file parts", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-http-shape-test-"));
  const harness = await realAttachmentRouteHarness(root);
  try {
    const rejectedShapes = [
      {
        label: "no file",
        parts: []
      },
      {
        label: "field before file",
        parts: [
          { contents: "metadata", name: "description" },
          { contents: "file", fileName: "after.txt", name: "file" }
        ]
      },
      {
        label: "wrong file field",
        parts: [
          { contents: "file", fileName: "wrong.txt", name: "attachment" }
        ]
      },
      {
        label: "blank file field",
        parts: [
          { contents: "file", fileName: "blank.txt", name: "" }
        ]
      }
    ];

    for (const rejected of rejectedShapes) {
      harness.actions.length = 0;
      const reply = await injectRealMultipart(harness, rejected.parts);
      assert.equal(reply.statusCode, 400, rejected.label);
      assert.match(reply.body, /Validation failed/u, rejected.label);
      assert.deepEqual(harness.actions, [], rejected.label);
    }

    harness.actions.length = 0;
    const trailingFieldReply = await injectRealMultipart(harness, [
      { contents: "file", fileName: "before.txt", name: "file" },
      { contents: "metadata", name: "description" }
    ]);
    assert.equal(trailingFieldReply.statusCode, 400);
    assert.match(trailingFieldReply.body, /Validation failed/u);
    assert.deepEqual(harness.actions.map((action) => action.actionId), [
      "vibe64.terminals.agent-attachment.upload",
      "vibe64.terminals.agent-attachment.delete"
    ]);
  } finally {
    await harness.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("real multipart parsing drains file streams when the action returns or throws without consuming them", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-http-drain-test-"));
  const harness = await realAttachmentRouteHarness(root);
  try {
    harness.setUploadAction(async () => ({
      attachmentId: "11111111-1111-4111-8111-111111111111",
      ok: true,
      size: 0
    }));
    const accepted = await injectRealMultipart(harness, [
      { contents: "unconsumed", fileName: "return.txt", name: "file" }
    ], 1_000);
    assert.equal(accepted.statusCode, 200);
    assert.equal(accepted.json().ok, true);
    assert.deepEqual(harness.actions.map((action) => action.actionId), [
      "vibe64.terminals.agent-attachment.upload"
    ]);

    harness.actions.length = 0;
    const rolledBack = await injectRealMultipart(harness, [
      { contents: "unconsumed", fileName: "rollback.txt", name: "file" },
      { contents: "not allowed", name: "description" }
    ], 1_000);
    assert.equal(rolledBack.statusCode, 400);
    assert.deepEqual(harness.actions.map((action) => action.actionId), [
      "vibe64.terminals.agent-attachment.upload",
      "vibe64.terminals.agent-attachment.delete"
    ]);

    harness.actions.length = 0;
    harness.setUploadAction(async () => {
      throw new Error("Action stopped before reading the attachment.");
    });
    const rejected = await injectRealMultipart(harness, [
      { contents: "unconsumed", fileName: "throw.txt", name: "file" }
    ], 1_000);
    assert.equal(rejected.statusCode, 500);
    assert.match(rejected.body, /Action stopped before reading the attachment/u);
    assert.deepEqual(harness.actions.map((action) => action.actionId), [
      "vibe64.terminals.agent-attachment.upload"
    ]);
  } finally {
    await harness.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("real multipart parsing accepts exactly 100 MB and rejects the next byte without buffering the test payload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-http-boundary-test-"));
  const harness = await realAttachmentRouteHarness(root);
  try {
    harness.setUploadAction(async (action) => {
      let size = 0;
      for await (const chunk of action.input.stream) {
        size += chunk.length;
      }
      if (action.input.stream.truncated) {
        const error = new Error("Attachment file is too large. Maximum allowed size is 100 MB.");
        error.statusCode = 413;
        throw error;
      }
      return { ok: true, size };
    });

    const exactPayload = streamingBoundaryMultipartPayload();
    const exactReply = await settleWithin(harness.fastify.inject({
      headers: { "content-type": exactPayload.contentType },
      method: "POST",
      payload: exactPayload.body,
      url: harness.url
    }), 5_000, "The exact 100 MB multipart request did not settle.");
    assert.equal(exactReply.statusCode, 200);
    assert.equal(exactReply.json().size, CODEX_ATTACHMENT_MAX_BYTES);

    const oversizedPayload = streamingBoundaryMultipartPayload({ extraByte: true });
    const oversizedReply = await settleWithin(harness.fastify.inject({
      headers: { "content-type": oversizedPayload.contentType },
      method: "POST",
      payload: oversizedPayload.body,
      url: harness.url
    }), 5_000, "The oversized multipart request did not settle.");
    assert.equal(oversizedReply.statusCode, 413);
    assert.match(oversizedReply.body, /too large/u);
  } finally {
    await harness.close();
    await rm(root, { force: true, recursive: true });
  }
});

test("Codex attachment streams preserve binary bytes and atomically expose the final file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-stream-test-"));
  const upload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const storing = storeCodexAttachment({
        executionRoot: "/source/project",
        input: {
          contentType: "application/octet-stream",
          fileName: "café 📄.bin",
          stream: upload
        },
        sessionId: "stream-session"
      });
      upload.write(Buffer.from([0, 1, 2, 3]));

      const partial = await waitForOnlyAttachmentFile(root);
      assert.match(partial, /^\.uploading-/u);

      upload.end(Buffer.from([254, 255]));
      const result = await storing;
      assert.equal(result.ok, true);
      assert.equal(result.fileName, "caf_ _.bin");
      assert.equal(result.size, 6);
      assert.deepEqual(await readFile(result.path), Buffer.from([0, 1, 2, 3, 254, 255]));
      assert.deepEqual(await attachmentFiles(root), [result.fileName]);

      await cleanupCodexAttachments("/source/project", "stream-session", result.attachmentId);
      assert.deepEqual(await attachmentFiles(root), []);
    });
  } finally {
    upload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("managed attachment files and directories honor the shared-process umask contract", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-mode-test-"));
  const previousUmask = process.umask(0o007);
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "permissions.txt", stream: Readable.from(["permissions"]) },
        sessionId: "permissions-session"
      });
      assert.equal(result.ok, true);
      assert.equal((await stat(result.path)).mode & 0o777, 0o660);
      assert.equal((await stat(path.dirname(result.path))).mode & 0o777, 0o770);
      assert.equal((await stat(path.dirname(path.dirname(result.path)))).mode & 0o777, 0o770);
      await cleanupCodexAttachments("/source/project", "permissions-session");
    });
  } finally {
    process.umask(previousUmask);
    await rm(root, { force: true, recursive: true });
  }
});

test("duplicate Unicode filenames receive isolated attachment ids and paths", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-duplicate-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const results = await Promise.all(["first", "second"].map((contents) => (
        storeCodexAttachment({
          executionRoot: "/source/project",
          input: {
            fileName: "résumé.txt",
            stream: Readable.from([contents])
          },
          sessionId: "duplicate-session"
        })
      )));

      assert.notEqual(results[0].attachmentId, results[1].attachmentId);
      assert.notEqual(results[0].path, results[1].path);
      assert.deepEqual(await Promise.all(results.map((result) => readFile(result.path, "utf8"))), [
        "first",
        "second"
      ]);
      await cleanupCodexAttachments("/source/project", "duplicate-session");
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("configured-size overflow and empty streams leave no partial attachment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-invalid-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const tooLarge = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: {
          fileName: "too-large.bin",
          stream: Readable.from([Buffer.from("12345")])
        },
        maxBytes: 4,
        sessionId: "limit-session"
      });
      const empty = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: {
          fileName: "empty.txt",
          stream: Readable.from([])
        },
        sessionId: "empty-session"
      });

      assert.deepEqual(tooLarge, {
        code: "vibe64_agent_attachment_too_large",
        error: "Attachment file is too large. Maximum allowed size is 4 bytes.",
        ok: false,
        statusCode: 413
      });
      assert.equal(empty.ok, false);
      assert.equal(empty.code, "vibe64_agent_attachment_empty");
      assert.deepEqual(await attachmentFiles(root), []);
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("aborted Codex attachment streams reject and leave no partial file", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-abort-test-"));
  const upload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const storing = storeCodexAttachment({
        executionRoot: "/source/project",
        input: {
          fileName: "aborted.txt",
          stream: upload
        },
        sessionId: "abort-session"
      });
      upload.write("partial");
      await waitForOnlyAttachmentFile(root);
      upload.destroy(Object.assign(new Error("client disconnected"), {
        code: "ECONNRESET"
      }));

      await assert.rejects(storing, {
        code: "ECONNRESET",
        message: "client disconnected"
      });
      assert.deepEqual(await attachmentFiles(root), []);
    });
  } finally {
    upload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("attachment DELETE rejects traversal instead of touching sibling namespaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-delete-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: {
          fileName: "keep.txt",
          stream: Readable.from(["keep"])
        },
        sessionId: "delete-session"
      });

      await assert.rejects(
        () => cleanupCodexAttachments("/source/project", "delete-session", ".."),
        {
          code: "vibe64_invalid_agent_attachment_id"
        }
      );
      assert.equal(await readFile(result.path, "utf8"), "keep");
      await cleanupCodexAttachments("/source/project", "delete-session", result.attachmentId);
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("accepted attachments renew their persisted and in-process 30-minute lease", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-renew-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: {
          fileName: "renew.txt",
          stream: Readable.from(["renew"])
        },
        sessionId: "renew-session"
      });
      const old = new Date(Date.now() - 20 * 60 * 1000);
      await utimes(result.path, old, old);

      assert.deepEqual(await renewCodexAttachments(
        "/source/project",
        "renew-session",
        [result.attachmentId]
      ), {
        missing: [],
        retained: [result.attachmentId]
      });
      assert.ok((await fileMtime(result.path)) > old.getTime());
      await cleanupCodexAttachments("/source/project", "renew-session");
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("an attachment lease held by another process is busy until that process releases it", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-process-lock-test-"));
  let holder = null;
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "process-lock.txt", stream: Readable.from(["locked"]) },
        sessionId: "process-lock-session"
      });
      holder = await spawnExclusiveLockHolder(
        path.join(path.dirname(result.path), ".lease-lock"),
        root
      );

      assert.deepEqual(await renewCodexAttachments(
        "/source/project",
        "process-lock-session",
        [result.attachmentId],
        { lockWaitMs: 25 }
      ), {
        busy: [result.attachmentId],
        missing: [],
        retained: []
      });

      await holder.release();
      assert.deepEqual(await renewCodexAttachments(
        "/source/project",
        "process-lock-session",
        [result.attachmentId],
        { lockWaitMs: 25 }
      ), {
        missing: [],
        retained: [result.attachmentId]
      });
      await cleanupCodexAttachments(
        "/source/project",
        "process-lock-session",
        "",
        { lockWaitMs: 25 }
      );
    });
  } finally {
    await holder?.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("SIGKILL releases an attachment lease for immediate renewal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-killed-lock-test-"));
  let holder = null;
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "killed-lock.txt", stream: Readable.from(["locked"]) },
        sessionId: "killed-lock-session"
      });
      holder = await spawnExclusiveLockHolder(
        path.join(path.dirname(result.path), ".lease-lock"),
        root
      );

      await holder.kill();
      assert.deepEqual(await renewCodexAttachments(
        "/source/project",
        "killed-lock-session",
        [result.attachmentId],
        { lockWaitMs: 250 }
      ), {
        missing: [],
        retained: [result.attachmentId]
      });
      await cleanupCodexAttachments(
        "/source/project",
        "killed-lock-session",
        "",
        { lockWaitMs: 25 }
      );
    });
  } finally {
    await holder?.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("multi-attachment renewal records each lease after its own lock wait", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-renew-wait-test-"));
  const holders = [];
  try {
    await withAttachmentRoot(root, async () => {
      const [first, second] = await Promise.all([
        storeCodexAttachment({
          executionRoot: "/source/project",
          input: { fileName: "first-wait.txt", stream: Readable.from(["first"]) },
          sessionId: "renew-wait-session"
        }),
        storeCodexAttachment({
          executionRoot: "/source/project",
          input: { fileName: "second-wait.txt", stream: Readable.from(["second"]) },
          sessionId: "renew-wait-session"
        })
      ]);
      const old = new Date(Date.now() - (20 * 60 * 1000));
      await Promise.all([
        utimes(first.path, old, old),
        utimes(second.path, old, old)
      ]);
      holders.push(
        await spawnExclusiveLockHolder(
          path.join(path.dirname(first.path), ".lease-lock"),
          root
        ),
        await spawnExclusiveLockHolder(
          path.join(path.dirname(second.path), ".lease-lock"),
          root
        )
      );

      const firstRelease = delay(75).then(() => holders[0].release());
      const secondRelease = delay(325).then(() => holders[1].release());
      assert.deepEqual(await renewCodexAttachments(
        "/source/project",
        "renew-wait-session",
        [first.attachmentId, second.attachmentId],
        { lockWaitMs: 750 }
      ), {
        missing: [],
        retained: [first.attachmentId, second.attachmentId]
      });
      await Promise.all([firstRelease, secondRelease]);

      const [firstMtime, secondMtime] = await Promise.all([
        fileMtime(first.path),
        fileMtime(second.path)
      ]);
      assert.ok(
        secondMtime - firstMtime >= 150,
        `Expected separate post-wait renewal times; got ${firstMtime} and ${secondMtime}.`
      );
      await cleanupCodexAttachments(
        "/source/project",
        "renew-wait-session",
        "",
        { lockWaitMs: 25 }
      );
    });
  } finally {
    await Promise.all(holders.map((holder) => holder.dispose()));
    await rm(root, { force: true, recursive: true });
  }
});

test("a cleanup timer in another process observes a later lease renewal", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-cross-process-lease-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "cross-process.txt", stream: Readable.from(["keep"]) },
        sessionId: "cross-process-session"
      });
      const nearlyExpired = new Date(Date.now() - (30 * 60 * 1000) + 1_500);
      await utimes(result.path, nearlyExpired, nearlyExpired);

      const moduleUrl = new URL(
        "../../packages/vibe64-terminals/src/server/codexAttachments.js",
        import.meta.url
      ).href;
      const childScript = `
        import { access } from "node:fs/promises";
        import { prepareCodexAttachmentStorage } from ${JSON.stringify(moduleUrl)};
        await prepareCodexAttachmentStorage({
          env: { VIBE64_CODEX_ATTACHMENTS_ROOT: process.env.ATTACHMENT_TEST_ROOT }
        });
        process.stdout.write("READY\\n");
        await new Promise((resolve) => setTimeout(resolve, 2_500));
        try {
          await access(process.env.ATTACHMENT_TEST_PATH);
          process.stdout.write("EXISTS\\n");
        } catch {
          process.stdout.write("MISSING\\n");
        }
      `;
      const child = spawn(process.execPath, ["--input-type=module", "--eval", childScript], {
        env: {
          ...process.env,
          ATTACHMENT_TEST_PATH: result.path,
          ATTACHMENT_TEST_ROOT: root
        },
        stdio: ["ignore", "pipe", "pipe"]
      });
      let output = "";
      let errors = "";
      child.stdout.setEncoding("utf8");
      child.stderr.setEncoding("utf8");
      child.stdout.on("data", (chunk) => {
        output += chunk;
      });
      child.stderr.on("data", (chunk) => {
        errors += chunk;
      });
      await waitForOutput(() => output, "READY");

      assert.deepEqual(await renewCodexAttachments(
        "/source/project",
        "cross-process-session",
        [result.attachmentId]
      ), {
        missing: [],
        retained: [result.attachmentId]
      });
      const [exitCode] = await once(child, "exit");
      assert.equal(exitCode, 0, errors);
      assert.match(output, /EXISTS/u);
      assert.equal(await readFile(result.path, "utf8"), "keep");
      await cleanupCodexAttachments("/source/project", "cross-process-session");
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Codex controller renews accepted attachments in the selected session source namespace", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-controller-renew-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const sessionId = "controller-renew-session";
      const executionRoot = path.join(root, "managed", "sessions", "active", sessionId, "source");
      const result = await storeCodexAttachment({
        executionRoot,
        input: {
          fileName: "renew-controller.txt",
          stream: Readable.from(["renew"])
        },
        sessionId
      });
      const old = new Date(Date.now() - 20 * 60 * 1000);
      await utimes(result.path, old, old);
      const { attachments: controller } = createCodexSessionRegistration({
        env: {
          VIBE64_RUNTIME_NAMESPACE: "test",
          VIBE64_WORKSPACE: "test"
        },
        projectService: {
          createRuntime() {
            return {
              async getSession() {
                return {
                  metadata: {
                    source_kind: "session_clone",
                    source_path: executionRoot,
                    source_path_authority: "managed_session_source"
                  },
                  sessionId,
                  sessionRoot: path.join(root, "runtime", "sessions", "active", sessionId)
                };
              }
            };
          }
        }
      });

      assert.deepEqual(await controller.renewAttachments(sessionId, [result.attachmentId]), {
        missing: [],
        ok: true,
        retained: [result.attachmentId]
      });
      assert.ok((await fileMtime(result.path)) > old.getTime());
      await cleanupCodexAttachments(executionRoot, sessionId);
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("shared upload, Codex renewal, and cleanup use the configured attachment root", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-controller-env-test-"));
  const processRoot = path.join(root, "process-root");
  const configuredRoot = path.join(root, "configured-root");
  const sessionId = "controller-configured-root-session";
  const executionRoot = path.join(root, "sessions", "active", sessionId, "source");
  const env = {
    [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: configuredRoot,
    VIBE64_RUNTIME_NAMESPACE: "test",
    VIBE64_WORKSPACE: "test"
  };
  const store = createVibe64SessionStore({
    projectContextRoot: root,
    projectRuntimeRoot: path.join(root, "runtime")
  });
  const runtime = { store, getSession: (id) => store.readSession(id) };
  const projectService = { createRuntime: () => runtime };
  const attachments = createSessionAttachments({ env, projectService });
  const { attachments: controller } = createCodexSessionRegistration({ env, projectService });
  try {
    await store.createSession({
      metadata: {
        source_kind: "session_clone",
        source_path: executionRoot,
        source_path_authority: "managed_session_source"
      },
      runtimeKind: "genesis",
      sessionId,
      status: VIBE64_SESSION_STATUS.ACTIVE
    });
    await mkdir(executionRoot, { recursive: true });
    await withAttachmentRoot(processRoot, async () => {
      const upload = await attachments.uploadAttachment({ sessionId }, {
        fileName: "configured.txt",
        stream: Readable.from(["configured"])
      });
      assert.equal(upload.ok, true, JSON.stringify(upload));
      assert.equal(upload.path.startsWith(`${configuredRoot}${path.sep}`), true);
      assert.equal((await attachmentFiles(processRoot)).length, 0);

      const old = new Date(Date.now() - 20 * 60 * 1000);
      await utimes(upload.path, old, old);
      assert.deepEqual(await controller.renewAttachments(sessionId, [upload.attachmentId]), {
        missing: [],
        ok: true,
        retained: [upload.attachmentId]
      });
      assert.ok((await fileMtime(upload.path)) > old.getTime());
      assert.deepEqual(await attachments.deleteAttachment({ sessionId }, {
        attachmentId: upload.attachmentId
      }), {
        attachmentId: upload.attachmentId,
        ok: true
      });
      await assert.rejects(() => access(upload.path), { code: "ENOENT" });
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("shared attachment admission rejects persisted and in-flight session closing", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-closing-session-test-"));
  const metadata = (sessionId, closingReason = "") => ({
    source_kind: "session_clone",
    source_path: path.join(root, "managed", "sessions", "active", sessionId, "source"),
    source_path_authority: "managed_session_source",
    ...(closingReason ? { session_closing_reason: closingReason } : {})
  });
  const env = {
    [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: root,
    VIBE64_RUNTIME_NAMESPACE: "test",
    VIBE64_WORKSPACE: "test"
  };
  const store = createVibe64SessionStore({
    projectContextRoot: root,
    projectRuntimeRoot: path.join(root, "runtime")
  });
  try {
    await store.createSession({
      metadata: metadata("persisted-closing", "archived"),
      runtimeKind: "genesis",
      sessionId: "persisted-closing",
      status: VIBE64_SESSION_STATUS.ACTIVE
    });
    await store.createSession({
      metadata: metadata("in-flight-closing"),
      runtimeKind: "genesis",
      sessionId: "in-flight-closing",
      status: VIBE64_SESSION_STATUS.ACTIVE
    });
    const runtime = { store, getSession: (id) => store.readSession(id) };
    const persistedAttachments = createSessionAttachments({
      env,
      projectService: { createRuntime: () => runtime }
    });
    await assert.rejects(persistedAttachments.uploadAttachment({ sessionId: "persisted-closing" }, {
      fileName: "blocked.txt",
      stream: Readable.from(["blocked"])
    }), {
      code: "vibe64_agent_attachment_session_unavailable",
      statusCode: 409,
      message: "This session is closing. Attachments cannot be added now."
    });

    let sessionReads = 0;
    const racingAttachments = createSessionAttachments({
      env,
      projectService: {
        createRuntime() {
          return {
            store,
            async getSession(sessionId) {
              sessionReads += 1;
              if (sessionReads > 1) {
                await store.writeMetadataValue(sessionId, "session_closing_reason", "deleting");
              }
              return store.readSession(sessionId);
            }
          };
        }
      }
    });
    await assert.rejects(racingAttachments.uploadAttachment({ sessionId: "in-flight-closing" }, {
      fileName: "race.txt",
      stream: Readable.from(["blocked"])
    }), {
      code: "vibe64_agent_attachment_session_unavailable",
      statusCode: 409,
      message: "This session is closing. Attachments cannot be added now."
    });
    assert.equal(sessionReads, 2);
    assert.deepEqual(await attachmentIds(root), []);
    assert.deepEqual(await attachmentDataPaths(root), []);
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("session cleanup leaves a slow active upload intact and succeeds after it finishes", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-slow-cleanup-test-"));
  const upload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const storing = storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "slow.txt", stream: upload },
        lockWaitMs: 25,
        sessionId: "slow-cleanup-session"
      });
      upload.write("partial");
      const partialPath = await waitForAttachmentStage(root);

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "slow-cleanup-session",
        "",
        { lockWaitMs: 25 }
      ), false);
      assert.equal(await readFile(partialPath, "utf8"), "partial");

      upload.end("-complete");
      const result = await storing;
      assert.equal(await readFile(result.path, "utf8"), "partial-complete");
      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "slow-cleanup-session",
        "",
        { lockWaitMs: 25 }
      ), true);
      await assert.rejects(() => access(result.path), { code: "ENOENT" });
      assert.deepEqual(await attachmentIds(root), []);
    });
  } finally {
    upload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("a concurrent startup sweep cannot remove an upload while it is starting", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-startup-race-test-"));
  const upload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const seed = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "seed.txt", stream: Readable.from(["seed"]) },
        sessionId: "startup-race-session"
      });
      const expiredTime = new Date(Date.now() - (31 * 60 * 1000));
      await utimes(seed.path, expiredTime, expiredTime);

      const storing = storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "starting.txt", stream: upload },
        lockWaitMs: 25,
        sessionId: "startup-race-session"
      });
      const sweeping = prepareCodexAttachmentStorage({
        env: {
          [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: root
        },
        now: Date.now() + (31 * 60 * 1000)
      });
      upload.write("still-uploading");
      const partialPath = await waitForAttachmentStage(root);
      await sweeping;

      assert.equal(await readFile(partialPath, "utf8"), "still-uploading");
      upload.end("-done");
      const result = await storing;
      assert.equal(await readFile(result.path, "utf8"), "still-uploading-done");
      await cleanupCodexAttachments(
        "/source/project",
        "startup-race-session",
        "",
        { lockWaitMs: 25 }
      );
    });
  } finally {
    upload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("session cleanup racing upload startup leaves no untracked attachment directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-session-start-race-test-"));
  const upload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const seed = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "seed.txt", stream: Readable.from(["seed"]) },
        sessionId: "session-start-race"
      });
      const storing = storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "racing.txt", stream: upload },
        lockWaitMs: 250,
        sessionId: "session-start-race"
      });
      const cleaning = cleanupCodexAttachments(
        "/source/project",
        "session-start-race",
        "",
        { lockWaitMs: 25 }
      );
      upload.write("racing");

      const cleanupResult = await cleaning;
      await waitForAttachmentStage(root);
      upload.end("-complete");
      const result = await storing;
      assert.ok(cleanupResult === true || cleanupResult === false);
      const ids = await attachmentIds(root);
      assert.equal(ids.includes(result.attachmentId), true);
      assert.equal(ids.every((id) => [seed.attachmentId, result.attachmentId].includes(id)), true);
      assert.equal(await readFile(result.path, "utf8"), "racing-complete");

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "session-start-race",
        "",
        { lockWaitMs: 250 }
      ), true);
      assert.deepEqual(await attachmentIds(root), []);
    });
  } finally {
    upload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("busy session cleanup preserves the attachment for its eventual expiry retry", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-busy-expiry-test-"));
  let holder = null;
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "expire-after-busy.txt", stream: Readable.from(["expired"]) },
        sessionId: "busy-expiry-session"
      });
      const expiredTime = new Date(Date.now() - (31 * 60 * 1000));
      await utimes(result.path, expiredTime, expiredTime);
      holder = await spawnExclusiveLockHolder(
        path.join(path.dirname(result.path), ".lease-lock"),
        root
      );

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "busy-expiry-session",
        "",
        { lockWaitMs: 25 }
      ), false);
      assert.equal(await readFile(result.path, "utf8"), "expired");
      await holder.release();

      await waitForMissing(result.path, 2_500);
      assert.deepEqual(await attachmentIds(root), []);
    });
  } finally {
    await holder?.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("strict session attachment release retries busy ownership and cannot cross namespaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-strict-release-test-"));
  let holder = null;
  try {
    await withAttachmentRoot(root, async () => {
      const owned = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "owned.txt", stream: Readable.from(["owned"]) },
        sessionId: "strict-release-session"
      });
      const sibling = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "sibling.txt", stream: Readable.from(["sibling"]) },
        sessionId: "strict-release-sibling"
      });
      holder = await spawnExclusiveLockHolder(
        path.join(path.dirname(owned.path), ".lease-lock"),
        root
      );

      await assert.rejects(
        () => releaseCodexSessionAttachments(
          "/source/project",
          "strict-release-session",
          { lockWaitMs: 25 }
        ),
        { code: "vibe64_agent_attachment_busy", retryable: true }
      );
      assert.equal(await readFile(owned.path, "utf8"), "owned");
      assert.equal(await readFile(sibling.path, "utf8"), "sibling");

      await holder.release();
      assert.deepEqual(await releaseCodexSessionAttachments(
        "/source/project",
        "strict-release-session",
        { lockWaitMs: 250 }
      ), {
        alreadyReleased: false,
        released: true
      });
      await assert.rejects(() => access(owned.path), { code: "ENOENT" });
      assert.equal(await readFile(sibling.path, "utf8"), "sibling");
      assert.deepEqual(await releaseCodexSessionAttachments(
        "/source/project",
        "strict-release-session",
        { lockWaitMs: 250 }
      ), {
        alreadyReleased: true,
        released: true
      });
    });
  } finally {
    await holder?.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("startup defers a busy session scan and expires stale data after lock release", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-deferred-scan-test-"));
  let holder = null;
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "deferred-stale.txt", stream: Readable.from(["stale"]) },
        sessionId: "deferred-scan-session"
      });
      const sessionDirectory = path.dirname(path.dirname(result.path));
      const expiredTime = new Date(Date.now() - (31 * 60 * 1000));
      await utimes(result.path, expiredTime, expiredTime);
      const sessionLockPath = await waitForOnlySessionLock(root);
      holder = await spawnExclusiveLockHolder(sessionLockPath, path.dirname(sessionLockPath));

      await prepareCodexAttachmentStorage({
        env: {
          [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: root
        },
        lockWaitMs: 25,
        now: Date.now()
      });
      assert.equal(await readFile(result.path, "utf8"), "stale");
      await holder.release();

      await waitForMissing(sessionDirectory, 2_500);
      await assert.rejects(() => access(result.path), { code: "ENOENT" });
    });
  } finally {
    await holder?.dispose();
    await rm(root, { force: true, recursive: true });
  }
});

test("session cleanup automatically retries after losing an active-upload lock race", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-cleanup-retry-test-"));
  const upload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const storing = storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "cleanup-retry.txt", stream: upload },
        lockWaitMs: 25,
        sessionId: "cleanup-retry-session"
      });
      upload.write("active");
      const partialPath = await waitForAttachmentStage(root);
      const sessionDirectory = path.dirname(path.dirname(partialPath));

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "cleanup-retry-session",
        "",
        { lockWaitMs: 25 }
      ), false);
      upload.end("-complete");
      const result = await storing;
      assert.equal(await readFile(result.path, "utf8"), "active-complete");

      await waitForMissing(sessionDirectory, 2_500);
      await assert.rejects(() => access(result.path), { code: "ENOENT" });
      assert.deepEqual(await attachmentIds(root), []);
    });
  } finally {
    upload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("deferred session cleanup removes only attachments from its original snapshot", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-cleanup-snapshot-test-"));
  const firstUpload = new PassThrough();
  try {
    await withAttachmentRoot(root, async () => {
      const storingFirst = storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "snapshot-first.txt", stream: firstUpload },
        lockWaitMs: 25,
        sessionId: "cleanup-snapshot-session"
      });
      firstUpload.write("first-active");
      await waitForAttachmentStage(root);

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "cleanup-snapshot-session",
        "",
        { lockWaitMs: 25 }
      ), false);
      const second = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "snapshot-second.txt", stream: Readable.from(["second-valid"]) },
        lockWaitMs: 25,
        sessionId: "cleanup-snapshot-session"
      });
      firstUpload.end("-complete");
      const first = await storingFirst;

      await waitForMissing(first.path, 2_500);
      assert.equal(await readFile(second.path, "utf8"), "second-valid");
      assert.deepEqual(await attachmentIds(root), [second.attachmentId]);

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "cleanup-snapshot-session",
        second.attachmentId,
        { lockWaitMs: 25 }
      ), true);
      await assert.rejects(
        () => access(path.dirname(path.dirname(second.path))),
        { code: "ENOENT" }
      );
    });
  } finally {
    firstUpload.destroy();
    await rm(root, { force: true, recursive: true });
  }
});

test("last-item DELETE prunes session data while its persistent lock remains reusable", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-last-delete-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const first = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "first.txt", stream: Readable.from(["first"]) },
        sessionId: "last-delete-session"
      });
      const sessionDirectory = path.dirname(path.dirname(first.path));
      const sessionLockPath = await waitForOnlySessionLock(root);

      assert.equal(await cleanupCodexAttachments(
        "/source/project",
        "last-delete-session",
        first.attachmentId,
        { lockWaitMs: 25 }
      ), true);
      await assert.rejects(() => access(sessionDirectory), { code: "ENOENT" });
      assert.equal((await stat(sessionLockPath)).isFile(), true);

      const second = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "second.txt", stream: Readable.from(["second"]) },
        lockWaitMs: 25,
        sessionId: "last-delete-session"
      });
      assert.equal(await readFile(second.path, "utf8"), "second");
      assert.equal(await waitForOnlySessionLock(root), sessionLockPath);
      await cleanupCodexAttachments(
        "/source/project",
        "last-delete-session",
        "",
        { lockWaitMs: 25 }
      );
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("startup removes a leftover retired-session quarantine", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-session-quarantine-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const result = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "live.txt", stream: Readable.from(["live"]) },
        sessionId: "session-quarantine-session"
      });
      const sessionDirectory = path.dirname(path.dirname(result.path));
      const projectDirectory = path.dirname(sessionDirectory);
      const quarantine = path.join(
        projectDirectory,
        `.expired-session-${path.basename(sessionDirectory)}-leftover`
      );
      await writeFileAfterMkdir(path.join(quarantine, "orphan.txt"), "orphan");

      await prepareCodexAttachmentStorage({
        env: {
          [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: root
        },
        lockWaitMs: 25
      });

      await assert.rejects(() => access(quarantine), { code: "ENOENT" });
      assert.equal(await readFile(result.path, "utf8"), "live");
      await cleanupCodexAttachments(
        "/source/project",
        "session-quarantine-session",
        "",
        { lockWaitMs: 25 }
      );
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("attachment admission runs under the session lock and rejection creates no data directory", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-before-create-test-"));
  let enterAdmission;
  let rejectAdmission;
  const admissionEntered = new Promise((resolve) => {
    enterAdmission = resolve;
  });
  const admission = new Promise((_, reject) => {
    rejectAdmission = reject;
  });
  try {
    await withAttachmentRoot(root, async () => {
      const storing = storeCodexAttachment({
        beforeCreate: async () => {
          enterAdmission();
          await admission;
        },
        executionRoot: "/source/project",
        input: { fileName: "rejected.txt", stream: Readable.from(["rejected"]) },
        lockWaitMs: 25,
        sessionId: "before-create-session"
      });
      const rejected = assert.rejects(storing, {
        code: "vibe64_test_attachment_admission_rejected",
        message: "Attachment admission was rejected."
      });
      await admissionEntered;
      const sessionLockPath = await waitForOnlySessionLock(root);

      assert.equal(await tryAcquireExclusiveFileLock(sessionLockPath, {
        cwd: path.dirname(sessionLockPath)
      }), null);
      rejectAdmission(Object.assign(new Error("Attachment admission was rejected."), {
        code: "vibe64_test_attachment_admission_rejected"
      }));
      await rejected;
      await assert.rejects(() => access(path.join(root, "files")), { code: "ENOENT" });

      const release = await tryAcquireExclusiveFileLock(sessionLockPath, {
        cwd: path.dirname(sessionLockPath)
      });
      assert.equal(typeof release, "function");
      await release();
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("restart preparation expires stale stages and files without deleting another live process upload", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-restart-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const expired = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "expired.txt", stream: Readable.from(["old"]) },
        sessionId: "restart-session"
      });
      const live = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "live.txt", stream: Readable.from(["live"]) },
        sessionId: "restart-session"
      });
      const expiredTime = new Date(Date.now() - (31 * 60 * 1000));
      await utimes(expired.path, expiredTime, expiredTime);
      const sessionDirectory = path.dirname(path.dirname(live.path));
      const staleStageDirectory = path.join(sessionDirectory, "11111111-1111-4111-8111-111111111111");
      const liveStageDirectory = path.join(sessionDirectory, "22222222-2222-4222-8222-222222222222");
      const staleStagePath = path.join(staleStageDirectory, ".uploading-interrupted");
      const liveStagePath = path.join(liveStageDirectory, ".uploading-active");
      await writeFileAfterMkdir(staleStagePath, "stale partial");
      await writeFileAfterMkdir(liveStagePath, "live partial");
      await utimes(staleStagePath, expiredTime, expiredTime);

      await prepareCodexAttachmentStorage({
        env: {
          [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: root
        }
      });

      await assert.rejects(() => access(expired.path), { code: "ENOENT" });
      await assert.rejects(() => access(staleStageDirectory), { code: "ENOENT" });
      assert.equal(await readFile(liveStagePath, "utf8"), "live partial");
      assert.equal(await readFile(live.path, "utf8"), "live");
      await cleanupCodexAttachments("/source/project", "restart-session");
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("attachment cleanup is idempotent and cannot cross session namespaces", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-session-isolation-test-"));
  try {
    await withAttachmentRoot(root, async () => {
      const first = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "first.txt", stream: Readable.from(["first"]) },
        sessionId: "session-first"
      });
      const second = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "second.txt", stream: Readable.from(["second"]) },
        sessionId: "session-second"
      });

      await cleanupCodexAttachments("/source/project", "session-first", first.attachmentId);
      await cleanupCodexAttachments("/source/project", "session-first", first.attachmentId);

      await assert.rejects(() => access(first.path), { code: "ENOENT" });
      assert.equal(await readFile(second.path, "utf8"), "second");
      await cleanupCodexAttachments("/source/project", "session-second");
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("the exact decimal 100 MB boundary succeeds and one extra byte is rejected", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-decimal-limit-test-"));
  const oneMegabyte = Buffer.alloc(1_000_000, 0x61);
  function decimalUpload(extraByte = false) {
    return Readable.from((function *attachmentChunks() {
      for (let index = 0; index < 100; index += 1) {
        yield oneMegabyte;
      }
      if (extraByte) {
        yield Buffer.from([0x62]);
      }
    })());
  }
  try {
    await withAttachmentRoot(root, async () => {
      assert.equal(CODEX_ATTACHMENT_MAX_BYTES, 100_000_000);
      const accepted = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "exact.bin", stream: decimalUpload() },
        sessionId: "exact-limit"
      });
      const rejected = await storeCodexAttachment({
        executionRoot: "/source/project",
        input: { fileName: "too-large.bin", stream: decimalUpload(true) },
        sessionId: "over-limit"
      });

      assert.equal(accepted.ok, true);
      assert.equal(accepted.size, 100_000_000);
      assert.equal((await stat(accepted.path)).size, 100_000_000);
      assert.equal(rejected.ok, false);
      assert.equal(rejected.code, "vibe64_agent_attachment_too_large");
      assert.match(rejected.error, /100 MB/u);
      assert.deepEqual((await attachmentFiles(root)).filter((name) => name.includes("uploading")), []);
      await cleanupCodexAttachments("/source/project", "exact-limit");
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

test("Codex attachment root is process-owned and isolates files from sibling state", async () => {
  const root = codexAttachmentHostRoot({ env: {} });
  assert.equal(root.endsWith(path.join("vibe64", "attachments")), false);
  assert.equal(path.basename(root), "attachments");
  assert.match(path.basename(path.dirname(root)), /^vibe64-/u);

  const configuredRoot = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-root-test-"));
  const attachmentRoot = path.join(configuredRoot, "owner", "state", "attachments");
  try {
    const env = { [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot };
    assert.equal(codexAttachmentHostRoot({ env }), attachmentRoot);
    await prepareCodexAttachmentRoot({ env });
    await access(attachmentRoot);
    await writeFile(path.join(attachmentRoot, "codex-git-command"), "owned elsewhere");
    await prepareCodexAttachmentStorage({ env });
    assert.equal(await readFile(path.join(attachmentRoot, "codex-git-command"), "utf8"), "owned elsewhere");
  } finally {
    await rm(configuredRoot, { force: true, recursive: true });
  }
});

test("Codex attachment namespace follows project identity instead of its absolute path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-scope-test-"));
  const sessionId = "attachment-scope-session";
  const oldProjectsRoot = path.join(root, "old-root");
  const newProjectsRoot = path.join(root, "new-root");
  const oldTargetRoot = path.join(oldProjectsRoot, "beepollen");
  const newTargetRoot = path.join(newProjectsRoot, "beepollen");
  try {
    await withAttachmentRoot(root, async () => {
      const oldResult = await runWithProjectRequestContext({
        projectsRoot: oldProjectsRoot,
        slug: "beepollen",
        targetRoot: oldTargetRoot
      }, () => storeCodexAttachment({
        executionRoot: oldTargetRoot,
        input: { fileName: "old.txt", stream: Readable.from(["hello"]) },
        sessionId
      }));
      const newResult = await runWithProjectRequestContext({
        projectsRoot: newProjectsRoot,
        slug: "beepollen",
        targetRoot: newTargetRoot
      }, () => storeCodexAttachment({
        executionRoot: newTargetRoot,
        input: { fileName: "new.txt", stream: Readable.from(["hello"]) },
        sessionId
      }));

      assert.equal(path.dirname(path.dirname(oldResult.path)), path.dirname(path.dirname(newResult.path)));
      await cleanupCodexAttachments(oldTargetRoot, sessionId);
    });
  } finally {
    await rm(root, { force: true, recursive: true });
  }
});

async function withAttachmentRoot(root, operation) {
  const previous = process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
  process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = root;
  try {
    return await operation();
  } finally {
    if (previous == null) {
      delete process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV];
    } else {
      process.env[VIBE64_CODEX_ATTACHMENTS_ROOT_ENV] = previous;
    }
  }
}

async function attachmentFiles(root) {
  const files = [];
  async function visit(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name !== ".lease-lock") {
        files.push(entry.name);
      }
    }
  }
  await visit(path.join(root, "files"));
  return files.sort();
}

async function waitForOnlyAttachmentFile(root) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const files = await attachmentFiles(root);
    if (files.length === 1) {
      return files[0];
    }
    await new Promise((resolve) => setTimeout(resolve, 5));
  }
  assert.fail("Attachment partial file was not created.");
}

async function fileMtime(filePath) {
  return (await stat(filePath)).mtimeMs;
}

async function writeFileAfterMkdir(filePath, contents) {
  await mkdir(path.dirname(filePath), { recursive: true });
  await writeFile(filePath, contents);
}

async function waitForOutput(readOutput, expected) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    if (readOutput().includes(expected)) {
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  assert.fail(`Timed out waiting for child-process output: ${expected}`);
}

async function spawnExclusiveLockHolder(lockPath, cwd) {
  const moduleUrl = new URL(
    "../../packages/vibe64-execution/src/server/engines/fileLock.js",
    import.meta.url
  ).href;
  const script = `
    import { tryAcquireExclusiveFileLock } from ${JSON.stringify(moduleUrl)};
    const release = await tryAcquireExclusiveFileLock(process.env.ATTACHMENT_LOCK_PATH, {
      cwd: process.env.ATTACHMENT_LOCK_CWD
    });
    if (!release) {
      throw new Error("Child process could not acquire the attachment lock.");
    }
    process.stdout.write("READY\\n");
    process.stdin.once("data", async () => {
      await release();
      process.stdout.write("RELEASED\\n");
    });
    process.stdin.resume();
  `;
  const child = spawn(process.execPath, ["--input-type=module", "--eval", script], {
    env: {
      ...process.env,
      ATTACHMENT_LOCK_CWD: cwd,
      ATTACHMENT_LOCK_PATH: lockPath
    },
    stdio: ["pipe", "pipe", "pipe"]
  });
  let closed = false;
  let output = "";
  let errors = "";
  let releaseStarted = false;
  const exited = once(child, "exit");
  child.stdout.setEncoding("utf8");
  child.stderr.setEncoding("utf8");
  child.stdout.on("data", (chunk) => {
    output += chunk;
  });
  child.stderr.on("data", (chunk) => {
    errors += chunk;
  });
  child.once("exit", () => {
    closed = true;
  });
  try {
    await waitForOutput(() => output, "READY");
  } catch (error) {
    child.kill("SIGKILL");
    await exited.catch(() => null);
    throw new Error(`${error.message}${errors ? `\n${errors}` : ""}`);
  }

  return {
    async dispose() {
      if (closed) {
        return;
      }
      child.kill("SIGKILL");
      await exited.catch(() => null);
    },
    async kill() {
      if (closed) {
        return;
      }
      child.kill("SIGKILL");
      const [code, signal] = await exited;
      assert.equal(code, null, errors);
      assert.equal(signal, "SIGKILL", errors);
    },
    async release() {
      if (closed || releaseStarted) {
        return;
      }
      releaseStarted = true;
      child.stdin.end("release\n");
      await waitForOutput(() => output, "RELEASED");
      const [code, signal] = await exited;
      assert.equal(code, 0, errors);
      assert.equal(signal, null, errors);
    }
  };
}

async function attachmentDataPaths(root) {
  const files = [];
  async function visit(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) {
        await visit(entryPath);
      } else if (entry.name !== ".lease-lock") {
        files.push(entryPath);
      }
    }
  }
  await visit(path.join(root, "files"));
  return files.sort();
}

async function attachmentIds(root) {
  const ids = [];
  const attachmentIdPattern = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
  async function visit(directory) {
    let entries = [];
    try {
      entries = await readdir(directory, { withFileTypes: true });
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    for (const entry of entries) {
      if (!entry.isDirectory()) {
        continue;
      }
      if (attachmentIdPattern.test(entry.name)) {
        ids.push(entry.name);
      } else {
        await visit(path.join(directory, entry.name));
      }
    }
  }
  await visit(path.join(root, "files"));
  return ids.sort();
}

async function waitForAttachmentStage(root) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const stage = (await attachmentDataPaths(root)).find((filePath) => (
      path.basename(filePath).startsWith(".uploading-")
    ));
    if (stage) {
      return stage;
    }
    await delay(5);
  }
  assert.fail("Attachment partial file was not created.");
}

async function waitForOnlySessionLock(root) {
  for (let attempt = 0; attempt < 200; attempt += 1) {
    const lockPaths = [];
    async function visit(directory) {
      let entries = [];
      try {
        entries = await readdir(directory, { withFileTypes: true });
      } catch (error) {
        if (error?.code === "ENOENT") {
          return;
        }
        throw error;
      }
      for (const entry of entries) {
        const entryPath = path.join(directory, entry.name);
        if (entry.isDirectory()) {
          await visit(entryPath);
        } else if (entry.name.endsWith(".lock")) {
          lockPaths.push(entryPath);
        }
      }
    }
    await visit(path.join(root, "locks"));
    if (lockPaths.length === 1) {
      return lockPaths[0];
    }
    await delay(5);
  }
  assert.fail("Expected exactly one persistent attachment session lock.");
}

async function waitForMissing(filePath, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    try {
      await access(filePath);
    } catch (error) {
      if (error?.code === "ENOENT") {
        return;
      }
      throw error;
    }
    await delay(20);
  }
  assert.fail(`Timed out waiting for attachment cleanup: ${filePath}`);
}

function delay(timeoutMs) {
  return new Promise((resolve) => setTimeout(resolve, timeoutMs));
}

function explicitProjectContext(targetRoot) {
  return {
    projectCatalogEnabled: false,
    selectedProject: { slug: "project" },
    selectionSource: "explicit",
    targetRoot
  };
}

function testReply() {
  return {
    body: null,
    statusCode: 200,
    code(statusCode) {
      this.statusCode = statusCode;
      return this;
    },
    send(body) {
      this.body = body;
      return this;
    }
  };
}

function testApp() {
  const registeredRoutes = [];
  const registeredWebSocketRoutes = [];
  return {
    fastify: {
      get(routePath, options, handler) {
        registeredWebSocketRoutes.push({ handler, options, path: routePath });
      }
    },
    http: {
      router: {
        register(method, routePath, options, handler) {
          registeredRoutes.push({ handler, method, options, path: routePath });
        }
      }
    },
    registeredRoutes,
    registeredWebSocketRoutes,
    terminals: {}
  };
}

async function realAttachmentRouteHarness(root) {
  const captured = testApp();
  const fastify = Fastify();
  const actions = [];
  let uploadAction = async (action) => {
    let size = 0;
    for await (const chunk of action.input.stream) {
      size += chunk.length;
    }
    return {
      attachmentId: "11111111-1111-4111-8111-111111111111",
      ok: true,
      size
    };
  };

  registerRoutes(captured.http, {
    fastify: captured.fastify,
    projectContext: explicitProjectContext(root),
    terminals: captured.terminals,
    uploads: { readSingleMultipartFile() {} }
  });
  const attachmentRoute = captured.registeredRoutes.find((route) => {
    return route.method === "POST" && route.path.endsWith("/sessions/:sessionId/agent-attachments");
  });
  assert.ok(attachmentRoute);

  await registerMultipartSupport(fastify);
  fastify.route({
    bodyLimit: attachmentRoute.options.bodyLimit,
    method: attachmentRoute.method,
    url: attachmentRoute.path,
    async handler(request, reply) {
      request.executeAction = async (action) => {
        actions.push(action);
        if (action.actionId === "vibe64.terminals.agent-attachment.delete") {
          return { ok: true };
        }
        return uploadAction(action);
      };
      return attachmentRoute.handler(request, reply);
    }
  });
  await fastify.ready();

  return {
    actions,
    async close() {
      await fastify.close();
    },
    fastify,
    setUploadAction(action) {
      uploadAction = action;
    },
    url: attachmentRoute.path
      .replace(":slug", "project")
      .replace(":sessionId", "session-1")
  };
}

async function injectRealMultipart(harness, parts, timeoutMs = 2_000) {
  const payload = multipartPayload(parts);
  return settleWithin(harness.fastify.inject({
    headers: { "content-type": payload.contentType },
    method: "POST",
    payload: payload.body,
    url: harness.url
  }), timeoutMs, "Multipart request did not settle after its file stream was drained.");
}

async function settleWithin(promise, timeoutMs, message) {
  let timeout = null;
  try {
    return await Promise.race([
      promise,
      new Promise((resolve, reject) => {
        timeout = setTimeout(() => reject(new Error(message)), timeoutMs);
      })
    ]);
  } finally {
    clearTimeout(timeout);
  }
}

function streamingBoundaryMultipartPayload({ extraByte = false } = {}) {
  const boundary = `----vibe64-boundary-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const megabyte = Buffer.alloc(1_000_000, 0x61);
  const body = Readable.from((function *multipartChunks() {
    yield Buffer.from(
      `--${boundary}\r\n` +
      "Content-Disposition: form-data; name=\"file\"; filename=\"boundary.bin\"\r\n" +
      "Content-Type: application/octet-stream\r\n\r\n"
    );
    for (let index = 0; index < 100; index += 1) {
      yield megabyte;
    }
    if (extraByte) {
      yield Buffer.from([0x62]);
    }
    yield Buffer.from(`\r\n--${boundary}--\r\n`);
  })());
  return {
    body,
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}

function multipartPayload(parts) {
  const boundary = `----vibe64-${Date.now()}-${Math.random().toString(16).slice(2)}`;
  const chunks = [];
  for (const part of parts) {
    chunks.push(Buffer.from(`--${boundary}\r\n`));
    if (part.fileName) {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"; filename="${part.fileName}"\r\n` +
        `Content-Type: ${part.contentType || "application/octet-stream"}\r\n\r\n`
      ));
    } else {
      chunks.push(Buffer.from(
        `Content-Disposition: form-data; name="${part.name}"\r\n\r\n`
      ));
    }
    chunks.push(Buffer.isBuffer(part.contents) ? part.contents : Buffer.from(String(part.contents || "")));
    chunks.push(Buffer.from("\r\n"));
  }
  chunks.push(Buffer.from(`--${boundary}--\r\n`));
  return {
    body: Buffer.concat(chunks),
    contentType: `multipart/form-data; boundary=${boundary}`
  };
}


test("attachment download route streams bytes and restricts inline previews to raster images", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-download-"));
  const app = testApp();
  const fastify = Fastify();
  const calls = [];
  await writeFile(path.join(root, "content"), "downloaded bytes");
  app.terminals.readAgentAttachment = async (sessionId, attachmentId) => {
    calls.push({ sessionId, attachmentId });
    return {
      attachment: { contentType: attachmentId === "raster" ? "image/png" : "application/octet-stream", fileName: attachmentId === "raster" ? "image.png" : "unsafe.svg" },
      fileHandle: await open(path.join(root, "content"), "r")
    };
  };
  registerRoutes(app.http, { fastify: app.fastify, projectContext: explicitProjectContext(root), terminals: app.terminals, uploads: { readSingleMultipartFile() {} } });
  const actions = createActionCatalogue();
  actions.register({ contributorId: "terminals", domain: "terminals", actions: createTerminalActions({ terminals: app.terminals }).map((action) => ({
    channels: ["api"], surfaces: ["app"], ...action
  })) });
  registerVibe64ActionContext(actions, { projectContext: explicitProjectContext(root),
    resolveUser: async () => ({ username: "owner", role: "owner" }), authorizeProject: async () => {}
  });
  fastify.addHook("onRequest", async (request) => {
    request.executeAction = ({ actionId, input }) => actions.execute({ actionId, input,
      context: { channel: "api", surface: "app", requestMeta: { request } } });
  });
  const route = app.registeredRoutes.find((candidate) => candidate.method === "GET" && candidate.path.endsWith("/agent-attachments/:attachmentId"));
  fastify.route({ method: "GET", url: route.path, handler: route.handler });
  try {
    for (const attachmentId of ["raster", "document"]) {
      for (const query of ["", "?inline=1"]) {
        const response = await fastify.inject({ method: "GET", url: route.path.replace(":slug", "project").replace(":sessionId", "one").replace(":attachmentId", attachmentId) + query });
        assert.equal(response.statusCode, 200);
        assert.equal(response.body, "downloaded bytes");
        assert.equal(response.headers["x-content-type-options"], "nosniff");
        assert.equal(response.headers["cache-control"], "private, no-store");
        assert.match(response.headers["content-security-policy"], /sandbox/u);
        assert.match(response.headers["content-disposition"], attachmentId === "raster" && query ? /^inline$/u : /^attachment;/u);
      }
    }
    assert.deepEqual(calls.map((call) => call.sessionId), ["one", "one", "one", "one"]);
  } finally {
    await fastify.close();
    await rm(root, { recursive: true, force: true });
  }
});
