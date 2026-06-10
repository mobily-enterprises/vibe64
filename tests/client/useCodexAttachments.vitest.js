import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
  attachmentPathForTerminal
} from "../../src/composables/useCodexTerminalAttachments.js";
import {
  codexAttachmentEventHasFiles,
  codexAttachmentFiles,
  useCodexAttachments
} from "../../src/composables/useCodexAttachments.js";

function testFile(name, size = 1) {
  return {
    name,
    size
  };
}

describe("useCodexAttachments", () => {
  it("shares file filtering for drag, picker, and terminal uploads", () => {
    const files = codexAttachmentFiles([
      testFile("valid.txt"),
      null,
      {
        name: "invalid"
      }
    ]);

    expect(files).toEqual([testFile("valid.txt")]);
    expect(codexAttachmentEventHasFiles({
      dataTransfer: {
        files: [],
        types: ["Files"]
      }
    })).toBe(true);
  });

  it("uploads files once and reports the uploaded attachment records", async () => {
    const onUploaded = vi.fn();
    const uploadAttachment = vi.fn(async (sessionId, file) => ({
      ok: true,
      attachmentId: file.name,
      containerPath: `/studio-attachments/${sessionId}/${file.name}`,
      fileName: file.name,
      size: file.size
    }));
    const attachments = useCodexAttachments({
      onUploaded,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const uploaded = await attachments.uploadFiles([
      testFile("one.txt", 12),
      testFile("two.txt", 34)
    ]);

    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenNthCalledWith(1, "session-1", testFile("one.txt", 12));
    expect(uploadAttachment).toHaveBeenNthCalledWith(2, "session-1", testFile("two.txt", 34));
    expect(uploaded.map((attachment) => attachment.fileName)).toEqual(["one.txt", "two.txt"]);
    expect(attachments.attachments.value.map((attachment) => attachment.fileName)).toEqual(["one.txt", "two.txt"]);
    expect(onUploaded).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledWith(uploaded);
  });

  it("removes uploaded attachment records by id", async () => {
    const attachments = useCodexAttachments({
      sessionId: ref("session-1"),
      uploadAttachment: async (_sessionId, file) => ({
        ok: true,
        attachmentId: file.name,
        containerPath: `/studio-attachments/session-1/${file.name}`,
        fileName: file.name,
        size: file.size
      })
    });

    await attachments.uploadFiles([
      testFile("one.txt"),
      testFile("two.txt")
    ]);

    expect(attachments.removeAttachment({
      attachmentId: "one.txt"
    }).map((attachment) => attachment.fileName)).toEqual(["one.txt"]);
    expect(attachments.attachments.value.map((attachment) => attachment.fileName)).toEqual(["two.txt"]);
  });

  it("clears uploaded attachment records after a prompt is accepted", async () => {
    const attachments = useCodexAttachments({
      sessionId: ref("session-1"),
      uploadAttachment: async (_sessionId, file) => ({
        ok: true,
        attachmentId: file.name,
        containerPath: `/studio-attachments/session-1/${file.name}`,
        fileName: file.name,
        size: file.size
      })
    });

    await attachments.uploadFiles([
      testFile("one.txt"),
      testFile("two.txt")
    ]);

    expect(attachments.clearAttachments().map((attachment) => attachment.fileName)).toEqual(["one.txt", "two.txt"]);
    expect(attachments.attachments.value).toEqual([]);
  });

  it("respects a caller-provided upload gate", async () => {
    const uploadAttachment = vi.fn();
    const attachments = useCodexAttachments({
      canUpload: () => false,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    expect(await attachments.uploadFiles([testFile("blocked.txt")])).toEqual([]);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("clears the busy flag when a consumer cannot use the uploaded file", async () => {
    const attachments = useCodexAttachments({
      onUploaded: async () => {
        throw new Error("Codex path could not be injected.");
      },
      sessionId: ref("session-1"),
      uploadAttachment: async (_sessionId, file) => ({
        ok: true,
        attachmentId: file.name,
        containerPath: `/studio-attachments/session-1/${file.name}`,
        fileName: file.name,
        size: file.size
      })
    });

    await attachments.uploadFiles([testFile("one.txt")]);

    expect(attachments.uploading.value).toBe(false);
    expect(attachments.status.value).toBe("Codex path could not be injected.");
  });

  it("still hands off files uploaded before a later upload fails", async () => {
    const onUploaded = vi.fn();
    const attachments = useCodexAttachments({
      onUploaded,
      sessionId: ref("session-1"),
      uploadAttachment: async (_sessionId, file) => {
        if (file.name === "broken.txt") {
          return {
            error: "Second upload failed.",
            ok: false
          };
        }
        return {
          ok: true,
          attachmentId: file.name,
          containerPath: `/studio-attachments/session-1/${file.name}`,
          fileName: file.name,
          size: file.size
        };
      }
    });

    const uploaded = await attachments.uploadFiles([
      testFile("kept.txt"),
      testFile("broken.txt")
    ]);

    expect(uploaded.map((attachment) => attachment.fileName)).toEqual(["kept.txt"]);
    expect(onUploaded).toHaveBeenCalledWith(uploaded);
    expect(attachments.status.value).toBe("Second upload failed.");
  });

  it("formats uploaded attachment paths as plain terminal input", () => {
    expect(attachmentPathForTerminal("/studio-attachments/session/file.txt"))
      .toBe("[/studio-attachments/session/file.txt] ");
  });
});
