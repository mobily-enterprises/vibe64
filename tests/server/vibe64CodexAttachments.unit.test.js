import assert from "node:assert/strict";
import { access, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
  cleanupCodexAttachments,
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
import {
  runWithProjectRequestContext
} from "../../packages/vibe64-core/src/server/projectRequestContext.js";

test("assistant attachment route opts into the attachment upload body limit", () => {
  const app = testApp();

  registerRoutes(app);

  const attachmentRoute = app.registeredRoutes.find((route) => {
    return route.method === "POST" && route.path.endsWith("/sessions/:sessionId/agent-attachments");
  });

  assert.ok(attachmentRoute);
  assert.equal(attachmentRoute.options.bodyLimit, CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES);
});

test("Codex attachments are not rejected by the old 25 MB product cap", async () => {
  const targetRoot = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-test-"));
  try {
    const sessionId = "large-attachment-session";
    const previousLimitBytes = 25 * 1024 * 1024;
    const data = Buffer.alloc(previousLimitBytes + 1, "a");

    const result = await storeCodexAttachment({
      input: {
        contentType: "application/octet-stream",
        dataBase64: data.toString("base64"),
        fileName: "large.bin"
      },
      sessionId,
      targetRoot
    });

    try {
      assert.equal(result.ok, true);
      assert.equal(result.size, data.length);
      assert.equal(result.fileName, "large.bin");
    } finally {
      await cleanupCodexAttachments(targetRoot, sessionId, result.attachmentId);
    }
  } finally {
    await rm(targetRoot, {
      force: true,
      recursive: true
    });
  }
});

test("Codex attachment root defaults to a process-owned temp directory", () => {
  const root = codexAttachmentHostRoot({
    env: {}
  });

  assert.equal(root.endsWith(path.join("vibe64", "attachments")), false);
  assert.equal(path.basename(root), "attachments");
  assert.match(path.basename(path.dirname(root)), /^vibe64-/u);
});

test("Codex attachment root can be set by runtime environment", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-root-test-"));
  const attachmentRoot = path.join(root, "owner", "state", "attachments");
  try {
    const env = {
      [VIBE64_CODEX_ATTACHMENTS_ROOT_ENV]: attachmentRoot
    };
    assert.equal(codexAttachmentHostRoot({ env }), attachmentRoot);

    await prepareCodexAttachmentRoot({ env });
    await access(attachmentRoot);
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

test("Codex attachment namespace follows the project slug instead of the absolute path", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "vibe64-attachment-scope-test-"));
  const sessionId = "attachment-scope-session";
  const dataBase64 = Buffer.from("hello").toString("base64");
  const oldProjectsRoot = path.join(root, "old-root");
  const newProjectsRoot = path.join(root, "new-root");
  const oldTargetRoot = path.join(oldProjectsRoot, "beepollen");
  const newTargetRoot = path.join(newProjectsRoot, "beepollen");
  try {
    const oldResult = await runWithProjectRequestContext({
      projectsRoot: oldProjectsRoot,
      slug: "beepollen",
      targetRoot: oldTargetRoot
    }, () => storeCodexAttachment({
      input: {
        dataBase64,
        fileName: "old.txt"
      },
      sessionId,
      targetRoot: oldTargetRoot
    }));
    const newResult = await runWithProjectRequestContext({
      projectsRoot: newProjectsRoot,
      slug: "beepollen",
      targetRoot: newTargetRoot
    }, () => storeCodexAttachment({
      input: {
        dataBase64,
        fileName: "new.txt"
      },
      sessionId,
      targetRoot: newTargetRoot
    }));

    try {
      assert.equal(oldResult.ok, true);
      assert.equal(newResult.ok, true);
      assert.equal(
        path.dirname(path.dirname(oldResult.path)),
        path.dirname(path.dirname(newResult.path))
      );
    } finally {
      await cleanupCodexAttachments(oldTargetRoot, sessionId, oldResult.attachmentId);
      await cleanupCodexAttachments(newTargetRoot, sessionId, newResult.attachmentId);
    }
  } finally {
    await rm(root, {
      force: true,
      recursive: true
    });
  }
});

function testApp() {
  const registeredRoutes = [];
  const registeredWebSocketRoutes = [];
  const fastify = {
    get(path, options, handler) {
      registeredWebSocketRoutes.push({
        handler,
        options,
        path
      });
    }
  };
  return {
    registeredRoutes,
    registeredWebSocketRoutes,
    make(token) {
      if (token === "jskit.fastify") {
        return fastify;
      }
      assert.equal(token, "jskit.http.router");
      return {
        register(method, path, options, handler) {
          registeredRoutes.push({
            handler,
            method,
            options,
            path
          });
        }
      };
    }
  };
}
