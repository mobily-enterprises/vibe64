import { constants } from "node:fs";
import { copyFile, mkdir, open, readFile, readdir, rename, rm, utimes, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import {
  conversationAttachmentContentType,
  conversationAttachmentReference,
  normalizeVibe64ConversationAttachments
} from "@local/vibe64-runtime/shared";
import { terminalSessionSourceRoot } from "./terminalShared.js";
import { sessionIsClosing } from "@local/vibe64-runtime/server/sessionLifecycle";
import { vibe64SessionStatusIsOpen } from "@local/vibe64-runtime/server/sessionStore";
import {
  cleanupCodexAttachments as cleanupUploads,
  pinCodexAttachments as pinUploads,
  storeCodexAttachment as storeUpload,
  unpinCodexAttachments as unpinUploads,
  withUploadedAgentAttachment
} from "./codexAttachments.js";

function attachmentDirectory(paths, id) {
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(id)) {
    throw Object.assign(new Error("Attachment id is invalid."), { statusCode: 400 });
  }
  return path.join(paths.artifactsRoot, "attachments", id);
}

async function readSavedAttachment(paths, id) {
  const directory = attachmentDirectory(paths, id);
  let record;
  try {
    record = JSON.parse(await readFile(path.join(directory, "attachment.json"), "utf8"));
  } catch (error) {
    if (error.code === "ENOENT") return null;
    throw error;
  }
  const [attachment] = normalizeVibe64ConversationAttachments([record]);
  if (!attachment || attachment.attachmentId !== id || path.basename(attachment.fileName) !== attachment.fileName) {
    throw new Error("The saved attachment record is invalid.");
  }
  return {
    ...attachment,
    conversationId: record.conversationId || "",
    contentType: conversationAttachmentContentType(attachment.fileName),
    path: path.join(directory, "file")
  };
}

function createSessionAttachments({ projectService, env = process.env }) {
  async function attachmentContext(context) {
    const runtime = context.runtime || await projectService.createRuntime({ inspectSource: false });
    const session = context.session || await runtime.getSession(context.sessionId, { inspectSource: false });
    const executionRoot = terminalSessionSourceRoot(session);
    if (!executionRoot) throw new Error("The attachment session source is unavailable.");
    return { runtime, session, executionRoot, sessionId: context.sessionId };
  }

  async function retainAttachment(context, id, conversationId) {
    const { runtime, executionRoot, sessionId } = context;
    return runtime.store.mutateSession(sessionId, async (paths) => {
      const saved = await readSavedAttachment(paths, id);
      if (saved) {
        if (saved.conversationId !== conversationId) throw new Error("This attachment belongs to another conversation.");
        return saved;
      }
      return withUploadedAgentAttachment(executionRoot, sessionId, id, async (upload) => {
        const directory = attachmentDirectory(paths, id);
        const staging = `${directory}.preparing-${randomUUID()}`;
        await mkdir(staging, { recursive: true, mode: 0o770 });
        try {
          await copyFile(upload.path, path.join(staging, "file"));
          const [record] = normalizeVibe64ConversationAttachments([upload]);
          await writeFile(path.join(staging, "attachment.json"), JSON.stringify({ ...record, conversationId }), { mode: 0o660 });
          await rename(staging, directory);
        } finally {
          await rm(staging, { force: true, recursive: true });
        }
        return readSavedAttachment(paths, id);
      }, { env });
    });
  }

  return {
    async uploadAttachment(context, input) {
      const { executionRoot, runtime, sessionId } = await attachmentContext(context);
      return storeUpload({ executionRoot, sessionId, input, env, beforeCreate: async () => {
        const session = await runtime.getSession(sessionId, { inspectSource: false });
        if (sessionIsClosing(session) || !vibe64SessionStatusIsOpen(session.status)) {
          throw Object.assign(new Error("This session is closing. Attachments cannot be added now."), {
            code: "vibe64_agent_attachment_session_unavailable", statusCode: 409
          });
        }
      } });
    },
    async deleteAttachment(context, input) {
      const { executionRoot, runtime, sessionId } = await attachmentContext(context);
      const saved = await runtime.store.withReadableSessionPaths(sessionId, (paths) => readSavedAttachment(paths, input.attachmentId));
      if (saved) {
        return { ok: false, statusCode: 409, code: "vibe64_agent_attachment_retained", error: "Sent attachments stay with the conversation." };
      }
      await cleanupUploads(executionRoot, sessionId, input.attachmentId, { env });
      return { ok: true, attachmentId: input.attachmentId };
    },
    async pinAttachments(context, input) {
      const { executionRoot, sessionId } = await attachmentContext(context);
      return { ok: true, ...await pinUploads(executionRoot, sessionId, input.attachmentIds, input.suggestionId, { env }) };
    },
    async unpinAttachments(context, input) {
      const { executionRoot, sessionId } = await attachmentContext(context);
      return { ok: true, ...await unpinUploads(executionRoot, sessionId, input.attachmentIds, input.suggestionId, { env }) };
    },
    async prepareMessage(context, input, { durable = true, conversationId = "" } = {}) {
      const ids = [...new Set(Array.isArray(input.attachmentIds) ? input.attachmentIds : [])];
      if (ids.length > 10) throw Object.assign(new Error("A message can include at most 10 attachments."), { statusCode: 400 });
      const attachments = [];
      if (ids.length) {
        const resolved = await attachmentContext(context);
        for (const id of ids) {
          if (durable) {
            attachments.push(await retainAttachment(resolved, id, conversationId));
          } else {
            attachments.push(await withUploadedAgentAttachment(resolved.executionRoot, resolved.sessionId, id, async (upload) => {
              const now = new Date();
              await utimes(upload.path, now, now);
              return upload;
            }, { env }));
          }
        }
      }
      let imageNumber = 0;
      let fileNumber = 0;
      for (const attachment of attachments) {
        attachment.contentType = conversationAttachmentContentType(attachment.fileName);
        const number = attachment.contentType.startsWith("image/") ? ++imageNumber : ++fileNumber;
        attachment.reference = conversationAttachmentReference(attachment, number);
      }
      const references = attachments.map((attachment) => `${attachment.reference} ${JSON.stringify(attachment.fileName)}: ${JSON.stringify(attachment.path)}`);
      const message = String(input.message ?? input.prompt ?? "");
      return {
        ...input,
        attachments,
        displayAttachments: normalizeVibe64ConversationAttachments(attachments),
        ...(attachments.length ? {
          displayMessage: input.displayMessage ?? message,
          message: `${message}\n\nAttached files:\n${references.join("\n")}`
        } : {})
      };
    },
    async deleteConversationAttachments(context, { conversationId }) {
      const { runtime, executionRoot, sessionId } = await attachmentContext(context);
      await runtime.store.mutateSession(sessionId, async (paths) => {
        let entries;
        try {
          entries = await readdir(path.join(paths.artifactsRoot, "attachments"), { withFileTypes: true });
        } catch (error) {
          if (error.code === "ENOENT") return;
          throw error;
        }
        for (const entry of entries) {
          if (!entry.isDirectory() || entry.name.includes(".")) continue;
          const saved = await readSavedAttachment(paths, entry.name);
          if (saved?.conversationId !== conversationId) continue;
          // Retain the ownership record until uploaded-file cleanup also succeeds.
          await cleanupUploads(executionRoot, sessionId, entry.name, { env });
          await rm(attachmentDirectory(paths, entry.name), { recursive: true, force: true });
        }
      });
    },
    async readAttachment(context, id) {
      const { sessionId } = context;
      const runtime = context.runtime || await projectService.createRuntime({ inspectSource: false });
      const session = context.session || await runtime.getSession(sessionId, { inspectSource: false });
      const openAttachment = async (attachment) => ({
        attachment: { ...attachment, contentType: conversationAttachmentContentType(attachment.fileName) },
        fileHandle: await open(attachment.path, constants.O_RDONLY | constants.O_NOFOLLOW)
      });
      return runtime.store.withReadableSessionPaths(sessionId, async (paths) => {
        const saved = await readSavedAttachment(paths, id);
        if (!saved) {
          const executionRoot = terminalSessionSourceRoot(session);
          if (!executionRoot || !vibe64SessionStatusIsOpen(session.status)) {
            throw Object.assign(new Error("This session has no such attachment."), { statusCode: 404 });
          }
          return withUploadedAgentAttachment(executionRoot, sessionId, id, openAttachment, { env });
        }
        try {
          return await openAttachment(saved);
        } catch (error) {
          if (error.code === "ENOENT" && !vibe64SessionStatusIsOpen(session.status)) {
            throw Object.assign(new Error("This attachment is no longer retained. Its description remains in the chat."), {
              code: "vibe64_agent_attachment_expired", statusCode: 410
            });
          }
          throw error;
        }
      });
    }
  };
}

export { createSessionAttachments };
