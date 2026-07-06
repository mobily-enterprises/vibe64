import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
  attachmentPathForTerminal
} from "../../src/composables/useCodexTerminalAttachments.js";
import {
  codexAttachmentEventHasFiles,
  codexAttachmentFiles,
  codexAttachmentFilesFromPasteEvent,
  codexAttachmentFilesFromDropEvent,
  codexAttachmentFilesFromTransferItems,
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

  it("extracts file attachments from clipboard paste data", () => {
    const pastedFile = testFile("clipboard.png", 123);

    expect(codexAttachmentFilesFromPasteEvent({
      clipboardData: {
        files: [],
        items: [
          {
            kind: "file",
            getAsFile: () => pastedFile
          },
          {
            kind: "string",
            getAsFile: () => testFile("ignored.txt")
          }
        ]
      }
    })).toEqual([pastedFile]);
  });

  it("extracts file attachments from data transfer items before file lists", () => {
    const itemFile = testFile("dragged.png", 123);
    const fallbackFile = testFile("fallback.png", 456);

    expect(codexAttachmentFilesFromTransferItems([
      {
        kind: "file",
        getAsFile: () => itemFile
      },
      {
        kind: "string",
        getAsFile: () => testFile("ignored.txt")
      }
    ])).toEqual([itemFile]);
    expect(codexAttachmentFilesFromDropEvent({
      dataTransfer: {
        files: [fallbackFile],
        items: [
          {
            kind: "file",
            getAsFile: () => itemFile
          }
        ]
      }
    })).toEqual([itemFile]);
    expect(codexAttachmentEventHasFiles({
      dataTransfer: {
        items: [
          {
            kind: "file"
          }
        ],
        types: []
      }
    })).toBe(true);
    expect(codexAttachmentEventHasFiles({
      dataTransfer: {
        types: ["application/x-moz-file"]
      }
    })).toBe(true);
  });

  it("uploads files once and reports the uploaded attachment records", async () => {
    const onUploaded = vi.fn();
    const uploadAttachment = vi.fn(async (sessionId, file) => ({
      ok: true,
      attachmentId: file.name,
      path: `/tmp/vibe64-attachments/${sessionId}/${file.name}`,
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
        path: `/tmp/vibe64-attachments/session-1/${file.name}`,
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
        path: `/tmp/vibe64-attachments/session-1/${file.name}`,
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
        path: `/tmp/vibe64-attachments/session-1/${file.name}`,
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
          path: `/tmp/vibe64-attachments/session-1/${file.name}`,
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

  it("uploads pasted files without blocking normal text paste", async () => {
    const preventDefault = vi.fn();
    const uploadAttachment = vi.fn(async (sessionId, file) => ({
      ok: true,
      attachmentId: file.name,
      path: `/tmp/vibe64-attachments/${sessionId}/${file.name}`,
      fileName: file.name,
      size: file.size
    }));
    const attachments = useCodexAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    expect(await attachments.handlePaste({
      clipboardData: {
        items: [
          {
            kind: "string"
          }
        ]
      },
      preventDefault
    })).toEqual([]);
    expect(preventDefault).not.toHaveBeenCalled();

    const uploaded = await attachments.handlePaste({
      clipboardData: {
        getData: () => "",
        items: [
          {
            kind: "file",
            getAsFile: () => testFile("clipboard.png", 321)
          }
        ]
      },
      preventDefault
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(uploaded.map((attachment) => attachment.fileName)).toEqual(["clipboard.png"]);

    const textAndFile = await attachments.handlePaste({
      clipboardData: {
        getData: (type) => type === "text/plain" ? "keep this text" : "",
        items: [
          {
            kind: "file",
            getAsFile: () => testFile("also-attached.png", 654)
          }
        ]
      },
      preventDefault
    });

    expect(preventDefault).toHaveBeenCalledTimes(1);
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(textAndFile.map((attachment) => attachment.fileName)).toEqual(["also-attached.png"]);
  });

  it("reports copied local file references that browsers do not expose as files", async () => {
    const preventDefault = vi.fn();
    const uploadAttachment = vi.fn();
    const attachments = useCodexAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    expect(await attachments.handlePaste({
      clipboardData: {
        getData: (type) => {
          if (type === "x-special/gnome-copied-files") {
            return "copy\nfile:///home/merc/Pictures/screenshot.png";
          }
          return "";
        },
        items: [
          {
            kind: "string"
          }
        ],
        types: ["x-special/gnome-copied-files"]
      },
      preventDefault
    })).toEqual([]);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(attachments.status.value).toBe("Copied local files cannot be pasted from this browser. Drop the file or use Attach files.");

    attachments.clearStatus();
    expect(await attachments.handlePaste({
      clipboardData: {
        getData: () => "",
        items: [],
        types: ["Files"]
      },
      preventDefault
    })).toEqual([]);

    expect(preventDefault).not.toHaveBeenCalled();
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(attachments.status.value).toBe("Copied local files cannot be pasted from this browser. Drop the file or use Attach files.");
  });

  it("formats uploaded attachment paths as plain terminal input", () => {
    expect(attachmentPathForTerminal("/tmp/vibe64-attachments/session/file.txt"))
      .toBe("[/tmp/vibe64-attachments/session/file.txt] ");
  });
});
