import { afterEach, beforeEach, expect, it, vi } from "vitest";

const upload = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("@/lib/vibe64FileUpload.js", () => ({ uploadFileRequest: upload.request }));
vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({ useCommand: () => ({ isRunning: false, run: vi.fn() }) }));
vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({ usePaths: () => ({ api: (suffix) => `/api${suffix}` }) }));
import { useVibe64AttachmentCommands } from "../../src/composables/useVibe64AttachmentCommands.js";

// An attachment uploaded while a long holder has the session (setup preparing the workspace, Save, Update) hears that
// holder's worded refusal, and one whose answer the hosted edge cut never came back: the composer sends the file again
// on its own instead of showing either as a failure.
const BUSY = "vibe64_agent_write_mode_busy";
const file = new Blob(["screenshot"], { type: "image/png" });

beforeEach(() => {
  upload.request.mockReset();
  vi.useFakeTimers({ toFake: ["setTimeout"] });
});

afterEach(() => {
  vi.useRealTimers();
});

function send() {
  return useVibe64AttachmentCommands().uploadAttachment("session-a", file);
}

it.each([
  ["refused", () => Promise.reject(Object.assign(new Error("The workspace is being prepared. Try again when it is ready."),
    { code: BUSY, status: 409 }))],
  ["answered", () => Promise.resolve({ ok: false, code: BUSY, error: "The workspace is being prepared. Try again when it is ready.",
    retryable: true })]
])("sends an attachment the busy session %s again until it is stored", async (_kind, busy) => {
  upload.request.mockImplementationOnce(busy).mockResolvedValueOnce({ ok: true, attachmentId: "attachment-1" });
  const sending = send();
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(sending).resolves.toEqual({ ok: true, attachmentId: "attachment-1" });
  expect(upload.request).toHaveBeenCalledTimes(2);
  expect(upload.request.mock.calls[1][0].path).toBe("/api/vibe64/sessions/session-a/agent-attachments");
});

it.each([0, 502, 504])("sends an attachment whose answer was lost with status %s again", async (status) => {
  upload.request.mockRejectedValueOnce(Object.assign(new Error("Assistant attachment could not be uploaded."), { status }))
    .mockResolvedValueOnce({ ok: true, attachmentId: "attachment-2" });
  const sending = send();
  await vi.advanceTimersByTimeAsync(5_000);
  await expect(sending).resolves.toEqual({ ok: true, attachmentId: "attachment-2" });
  expect(upload.request).toHaveBeenCalledTimes(2);
});

it("passes any other refusal on at once", async () => {
  const closing = Object.assign(new Error("This session is closing. Attachments cannot be added now."),
    { code: "vibe64_agent_attachment_session_unavailable", status: 409 });
  upload.request.mockRejectedValueOnce(closing);
  await expect(send()).rejects.toBe(closing);
  expect(upload.request).toHaveBeenCalledTimes(1);
});

it("says the holder's own words once the session stays busy", async () => {
  upload.request.mockRejectedValue(Object.assign(new Error("This session is being saved. Try again when Save finishes."),
    { code: BUSY, status: 409 }));
  const sending = send();
  const settled = expect(sending).rejects.toThrow("This session is being saved. Try again when Save finishes.");
  await vi.advanceTimersByTimeAsync(120_000);
  await settled;
  expect(upload.request.mock.calls.length).toBeGreaterThan(2);
});
