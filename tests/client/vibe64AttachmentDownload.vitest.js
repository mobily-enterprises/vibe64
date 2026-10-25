import { afterEach, describe, expect, it, vi } from "vitest";
import { downloadAttachment } from "../../src/lib/vibe64AttachmentDownload.js";
import { vibe64ApiResponseError } from "../../src/lib/vibe64ApiResponses.js";

function stubBrowser(response) {
  const anchors = [];
  const fetch = vi.fn(async () => response);
  vi.stubGlobal("fetch", fetch);
  vi.stubGlobal("URL", { createObjectURL: vi.fn(() => "blob:file"), revokeObjectURL: vi.fn() });
  vi.stubGlobal("document", {
    body: { append: vi.fn() },
    createElement: () => {
      const anchor = { click: vi.fn(), remove: vi.fn() };
      anchors.push(anchor);
      return anchor;
    }
  });
  return { anchors, fetch };
}

function response({ body = {}, disposition = "", ok = true } = {}) {
  return {
    blob: async () => "bytes",
    headers: { get: (name) => (name === "content-disposition" ? disposition : null) },
    json: async () => body,
    ok
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

describe("attachment download", () => {
  it("saves an attachment under its file name with cookie authentication", async () => {
    vi.useFakeTimers();
    const browser = stubBrowser(response({ disposition: "attachment; filename*=UTF-8''a.txt" }));
    await downloadAttachment("/api/file", "a.txt");
    expect(browser.fetch).toHaveBeenCalledWith("/api/file", { credentials: "include" });
    expect(browser.anchors[0]).toMatchObject({ download: "a.txt", href: "blob:file" });
    expect(browser.anchors[0].click).toHaveBeenCalled();
    vi.advanceTimersByTime(1000);
    expect(URL.revokeObjectURL).toHaveBeenCalledWith("blob:file");
  });

  it.each([
    [{ errors: [{ message: "From errors." }], error: "From error." }, "From errors."],
    [{ error: { message: "From error object." } }, "From error object."],
    [{ error: "From error." }, "From error."],
    [{}, "Fallback."]
  ])("shows one server failure message for %j", async (body, message) => {
    stubBrowser(response({ body, ok: false }));
    await expect(downloadAttachment("/api/file", "a.txt", "Fallback.")).rejects.toThrow(message);
  });

  it("refuses a successful response that is not an attachment", async () => {
    stubBrowser(response({ body: { error: "Not a file." } }));
    await expect(downloadAttachment("/api/file", "a.txt")).rejects.toThrow("Not a file.");
  });
});

describe("API response error", () => {
  it("never shows an error object as text", () => {
    expect(vibe64ApiResponseError({ error: { code: "x" } }, "Fallback.")).toBe("Fallback.");
    expect(vibe64ApiResponseError(null, "Fallback.")).toBe("Fallback.");
  });
});
