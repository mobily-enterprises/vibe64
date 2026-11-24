import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const commandHarness = vi.hoisted(() => ({
  options: [],
  run: vi.fn()
}));

vi.mock("@jskit-ai/http-web/client/composables/useCommand", () => ({
  useCommand: (options = {}) => {
    commandHarness.options.push(options);
    return {
      run: commandHarness.run
    };
  }
}));

vi.mock("@jskit-ai/shell-web/client/navigation/usePaths", () => ({
  usePaths: () => ({
    api: (suffix = "") => `/api${suffix}`
  })
}));

vi.mock("@/composables/useVibe64TerminalCommands.js", () => ({
  useVibe64TerminalCommands: () => ({
    closeAgentTerminal: vi.fn(),
    sendAgentTerminalText: vi.fn(),
    startAgentTerminal: vi.fn()
  })
}));

import {
  useVibe64CodexCommands
} from "../../src/composables/useVibe64CodexCommands.js";

class FakeXmlHttpRequest {
  static instances = [];

  constructor() {
    this.aborted = false;
    this.body = null;
    this.headers = {};
    this.method = "";
    this.response = null;
    this.responseText = "";
    this.status = 0;
    this.upload = new EventTarget();
    this.url = "";
    this.withCredentials = false;
    FakeXmlHttpRequest.instances.push(this);
  }

  abort() {
    this.aborted = true;
    this.onabort?.();
  }

  emitProgress(loaded, total, lengthComputable = true) {
    const event = new Event("progress");
    Object.defineProperties(event, {
      lengthComputable: { value: lengthComputable },
      loaded: { value: loaded },
      total: { value: total }
    });
    this.upload.dispatchEvent(event);
  }

  failNetwork() {
    this.onerror?.();
  }

  open(method, url) {
    // Native XMLHttpRequest reinitializes request handlers during open().
    this.onabort = null;
    this.onerror = null;
    this.onload = null;
    this.ontimeout = null;
    this.upload = new EventTarget();
    this.method = method;
    this.url = url;
  }

  respond(status, payload) {
    this.respondText(status, JSON.stringify(payload));
  }

  respondText(status, text) {
    this.status = status;
    this.responseText = text;
    this.onload?.();
  }

  send(body) {
    this.body = body;
  }

  setRequestHeader(name, value) {
    this.headers[name] = value;
  }
}

function attachmentFile(contents = "hello") {
  return new File([contents], "notes.txt", {
    type: "text/plain"
  });
}

// The composer's waits between its twelve attempts: 1, 2 and 3 seconds, then 5 seconds before each of the rest.
const RETRY_WAITS_MS = [1_000, 2_000, 3_000, ...Array.from({ length: 8 }, () => 5_000)];
const UPLOAD_ATTEMPTS = RETRY_WAITS_MS.length + 1;
const UPLOAD_LOST_CONTACT = "Vibe64 could not be reached to upload this attachment. Check your connection and try again.";
const STORED_ATTACHMENT = Object.freeze({
  attachmentId: "attachment-1",
  fileName: "notes.txt",
  ok: true
});

// Answers the upload's requests in turn, one answer each, and checks that each next request goes out only once its
// whole wait has passed.
async function answerAttempts(answers) {
  for (const [attempt, answer] of answers.entries()) {
    expect(FakeXmlHttpRequest.instances).toHaveLength(attempt + 1);
    answer(FakeXmlHttpRequest.instances[attempt]);
    if (attempt + 1 === answers.length) return;
    await vi.advanceTimersByTimeAsync(RETRY_WAITS_MS[attempt] - 1);
    expect(FakeXmlHttpRequest.instances).toHaveLength(attempt + 1);
    await vi.advanceTimersByTimeAsync(1);
  }
}

function everyAttempt(answer) {
  return Array.from({ length: UPLOAD_ATTEMPTS }, () => answer);
}

const loseAnswer = (request) => request.failNetwork();
const store = (request) => request.respond(201, STORED_ATTACHMENT);

// No request goes out however long the upload is left once it has settled.
async function expectNoFurtherAttempt(attempts) {
  await vi.advanceTimersByTimeAsync(60_000);
  expect(FakeXmlHttpRequest.instances).toHaveLength(attempts);
}

describe("useVibe64CodexCommands attachment uploads", () => {
  beforeEach(() => {
    commandHarness.options.length = 0;
    commandHarness.run.mockReset();
    FakeXmlHttpRequest.instances.length = 0;
    vi.stubGlobal("XMLHttpRequest", FakeXmlHttpRequest);
  });

  it("uploads one file as authenticated same-origin multipart data", async () => {
    const commands = useVibe64CodexCommands();
    const file = attachmentFile();
    const upload = commands.uploadAttachment("session / one", file);
    const request = FakeXmlHttpRequest.instances[0];

    expect(request.method).toBe("POST");
    expect(request.url).toBe("/api/vibe64/sessions/session%20%2F%20one/agent-attachments");
    expect(request.withCredentials).toBe(true);
    expect(request.headers).toEqual({
      Accept: "application/json"
    });
    expect(request.body).toBeInstanceOf(FormData);
    expect(request.body.get("file")).toMatchObject({
      name: "notes.txt",
      size: file.size,
      type: "text/plain"
    });

    request.respond(201, {
      attachmentId: "attachment-1",
      fileName: "notes.txt",
      ok: true
    });
    await expect(upload).resolves.toEqual({
      attachmentId: "attachment-1",
      fileName: "notes.txt",
      ok: true
    });
  });

  it("scales multipart request progress to file bytes and clamps invalid bounds", async () => {
    const commands = useVibe64CodexCommands();
    const onProgress = vi.fn();
    const file = attachmentFile("0123456789");
    const upload = commands.uploadAttachment("session-1", file, {
      onProgress
    });
    const request = FakeXmlHttpRequest.instances[0];

    request.emitProgress(25, 100);
    request.emitProgress(-10, 100);
    request.emitProgress(120, 100);
    request.emitProgress(10, 0, false);

    expect(onProgress.mock.calls.map(([progress]) => progress)).toEqual([
      { bytesSent: 2, progress: 0.25, totalBytes: 10 },
      { bytesSent: 0, progress: 0, totalBytes: 10 },
      { bytesSent: 10, progress: 1, totalBytes: 10 },
      { bytesSent: 0, progress: null, totalBytes: 10 }
    ]);

    request.respond(200, { ok: true });
    await upload;
  });

  it("preserves structured HTTP failure details", async () => {
    const commands = useVibe64CodexCommands();
    const upload = commands.uploadAttachment("session-1", attachmentFile());
    const request = FakeXmlHttpRequest.instances[0];

    request.respond(413, {
      details: {
        maxBytes: 100_000_000
      },
      errors: [{
        code: "vibe64_agent_attachment_too_large",
        message: "Attachment file is too large."
      }],
      ok: false
    });

    await expect(upload).rejects.toMatchObject({
      code: "vibe64_agent_attachment_too_large",
      details: {
        maxBytes: 100_000_000
      },
      message: "Attachment file is too large.",
      status: 413,
      statusCode: 413
    });
  });

  it("aborts the active request through an AbortSignal", async () => {
    const commands = useVibe64CodexCommands();
    const controller = new AbortController();
    const upload = commands.uploadAttachment("session-1", attachmentFile(), {
      signal: controller.signal
    });
    const request = FakeXmlHttpRequest.instances[0];

    controller.abort();

    expect(request.aborted).toBe(true);
    await expect(upload).rejects.toMatchObject({
      message: "Attachment upload was cancelled.",
      name: "AbortError"
    });
  });

  it("removes a completed attachment through the established DELETE command", async () => {
    commandHarness.run.mockResolvedValue({ ok: true });
    const commands = useVibe64CodexCommands();
    const result = await commands.deleteAttachment(" session-1 ", " attachment / one ");
    const deleteOptions = commandHarness.options[0];

    expect(deleteOptions.placementSource).toBe("vibe64.agent-attachment.delete");
    expect(deleteOptions.buildCommandOptions({}, {
      context: {
        attachmentId: "attachment / one",
        sessionId: "session-1"
      }
    })).toEqual({
      method: "DELETE",
      path: "/api/vibe64/sessions/session-1/agent-attachments/attachment%20%2F%20one"
    });
    expect(commandHarness.run).toHaveBeenCalledWith({
      attachmentId: "attachment / one",
      sessionId: "session-1"
    });
    expect(result).toEqual({ ok: true });
  });

  describe("sending a file again", () => {
    beforeEach(() => {
      vi.useFakeTimers();
    });

    afterEach(() => {
      vi.useRealTimers();
    });

    it("reports a network failure after twelve attempts without manufacturing a server response", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const failure = upload.catch(error => error);

      await answerAttempts(everyAttempt(loseAnswer));

      const error = await failure;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(UPLOAD_LOST_CONTACT);
      expect(error).not.toHaveProperty("status");
      expect(error).not.toHaveProperty("response");
      await expectNoFurtherAttempt(UPLOAD_ATTEMPTS);
    });

    it("resolves with the stored attachment when a later attempt is answered after lost ones", async () => {
      const commands = useVibe64CodexCommands();
      const file = attachmentFile();
      const upload = commands.uploadAttachment("session-1", file);

      await answerAttempts([loseAnswer, loseAnswer, store]);

      await expect(upload).resolves.toEqual(STORED_ATTACHMENT);
      for (const request of FakeXmlHttpRequest.instances) {
        expect(request.method).toBe("POST");
        expect(request.url).toBe("/api/vibe64/sessions/session-1/agent-attachments");
        expect(request.body.get("file")).toMatchObject({ name: "notes.txt", size: file.size });
      }
      await expectNoFurtherAttempt(3);
    });

    it("sends the file again after a 5xx the server did not word, such as the hosted edge's page", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());

      await answerAttempts([
        (request) => request.respondText(504, "<html><body>504 Gateway Time-out</body></html>"),
        (request) => request.respondText(502, ""),
        (request) => request.respond(500, {}),
        store
      ]);

      await expect(upload).resolves.toEqual(STORED_ATTACHMENT);
      await expectNoFurtherAttempt(4);
    });

    it("says Vibe64 could not be reached after twelve 5xx answers the server did not word", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const failure = upload.catch(error => error);

      await answerAttempts(everyAttempt((request) => request.respondText(502, "")));

      const error = await failure;
      expect(error).toBeInstanceOf(Error);
      expect(error.message).toBe(UPLOAD_LOST_CONTACT);
      await expectNoFurtherAttempt(UPLOAD_ATTEMPTS);
    });

    it("says a refusal the server did not word without its HTTP status, and does not send it again", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const failure = upload.catch(error => error);

      FakeXmlHttpRequest.instances[0].respondText(
        413,
        "<html><head><title>413 Request Entity Too Large</title></head><body>413 Request Entity Too Large</body></html>"
      );

      const error = await failure;
      expect(error.message).toBe("Assistant attachment could not be uploaded.");
      expect(error.message).not.toMatch(/HTTP \d{3}/);
      expect(error).toMatchObject({ code: "", status: 413 });
      await expectNoFurtherAttempt(1);
    });

    it.each([
      ["vibe64_agent_write_mode_busy", "The workspace is being prepared. Try again when it is ready."],
      ["vibe64_agent_attachment_busy", "Attachment storage is busy. Try uploading the file again."]
    ])("sends the file again while it is refused as %s, then says the refusal's words", async (code, words) => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const failure = upload.catch(error => error);

      await answerAttempts(everyAttempt((request) => request.respond(409, {
        code,
        error: words,
        errors: [{ code, message: words }],
        ok: false,
        retryable: true
      })));

      expect(await failure).toMatchObject({ code, message: words, status: 409 });
      await expectNoFurtherAttempt(UPLOAD_ATTEMPTS);
    });

    it("sends the file again while it is answered with a busy refusal, then answers with the refusal's words", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const refusal = {
        code: "vibe64_agent_write_mode_busy",
        error: "This session is being saved. Try again when Save finishes.",
        ok: false
      };

      await answerAttempts(everyAttempt((request) => request.respond(200, refusal)));

      await expect(upload).resolves.toEqual(refusal);
      await expectNoFurtherAttempt(UPLOAD_ATTEMPTS);
    });

    it("stores the file once a busy refusal clears", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());

      await answerAttempts([
        (request) => request.respond(409, {
          code: "vibe64_agent_write_mode_busy",
          error: "This session is being updated. Try again when Update finishes.",
          ok: false
        }),
        (request) => request.respond(200, {
          code: "vibe64_agent_attachment_busy",
          error: "Attachment storage is busy. Try uploading the file again.",
          ok: false
        }),
        store
      ]);

      await expect(upload).resolves.toEqual(STORED_ATTACHMENT);
      await expectNoFurtherAttempt(3);
    });

    it.each([
      ["a refusal the server worded", 409, {
        code: "vibe64_agent_attachment_session_unavailable",
        error: "This session is closing. Attachments cannot be added now.",
        ok: false
      }],
      ["a 5xx the server worded", 500, {
        code: "vibe64_request_failed",
        error: "Vibe64 request failed.",
        errors: [{ code: "vibe64_request_failed", message: "Vibe64 request failed." }],
        ok: false
      }]
    ])("does not send the file again after %s", async (_label, status, payload) => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const failure = upload.catch(error => error);

      FakeXmlHttpRequest.instances[0].respond(status, payload);

      expect(await failure).toMatchObject({ code: payload.code, message: payload.error, status });
      await expectNoFurtherAttempt(1);
    });

    it("answers at once with a refusal that is not busy", async () => {
      const commands = useVibe64CodexCommands();
      const upload = commands.uploadAttachment("session-1", attachmentFile());
      const refusal = {
        code: "vibe64_agent_attachment_session_unavailable",
        error: "This session is closing. Attachments cannot be added now.",
        ok: false
      };

      FakeXmlHttpRequest.instances[0].respond(200, refusal);

      await expect(upload).resolves.toEqual(refusal);
      await expectNoFurtherAttempt(1);
    });

    it("stops sending the file when it is cancelled during a wait", async () => {
      const commands = useVibe64CodexCommands();
      const controller = new AbortController();
      const upload = commands.uploadAttachment("session-1", attachmentFile(), {
        signal: controller.signal
      });
      const failure = upload.catch(error => error);

      FakeXmlHttpRequest.instances[0].failNetwork();
      await vi.advanceTimersByTimeAsync(500);
      controller.abort();
      await expectNoFurtherAttempt(1);

      expect(await failure).toMatchObject({
        message: "Attachment upload was cancelled.",
        name: "AbortError"
      });
    });
  });
});
