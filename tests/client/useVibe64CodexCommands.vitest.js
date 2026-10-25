import { beforeEach, describe, expect, it, vi } from "vitest";

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
    this.status = status;
    this.responseText = JSON.stringify(payload);
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

  it("reports a network failure without manufacturing a server response", async () => {
    const commands = useVibe64CodexCommands();
    const upload = commands.uploadAttachment("session-1", attachmentFile());

    FakeXmlHttpRequest.instances[0].failNetwork();

    await expect(upload).rejects.toThrow(
      "Assistant attachment could not be uploaded. Check your connection and try again."
    );
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
});
