import { describe, expect, it, vi } from "vitest";
import { ref } from "vue";

import {
  attachmentPathForTerminal,
  useCodexTerminalAttachments
} from "../../src/composables/useCodexTerminalAttachments.js";
import {
  AGENT_ATTACHMENT_MAX_BYTES,
  AGENT_ATTACHMENT_MAX_ITEMS,
  codexAttachmentEventHasFiles,
  codexAttachmentFiles,
  codexAttachmentFilesFromPasteEvent,
  codexAttachmentFilesFromDropEvent,
  codexAttachmentFilesFromTransferItems,
  useAgentAttachments
} from "../../src/composables/useAgentAttachments.js";

function testFile(name, size = 1) {
  return {
    name,
    size
  };
}

function deferred() {
  let reject = null;
  let resolve = null;
  const promise = new Promise((currentResolve, currentReject) => {
    reject = currentReject;
    resolve = currentResolve;
  });
  return {
    promise,
    reject,
    resolve
  };
}

function uploadedAttachment(sessionId, file) {
  return {
    ok: true,
    attachmentId: file.name,
    path: `/tmp/vibe64-attachments/${sessionId}/${file.name}`,
    fileName: file.name,
    size: file.size
  };
}

async function flushPromises() {
  await Promise.resolve();
  await Promise.resolve();
  await Promise.resolve();
}

describe("useAgentAttachments", () => {
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
    const attachments = useAgentAttachments({
      onUploaded,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const uploaded = await attachments.uploadFiles([
      testFile("one.txt", 12),
      testFile("two.txt", 34)
    ]);

    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenNthCalledWith(
      1,
      "session-1",
      testFile("one.txt", 12),
      expect.objectContaining({
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal)
      })
    );
    expect(uploadAttachment).toHaveBeenNthCalledWith(
      2,
      "session-1",
      testFile("two.txt", 34),
      expect.objectContaining({
        onProgress: expect.any(Function),
        signal: expect.any(AbortSignal)
      })
    );
    expect(uploaded.map((attachment) => attachment.fileName)).toEqual(["one.txt", "two.txt"]);
    expect(attachments.attachments.value.map((attachment) => attachment.fileName)).toEqual(["one.txt", "two.txt"]);
    expect(onUploaded).toHaveBeenCalledTimes(2);
    expect(onUploaded).toHaveBeenNthCalledWith(1, [uploaded[0]]);
    expect(onUploaded).toHaveBeenNthCalledWith(2, [uploaded[1]]);
  });

  it("publishes the complete retained list as queued uploads complete", async () => {
    const requests = new Map();
    const publishedLists = [];
    let attachments = null;
    const uploadAttachment = vi.fn((_sessionId, file) => {
      const request = deferred();
      requests.set(file.name, request);
      return request.promise;
    });
    attachments = useAgentAttachments({
      onUploaded: async () => {
        publishedLists.push(attachments.attachments.value.map((attachment) => attachment.fileName));
      },
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const uploading = attachments.uploadFiles([
      testFile("one.txt", 12),
      testFile("two.txt", 34)
    ]);
    requests.get("one.txt").resolve(uploadedAttachment("session-1", testFile("one.txt", 12)));
    await flushPromises();
    requests.get("two.txt").resolve(uploadedAttachment("session-1", testFile("two.txt", 34)));

    await expect(uploading).resolves.toEqual([
      expect.objectContaining({ fileName: "one.txt" }),
      expect.objectContaining({ fileName: "two.txt" })
    ]);
    expect(publishedLists).toEqual([
      ["one.txt"],
      ["one.txt", "two.txt"]
    ]);
  });

  it("shows producer attachments immediately while preparing and then uploads the produced file", async () => {
    const preparation = deferred();
    const uploadAttachment = vi.fn(async (sessionId, file) => uploadedAttachment(sessionId, file));
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const result = attachments.uploadFileProducer({
      fileName: "Preview screenshot",
      produce: () => preparation.promise
    });
    await flushPromises();

    expect(attachments.queueItems.value[0]).toMatchObject({
      fileName: "Preview screenshot",
      phase: "preparing"
    });
    expect(attachments.canSubmit.value).toBe(false);

    preparation.resolve(testFile("preview.png", 4096));
    await expect(result).resolves.toMatchObject({
      fileName: "preview.png",
      size: 4096
    });
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(attachments.queueItems.value[0]).toMatchObject({
      fileName: "preview.png",
      phase: "ready"
    });
  });

  it("cancels preparation and retries its producer without creating a hidden upload", async () => {
    const firstPreparation = deferred();
    const producedFile = testFile("diagnostics.json", 256);
    const produce = vi.fn()
      .mockImplementationOnce(({ signal }) => {
        signal.addEventListener("abort", () => firstPreparation.reject(
          Object.assign(new Error("cancelled"), { name: "AbortError" })
        ));
        return firstPreparation.promise;
      })
      .mockResolvedValueOnce(producedFile);
    const uploadAttachment = vi.fn(async (sessionId, file) => uploadedAttachment(sessionId, file));
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const firstResult = attachments.uploadFileProducer({
      fileName: "Preview diagnostics",
      produce
    });
    await flushPromises();
    const row = attachments.queueItems.value[0];
    expect(attachments.cancelAttachment(row)).toBe(true);
    await expect(firstResult).resolves.toBeNull();
    expect(row.phase).toBe("cancelled");
    expect(uploadAttachment).not.toHaveBeenCalled();

    await expect(attachments.retryAttachment(row)).resolves.toMatchObject({
      fileName: "diagnostics.json"
    });
    expect(produce).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(row.phase).toBe("ready");
  });

  it("does not let a stale cancelled producer settle an immediate retry", async () => {
    const firstPreparation = deferred();
    const secondPreparation = deferred();
    const produce = vi.fn()
      .mockImplementationOnce(() => firstPreparation.promise)
      .mockImplementationOnce(() => secondPreparation.promise);
    const uploadAttachment = vi.fn(async (sessionId, file) => uploadedAttachment(sessionId, file));
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const firstResult = attachments.uploadFileProducer({
      fileName: "Preview diagnostics",
      produce
    });
    await flushPromises();
    const row = attachments.queueItems.value[0];
    attachments.cancelAttachment(row);
    await expect(firstResult).resolves.toBeNull();

    let retrySettled = false;
    const retry = attachments.retryAttachment(row).then((result) => {
      retrySettled = true;
      return result;
    });
    await flushPromises();
    firstPreparation.resolve(testFile("stale-diagnostics.json", 128));
    await flushPromises();

    expect(retrySettled).toBe(false);
    expect(uploadAttachment).not.toHaveBeenCalled();
    expect(row.phase).toBe("preparing");

    secondPreparation.resolve(testFile("current-diagnostics.json", 256));
    await expect(retry).resolves.toMatchObject({
      fileName: "current-diagnostics.json"
    });
    expect(produce).toHaveBeenCalledTimes(2);
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(row.phase).toBe("ready");
  });

  it("shows every row immediately, uploads one file at a time, accepts more, and consumes byte progress", async () => {
    const requests = new Map();
    const onUploaded = vi.fn();
    const uploadAttachment = vi.fn((sessionId, file, options) => {
      const request = deferred();
      requests.set(file.name, {
        ...request,
        file,
        options,
        sessionId
      });
      return request.promise;
    });
    const attachments = useAgentAttachments({
      onUploaded,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const firstBatch = attachments.uploadFiles([
      testFile("one.txt", 10),
      testFile("two.txt", 20),
      testFile("three.txt", 30)
    ]);

    expect(attachments.queueItems.value.map((item) => item.phase)).toEqual([
      "uploading",
      "queued",
      "queued"
    ]);
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(attachments.hasUnresolved.value).toBe(true);
    expect(attachments.canSubmit.value).toBe(false);

    const secondBatch = attachments.uploadFiles([testFile("four.txt", 40)]);
    expect(attachments.queueItems.value.at(-1)).toMatchObject({
      fileName: "four.txt",
      phase: "queued"
    });
    expect(uploadAttachment).toHaveBeenCalledTimes(1);

    requests.get("one.txt").options.onProgress({
      bytesSent: 5,
      progress: 0.5,
      totalBytes: 10
    });
    expect(attachments.queueItems.value[0]).toMatchObject({
      bytesSent: 5,
      progress: 50,
      totalBytes: 10
    });
    expect(attachments.aggregateProgress.value).toEqual({
      bytesSent: 5,
      percent: 5,
      totalBytes: 100
    });

    requests.get("one.txt").resolve(uploadedAttachment("session-1", testFile("one.txt", 10)));
    await flushPromises();
    expect(uploadAttachment).toHaveBeenCalledTimes(2);
    expect(requests.has("two.txt")).toBe(true);
    expect(onUploaded).toHaveBeenCalledWith([
      expect.objectContaining({ fileName: "one.txt" })
    ]);

    requests.get("two.txt").resolve(uploadedAttachment("session-1", testFile("two.txt", 20)));
    await flushPromises();
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
    requests.get("three.txt").resolve(uploadedAttachment("session-1", testFile("three.txt", 30)));
    await flushPromises();
    expect(uploadAttachment).toHaveBeenCalledTimes(4);
    requests.get("four.txt").resolve(uploadedAttachment("session-1", testFile("four.txt", 40)));

    expect((await firstBatch).map((attachment) => attachment.fileName)).toEqual([
      "one.txt",
      "two.txt",
      "three.txt"
    ]);
    expect((await secondBatch).map((attachment) => attachment.fileName)).toEqual(["four.txt"]);
    expect(attachments.queueItems.value.every((item) => item.phase === "ready")).toBe(true);
    expect(attachments.hasUnresolved.value).toBe(false);
    expect(attachments.canSubmit.value).toBe(true);
  });

  it("retains visible size failures and enforces ten non-cancelled items", async () => {
    const uploadAttachment = vi.fn(() => deferred().promise);
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    expect(await attachments.uploadFiles([
      testFile("too-large.bin", AGENT_ATTACHMENT_MAX_BYTES + 1)
    ])).toEqual([]);
    expect(attachments.queueItems.value[0]).toMatchObject({
      failureStage: "validation",
      phase: "failed"
    });
    expect(attachments.queueItems.value[0].error).toContain("100 MB");
    expect(attachments.hasUnresolved.value).toBe(true);
    expect(uploadAttachment).not.toHaveBeenCalled();

    void attachments.uploadFiles(Array.from(
      { length: AGENT_ATTACHMENT_MAX_ITEMS },
      (_unused, index) => testFile(`file-${index}.txt`)
    ));
    expect(attachments.queueItems.value).toHaveLength(AGENT_ATTACHMENT_MAX_ITEMS);
    expect(attachments.atCapacity.value).toBe(true);
    expect(attachments.status.value).toContain("at most 10 attachments");
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
  });

  it("keeps file failures independent and retries only the failed file", async () => {
    const attempts = new Map();
    const uploadAttachment = vi.fn(async (sessionId, file) => {
      const attempt = (attempts.get(file.name) || 0) + 1;
      attempts.set(file.name, attempt);
      if (file.name === "broken.txt" && attempt === 1) {
        return {
          error: "Network failed.",
          ok: false
        };
      }
      return uploadedAttachment(sessionId, file);
    });
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment
    });

    const uploaded = await attachments.uploadFiles([
      testFile("kept.txt"),
      testFile("broken.txt")
    ]);
    expect(uploaded.map((attachment) => attachment.fileName)).toEqual(["kept.txt"]);
    expect(attachments.queueItems.value).toEqual([
      expect.objectContaining({ fileName: "kept.txt", phase: "ready" }),
      expect.objectContaining({ fileName: "broken.txt", failureStage: "upload", phase: "failed" })
    ]);

    const retried = await attachments.retryAttachment(attachments.queueItems.value[1]);
    expect(retried).toMatchObject({ fileName: "broken.txt" });
    expect(uploadAttachment).toHaveBeenCalledTimes(3);
    expect(attachments.attachments.value.map((attachment) => attachment.fileName)).toEqual([
      "kept.txt",
      "broken.txt"
    ]);
  });

  it("cancels without blocking send or capacity and deletes a late server success", async () => {
    const request = deferred();
    const deleteAttachment = vi.fn(async () => ({ ok: true }));
    let uploadOptions = null;
    const attachments = useAgentAttachments({
      deleteAttachment,
      sessionId: ref("session-1"),
      uploadAttachment: (_sessionId, _file, options) => {
        uploadOptions = options;
        return request.promise;
      }
    });

    const upload = attachments.uploadFiles([testFile("cancelled.txt")]);
    const row = attachments.queueItems.value[0];
    expect(attachments.cancelAttachment(row)).toBe(true);
    expect(row.phase).toBe("cancelled");
    expect(uploadOptions.signal.aborted).toBe(true);
    expect(attachments.hasUnresolved.value).toBe(false);
    expect(attachments.canSubmit.value).toBe(true);
    expect(attachments.atCapacity.value).toBe(false);

    request.resolve(uploadedAttachment("session-1", testFile("cancelled.txt")));
    expect(await upload).toEqual([]);
    await attachments.waitForAttachmentCleanup();
    expect(deleteAttachment).toHaveBeenCalledWith("session-1", "cancelled.txt");
    expect(attachments.attachments.value).toEqual([]);
  });

  it("keeps a cancelled attempt separate from the retry that follows it", async () => {
    const requests = [];
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment: () => {
        const request = deferred();
        requests.push(request);
        return request.promise;
      }
    });

    void attachments.uploadFiles([testFile("retry.txt")]);
    const row = attachments.queueItems.value[0];
    attachments.cancelAttachment(row);
    let retrySettled = false;
    const retry = attachments.retryAttachment(row).then((result) => {
      retrySettled = true;
      return result;
    });

    requests[0].reject(Object.assign(new Error("cancelled"), { name: "AbortError" }));
    await flushPromises();
    expect(requests).toHaveLength(2);
    expect(retrySettled).toBe(false);
    requests[1].resolve(uploadedAttachment("session-1", testFile("retry.txt")));
    expect(await retry).toMatchObject({ fileName: "retry.txt" });
  });

  it("retries a failed consumer handoff without uploading the bytes again", async () => {
    const onUploaded = vi.fn()
      .mockRejectedValueOnce(new Error("Terminal path could not be injected."))
      .mockResolvedValueOnce(true);
    const uploadAttachment = vi.fn(async (sessionId, file) => uploadedAttachment(sessionId, file));
    const attachments = useAgentAttachments({
      onUploaded,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    expect(await attachments.uploadFiles([testFile("terminal.txt")])).toEqual([]);
    const row = attachments.queueItems.value[0];
    expect(row).toMatchObject({
      failureStage: "handoff",
      phase: "failed",
      progress: 100
    });
    expect(row.receipt).toMatchObject({ attachmentId: "terminal.txt" });
    expect(attachments.attachments.value).toEqual([]);

    expect(await attachments.retryAttachment(row)).toMatchObject({ fileName: "terminal.txt" });
    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(onUploaded).toHaveBeenCalledTimes(2);
    expect(row.phase).toBe("ready");
  });

  it("deletes removed and abandoned receipts but preserves accepted prompt attachments", async () => {
    const deleteAttachment = vi.fn(async () => ({ ok: true }));
    const attachments = useAgentAttachments({
      deleteAttachment,
      sessionId: ref("session-1"),
      uploadAttachment: async (sessionId, file) => uploadedAttachment(sessionId, file)
    });

    await attachments.uploadFiles([testFile("removed.txt")]);
    expect(attachments.removeAttachment(attachments.attachments.value[0])).toHaveLength(1);
    await attachments.waitForAttachmentCleanup();
    expect(deleteAttachment).toHaveBeenCalledWith("session-1", "removed.txt");

    await attachments.uploadFiles([testFile("accepted.txt")]);
    expect(attachments.clearAttachments()).toEqual([
      expect.objectContaining({ fileName: "accepted.txt" })
    ]);
    await attachments.waitForAttachmentCleanup();
    expect(deleteAttachment).not.toHaveBeenCalledWith("session-1", "accepted.txt");

    await attachments.uploadFiles([testFile("abandoned.txt")]);
    await attachments.abandonAttachments();
    expect(deleteAttachment).toHaveBeenCalledWith("session-1", "abandoned.txt");
  });

  it("abandons an old session scope and cleans a late upload without affecting the new scope", async () => {
    const currentSessionId = ref("session-old");
    const oldRequest = deferred();
    const deleteAttachment = vi.fn(async () => ({ ok: true }));
    const uploadAttachment = vi.fn((sessionId, file) => {
      if (sessionId === "session-old") {
        return oldRequest.promise;
      }
      return Promise.resolve(uploadedAttachment(sessionId, file));
    });
    const attachments = useAgentAttachments({
      deleteAttachment,
      sessionId: currentSessionId,
      uploadAttachment
    });

    const oldUpload = attachments.uploadFiles([testFile("old.txt")]);
    currentSessionId.value = "session-new";
    expect(attachments.queueItems.value).toEqual([]);
    const newUpload = attachments.uploadFiles([testFile("new.txt")]);
    oldRequest.resolve(uploadedAttachment("session-old", testFile("old.txt")));

    expect(await oldUpload).toEqual([]);
    expect((await newUpload)[0]).toMatchObject({
      fileName: "new.txt",
      sessionId: "session-new"
    });
    await attachments.waitForAttachmentCleanup();
    expect(deleteAttachment).toHaveBeenCalledWith("session-old", "old.txt");
    expect(attachments.attachments.value).toEqual([
      expect.objectContaining({ fileName: "new.txt", sessionId: "session-new" })
    ]);
  });

  it("disposes the queue, aborts active work, and deletes a late success exactly once", async () => {
    const request = deferred();
    const deleteAttachment = vi.fn(async () => ({ ok: true }));
    let signal = null;
    const attachments = useAgentAttachments({
      deleteAttachment,
      sessionId: ref("session-1"),
      uploadAttachment: (_sessionId, _file, options) => {
        signal = options.signal;
        return request.promise;
      }
    });

    const upload = attachments.uploadFiles([testFile("late.txt")]);
    const disposing = attachments.disposeAttachments();
    expect(signal.aborted).toBe(true);
    expect(attachments.queueItems.value).toEqual([]);
    request.resolve(uploadedAttachment("session-1", testFile("late.txt")));

    await disposing;
    expect(await upload).toEqual([]);
    expect(deleteAttachment).toHaveBeenCalledTimes(1);
    expect(deleteAttachment).toHaveBeenCalledWith("session-1", "late.txt");
    expect(await attachments.uploadFiles([testFile("ignored.txt")])).toEqual([]);
  });

  it("does not let a cancelled retry exceed the ten-file retained limit", async () => {
    const requests = [];
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"),
      uploadAttachment: () => {
        const request = deferred();
        requests.push(request);
        return request.promise;
      }
    });

    void attachments.uploadFiles([testFile("cancel-me.txt")]);
    const cancelled = attachments.queueItems.value[0];
    attachments.cancelAttachment(cancelled);
    void attachments.uploadFiles(Array.from(
      { length: AGENT_ATTACHMENT_MAX_ITEMS },
      (_unused, index) => testFile(`replacement-${index}.txt`)
    ));

    expect(attachments.queueItems.value).toHaveLength(AGENT_ATTACHMENT_MAX_ITEMS + 1);
    expect(attachments.atCapacity.value).toBe(true);
    expect(await attachments.retryAttachment(cancelled)).toBe(null);
    expect(cancelled.phase).toBe("cancelled");
    expect(attachments.status.value).toContain("at most 10 attachments");
  });

  it("removes uploaded attachment records by id", async () => {
    const attachments = useAgentAttachments({
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
    const attachments = useAgentAttachments({
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
    const attachments = useAgentAttachments({
      canUpload: () => false,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    expect(await attachments.uploadFiles([testFile("blocked.txt")])).toEqual([]);
    expect(uploadAttachment).not.toHaveBeenCalled();
  });

  it("clears only acknowledged attachments while preserving newer ready and in-flight uploads", async () => {
    const pending = deferred();
    const deleteAttachment = vi.fn(async () => ({ ok: true }));
    const attachments = useAgentAttachments({
      sessionId: ref("session-1"), deleteAttachment,
      uploadAttachment: (sessionId, file) => file.name === "uploading.txt"
        ? pending.promise
        : Promise.resolve(uploadedAttachment(sessionId, file))
    });
    await attachments.uploadFiles([testFile("sent.txt"), testFile("new.txt")]);
    const inFlight = attachments.uploadFiles([testFile("uploading.txt")]);
    expect(attachments.clearAttachments({ attachmentIds: ["sent.txt"] }).map((item) => item.fileName)).toEqual(["sent.txt"]);
    expect(attachments.queueItems.value.map((item) => item.fileName)).toEqual(["new.txt", "uploading.txt"]);
    pending.resolve(uploadedAttachment("session-1", testFile("uploading.txt")));
    await inFlight;
    expect(attachments.attachments.value.map((item) => item.fileName)).toEqual(["new.txt", "uploading.txt"]);
    expect(deleteAttachment).not.toHaveBeenCalled();
  });

  it("keeps a consumer handoff failure on its row without duplicate global feedback", async () => {
    const onError = vi.fn();
    const attachments = useAgentAttachments({
      onError,
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
    expect(attachments.queueItems.value[0]).toMatchObject({
      error: "Codex path could not be injected.",
      failureStage: "handoff",
      phase: "failed"
    });
    expect(onError).not.toHaveBeenCalled();
  });

  it("still hands off files uploaded before a later upload fails", async () => {
    const onError = vi.fn();
    const onUploaded = vi.fn();
    const attachments = useAgentAttachments({
      onError,
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
    expect(attachments.queueItems.value).toEqual([
      expect.objectContaining({ fileName: "kept.txt", phase: "ready" }),
      expect.objectContaining({
        error: "Second upload failed.",
        fileName: "broken.txt",
        phase: "failed"
      })
    ]);
    expect(onError).not.toHaveBeenCalled();
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
    const attachments = useAgentAttachments({
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
    const onError = vi.fn();
    const preventDefault = vi.fn();
    const uploadAttachment = vi.fn();
    const attachments = useAgentAttachments({
      onError,
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
    expect(onError).toHaveBeenCalledWith(
      "Copied local files cannot be pasted from this browser. Drop the file or use Attach files.",
      "Attachment upload failed."
    );

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
    expect(onError).toHaveBeenCalledTimes(2);
  });

  it("formats uploaded attachment paths as plain terminal input", () => {
    expect(attachmentPathForTerminal("/tmp/vibe64-attachments/session/file.txt"))
      .toBe("[/tmp/vibe64-attachments/session/file.txt] ");
  });

  it("atomically writes terminal paths with attachment ids and retries handoff without re-uploading", async () => {
    const file = testFile("terminal.txt", 12);
    const sendAttachmentPath = vi.fn()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const uploadAttachment = vi.fn(async (_sessionId, uploadedFile, options) => {
      options.onProgress({ bytesSent: 12, progress: 1, totalBytes: 12 });
      return {
        attachmentId: "123e4567-e89b-42d3-a456-426614174000",
        fileName: uploadedFile.name,
        ok: true,
        path: "/tmp/vibe64-attachments/session/terminal.txt",
        size: uploadedFile.size
      };
    });
    const terminal = useCodexTerminalAttachments({
      deleteAttachment: vi.fn(),
      ensureTerminalReady: vi.fn().mockResolvedValue(true),
      focusTerminal: vi.fn(),
      sendAttachmentPath,
      sessionId: ref("session-1"),
      uploadAttachment
    });

    await terminal.handleAttachmentDrop({
      dataTransfer: {
        files: [file],
        items: []
      }
    });

    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(sendAttachmentPath).toHaveBeenNthCalledWith(
      1,
      "[/tmp/vibe64-attachments/session/terminal.txt] ",
      ["123e4567-e89b-42d3-a456-426614174000"]
    );
    expect(terminal.attachmentQueueItems.value[0]).toMatchObject({
      failureStage: "handoff",
      phase: "failed"
    });

    await terminal.retryAttachment(terminal.attachmentQueueItems.value[0]);

    expect(uploadAttachment).toHaveBeenCalledTimes(1);
    expect(sendAttachmentPath).toHaveBeenCalledTimes(2);
    expect(terminal.attachmentQueueItems.value).toEqual([]);
  });
});
