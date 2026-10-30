import { effectScope, nextTick, ref } from "vue";
import { describe, expect, it, vi } from "vitest";

const requests = [];
vi.mock("../../src/lib/vibe64FileUpload.js", () => ({
  uploadFileRequest: vi.fn((request) => new Promise((resolve, reject) => {
    const entry = { ...request, resolve, reject };
    request.signal?.addEventListener("abort", () => reject(Object.assign(new Error("Upload was cancelled."), { name: "AbortError" })));
    requests.push(entry);
  }))
}));

import { uploadFileRequest } from "../../src/lib/vibe64FileUpload.js";
import { useVibe64FileUploads } from "../../src/composables/useVibe64FileUploads.js";

function file(name, size = 10) {
  return { name, size };
}

async function settle() {
  for (let index = 0; index < 6; index += 1) await Promise.resolve();
  await nextTick();
}

function setup(endpoint = "/api/vibe64/project-files/project-drop-zone") {
  requests.length = 0;
  uploadFileRequest.mockClear();
  const uploaded = [];
  const scope = effectScope();
  const uploads = scope.run(() => useVibe64FileUploads({ endpoint: ref(endpoint), onUploaded: (receipt) => uploaded.push(receipt) }));
  return { scope, uploaded, uploads };
}

const phases = (uploads) => uploads.items.value.map((item) => `${item.fileName}:${item.phase}`);

describe("useVibe64FileUploads", () => {
  it("uploads one file at a time into the folder open when it was added, with byte progress", async () => {
    const { scope, uploaded, uploads } = setup();
    void uploads.uploadFiles([file("a.txt", 100), file("b.txt", 50)], { folder: "docs" });
    await settle();
    expect(phases(uploads)).toEqual(["a.txt:uploading", "b.txt:queued"]);
    expect(requests).toHaveLength(1);
    expect(requests[0].path).toBe("/api/vibe64/project-files/project-drop-zone/upload?path=docs%2Fa.txt");

    requests[0].onProgress({ bytesSent: 40, progress: 0.4, totalBytes: 100 });
    expect(uploads.items.value[0]).toMatchObject({ bytesSent: 40, progress: 40 });
    expect(uploads.active.value).toBe(true);

    requests[0].resolve({ ok: true, path: "docs/a.txt" });
    await settle();
    expect(phases(uploads)).toEqual(["a.txt:ready", "b.txt:uploading"]);
    expect(uploaded.map((receipt) => receipt.path)).toEqual(["docs/a.txt"]);

    requests[1].resolve({ ok: true, path: "docs/b.txt" });
    await settle();
    // A finished upload stays listed as done until cleared; nothing else is needed.
    expect(phases(uploads)).toEqual(["a.txt:ready", "b.txt:ready"]);
    expect(uploads.active.value).toBe(false);
    uploads.clear();
    expect(uploads.items.value).toEqual([]);
    scope.stop();
  });

  it("cancels the running and the waiting uploads by aborting their requests", async () => {
    const { scope, uploads } = setup();
    void uploads.uploadFiles([file("big.bin"), file("next.bin"), file("last.bin")]);
    await settle();
    const running = requests[0];
    uploads.cancel(uploads.items.value[0]);
    await settle();
    expect(running.signal.aborted).toBe(true);
    expect(phases(uploads)).toEqual(["big.bin:cancelled", "next.bin:uploading", "last.bin:queued"]);

    uploads.cancelAll();
    await settle();
    expect(phases(uploads)).toEqual(["big.bin:cancelled", "next.bin:cancelled", "last.bin:cancelled"]);
    expect(requests).toHaveLength(2);
    expect(requests[1].signal.aborted).toBe(true);
    expect(uploads.active.value).toBe(false);
    scope.stop();
  });

  it("shows the reason a file failed and retries it on request", async () => {
    const { scope, uploads } = setup();
    void uploads.uploadFiles([file("notes.txt")]);
    await settle();
    requests[0].reject(new Error("“notes.txt” already exists in this folder."));
    await settle();
    expect(uploads.items.value[0]).toMatchObject({ phase: "failed", error: "“notes.txt” already exists in this folder." });

    void uploads.retry(uploads.items.value[0]);
    await settle();
    expect(requests).toHaveLength(2);
    requests[1].resolve({ ok: true, path: "notes.txt" });
    await settle();
    expect(phases(uploads)).toEqual(["notes.txt:ready"]);
    scope.stop();
  });

  it("says why a fully sent file is still finishing, once it takes a while", async () => {
    requests.length = 0;
    const scope = effectScope();
    const uploads = scope.run(() => useVibe64FileUploads({ endpoint: ref("/api/vibe64/sessions/s/files/repo"), finishingNote: "Finishing — waiting" }));
    void uploads.uploadFiles([file("big.bin", 100)]);
    await settle();
    vi.useFakeTimers({ toFake: ["setTimeout", "clearTimeout"] });
    try {
      requests[0].onProgress({ bytesSent: 100, progress: 1, totalBytes: 100 });
      vi.advanceTimersByTime(1000);
      expect(uploads.note(uploads.items.value[0])).toBe("");
      vi.advanceTimersByTime(500);
      expect(uploads.note(uploads.items.value[0])).toBe("Finishing — waiting");
    } finally {
      vi.useRealTimers();
    }
    requests[0].resolve({ ok: true, path: "big.bin" });
    await settle();
    expect(phases(uploads)).toEqual(["big.bin:ready"]);
    expect(uploads.note(uploads.items.value[0])).toBe("");
    // Without a note nothing is ever shown.
    const plain = setup();
    void plain.uploads.uploadFiles([file("a.txt", 10)]);
    await settle();
    requests[0].onProgress({ bytesSent: 10, progress: 1, totalBytes: 10 });
    expect(plain.uploads.note(plain.uploads.items.value[0])).toBe("");
    plain.scope.stop();
    scope.stop();
  });

  it("refuses a file over the upload limit without sending it", async () => {
    const { scope, uploads } = setup();
    void uploads.uploadFiles([file("huge.iso", 500 * 1024 * 1024 + 1)]);
    await settle();
    expect(uploadFileRequest).not.toHaveBeenCalled();
    expect(uploads.items.value[0].phase).toBe("failed");
    expect(uploads.items.value[0].error).toBe("Larger than the 500 MiB upload limit.");
    scope.stop();
  });

  it("sends the one conflict choice only for the files that already exist", async () => {
    const { scope, uploads } = setup();
    void uploads.uploadFiles([file("same.txt"), file("new.txt")], { conflicts: ["same.txt"], conflict: "keep-both" });
    await settle();
    expect(requests[0].path).toContain("upload?path=same.txt&conflict=keep-both");
    requests[0].resolve({ ok: true, path: "same (1).txt" });
    await settle();
    expect(requests[1].path).toMatch(/upload\?path=new\.txt$/u);
    scope.stop();
  });

  it("starts a new batch without the finished rows of the last one", async () => {
    const { scope, uploads } = setup();
    void uploads.uploadFiles([file("one.txt"), file("two.txt")]);
    await settle();
    requests[0].resolve({ ok: true, path: "one.txt" });
    await settle();
    uploads.cancel(uploads.items.value[1]);
    await settle();
    void uploads.uploadFiles([file("three.txt")]);
    await settle();
    expect(phases(uploads)).toEqual(["three.txt:uploading"]);
    scope.stop();
  });

  it("keeps failed rows in view when another batch starts", async () => {
    const { scope, uploads } = setup();
    void uploads.uploadFiles([file("broken.txt")]);
    await settle();
    requests[0].reject(new Error("Disk full."));
    await settle();
    void uploads.uploadFiles([file("fresh.txt")]);
    await settle();
    expect(phases(uploads)).toEqual(["broken.txt:failed", "fresh.txt:uploading"]);
    scope.stop();
  });
});
