import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";

import {
  CODEX_ATTACHMENT_UPLOAD_BODY_LIMIT_BYTES,
  cleanupCodexAttachments,
  storeCodexAttachment
} from "../../packages/vibe64-terminals/src/server/codexAttachments.js";
import {
  registerRoutes
} from "../../packages/vibe64-terminals/src/server/registerRoutes.js";

test("Codex attachment route opts into the attachment upload body limit", () => {
  const app = testApp();

  registerRoutes(app);

  const attachmentRoute = app.registeredRoutes.find((route) => {
    return route.method === "POST" && route.path.endsWith("/sessions/:sessionId/codex-attachments");
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
