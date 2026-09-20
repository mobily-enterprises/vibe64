import { randomUUID } from "node:crypto";
import { TextDecoder } from "node:util";

const CLAUDE_JSON_MAX_FRAME_BYTES = 16 * 1024 * 1024;

function claudeProtocolError(message, code = "vibe64_claude_protocol_error") {
  return Object.assign(new Error(message), { code });
}

// Geometric growth keeps fragmented frames linear with bounded memory. Decode complete
// frames, so a UTF-8 character split across pipe reads is never corrupted.
async function* readClaudeJsonFrames(stream, { maxFrameBytes = CLAUDE_JSON_MAX_FRAME_BYTES, allowIncompleteTail = false } = {}) {
  if (!Number.isSafeInteger(maxFrameBytes) || maxFrameBytes < 1) {
    throw new TypeError("Claude JSON frame limits must be positive integers.");
  }
  const decoder = new TextDecoder("utf-8", { fatal: true });
  let buffer = Buffer.alloc(0);
  let length = 0;
  function append(part) {
    const required = length + part.length;
    if (required > maxFrameBytes) throw claudeProtocolError("Claude JSON frame exceeded its size limit.");
    if (required > buffer.length) {
      const next = Buffer.allocUnsafe(Math.min(maxFrameBytes, Math.max(required, buffer.length * 2, 4096)));
      buffer.copy(next, 0, 0, length);
      buffer = next;
    }
    part.copy(buffer, length);
    length = required;
  }
  function parse(bytes) {
    let frame;
    try {
      const line = decoder.decode(bytes).trim();
      if (!line) return null;
      frame = JSON.parse(line);
    } catch {
      // Never include the frame: it can contain prompts, tool results, or secrets.
      throw claudeProtocolError("Claude returned invalid UTF-8 or JSON.");
    }
    if (!frame || typeof frame !== "object" || Array.isArray(frame) || typeof frame.type !== "string") {
      throw claudeProtocolError("Claude returned a JSON frame without an event type.");
    }
    return frame;
  }
  for await (const input of stream) {
    const chunk = Buffer.isBuffer(input) ? input : Buffer.from(input);
    let offset = 0;
    for (let end = chunk.indexOf(10, offset); end !== -1; end = chunk.indexOf(10, offset)) {
      const part = chunk.subarray(offset, end);
      if (length + part.length > maxFrameBytes) throw claudeProtocolError("Claude JSON frame exceeded its size limit.");
      if (length) append(part);
      const bytes = length ? buffer.subarray(0, length) : part;
      length = 0;
      const frame = parse(bytes);
      if (frame) yield frame;
      offset = end + 1;
    }
    append(chunk.subarray(offset));
  }
  // A truncated write is not a complete protocol frame, even if it parses.
  if (length && !allowIncompleteTail) throw claudeProtocolError("Claude JSON stream ended in an incomplete frame.");
}

function createClaudeJsonClient({ stream, onEvent = async () => {}, onFailure = async () => {}, timeoutMs = 60_000 } = {}) {
  const requests = new Map();
  let failure = null;
  let closed = false;
  let writes = Promise.resolve();

  function fail(error) {
    failure ||= error;
    for (const pending of requests.values()) pending.reject(failure);
    requests.clear();
    stream.destroy();
  }

  function write(frame) {
    const payload = `${JSON.stringify(frame)}\n`;
    if (Buffer.byteLength(payload) > CLAUDE_JSON_MAX_FRAME_BYTES) {
      return Promise.reject(claudeProtocolError("Claude input exceeded its size limit."));
    }
    const next = writes.then(() => new Promise((resolve, reject) => {
      if (failure || closed || stream.destroyed) {
        reject(failure || claudeProtocolError("Claude connection is closed."));
        return;
      }
      // A write callback, unlike write()'s boolean return, respects backpressure
      // and reports EPIPE. A completed write is NOT an admission acknowledgement.
      stream.write(payload, (error) => error ? reject(error) : resolve());
    }));
    writes = next.catch((error) => { fail(error); });
    return next;
  }

  async function request(request, options = {}) {
    if (failure || closed) throw failure || claudeProtocolError("Claude connection is closed.");
    const requestId = randomUUID();
    let timer;
    const response = new Promise((resolve, reject) => {
      timer = setTimeout(() => {
        requests.delete(requestId);
        reject(claudeProtocolError(`Claude ${request.subtype} timed out.`, "vibe64_claude_control_timeout"));
      }, options.timeoutMs ?? timeoutMs);
      requests.set(requestId, { resolve, reject });
    });
    // Install both observers before a write can fail or an immediate reply arrives.
    try {
      const [, result] = await Promise.all([
        write({ type: "control_request", request_id: requestId, request }), response
      ]);
      return result;
    } finally {
      clearTimeout(timer);
      requests.delete(requestId);
    }
  }

  const completion = (async () => {
    try {
      for await (const frame of readClaudeJsonFrames(stream)) {
        if (frame.type === "control_response") {
          const response = frame.response;
          const pending = requests.get(response?.request_id);
          if (!pending) continue; // A timed-out request may still get a reply.
          requests.delete(response.request_id);
          if (response.subtype === "success") pending.resolve(response.response || {});
          else pending.reject(claudeProtocolError(String(response.error || "Claude control request failed.")));
        } else if (frame.type === "control_request") {
          // Headless permissions must never hang waiting for an invisible prompt.
          // Native permission configuration remains authoritative; no auto-allow.
          await write({ type: "control_response", response: {
            subtype: "error", request_id: frame.request_id,
            error: "This control request requires the native Claude Code terminal."
          } });
        } else {
          await onEvent(frame);
        }
      }
      if (!closed) throw claudeProtocolError("Claude event connection ended unexpectedly.", "vibe64_claude_observation_lost");
    } catch (error) {
      if (!closed) {
        fail(error);
        await onFailure(error);
      }
    } finally {
      fail(failure || claudeProtocolError("Claude connection is closed."));
    }
  })();
  // Callers can await completion; the background observer must never leak an
  // unhandled rejection if their failure callback itself fails.
  void completion.catch(() => {});

  return Object.freeze({
    completion,
    initialize: () => request({ subtype: "initialize" }),
    interrupt: () => request({ subtype: "interrupt" }, { timeoutMs: 5_000 }),
    request,
    send(message, { messageId = randomUUID(), sessionId = "" } = {}) {
      return write({ type: "user", uuid: messageId, session_id: sessionId,
        parent_tool_use_id: null, message: { role: "user", content: message } });
    },
    close() {
      closed = true;
      fail(claudeProtocolError("Claude connection was closed."));
    }
  });
}

export { CLAUDE_JSON_MAX_FRAME_BYTES, createClaudeJsonClient, readClaudeJsonFrames };
