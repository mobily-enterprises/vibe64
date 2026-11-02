function normalizeEventName(value = "") {
  return String(value || "").trim().replace(/[^A-Za-z0-9._-]/gu, "-");
}

function defaultEventStreamErrorPayload(error) {
  return {
    error: String(error?.message || error || "Vibe64 event stream failed.")
  };
}

async function sendVibe64EventStream(reply, run, options = {}) {
  const {
    errorEvent = "",
    errorPayload = defaultEventStreamErrorPayload,
    heartbeatMs = 15000,
    retryMs = 3000
  } = options;
  if (!reply?.raw) {
    throw new Error("Vibe64 event streams require a Fastify reply with raw stream access.");
  }
  if (typeof run !== "function") {
    throw new TypeError("sendVibe64EventStream requires run().");
  }

  // readable-check: allow optional-call - platform object: a reply stand-in without hijack() streams through raw directly
  reply.hijack?.();

  const rawReply = reply.raw;
  const closeHandlers = new Set();
  let closed = false;

  function runCloseHandler(handler) {
    try {
      handler();
    } catch {
      // Connection cleanup must continue even if one resource has already failed.
    }
  }

  function closeStream() {
    if (closed) {
      return;
    }
    closed = true;
    const handlers = [...closeHandlers];
    closeHandlers.clear();
    for (const handler of handlers) {
      runCloseHandler(handler);
    }
  }

  function emit(event, payload = {}) {
    const eventName = normalizeEventName(event);
    if (closed || !eventName) {
      return;
    }
    rawReply.write(`event: ${eventName}\n`);
    rawReply.write(`data: ${JSON.stringify(payload)}\n\n`);
  }

  // readable-check: allow optional-call - platform object: a raw reply stand-in may not emit close
  rawReply.on?.("close", closeStream);
  rawReply.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  if (Number(retryMs) > 0) {
    rawReply.write(`retry: ${Math.floor(Number(retryMs))}\n`);
  }
  rawReply.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    if (!closed) {
      rawReply.write(": heartbeat\n\n");
    }
  }, Math.max(1000, Number(heartbeatMs) || 15000));
  heartbeat.unref();

  try {
    await run({
      emit,
      isClosed: () => closed,
      /**
       * @param {() => void} handler
       */
      onClose(handler) {
        if (closed) {
          runCloseHandler(handler);
          return;
        }
        closeHandlers.add(handler);
      }
    });
  } catch (error) {
    if (errorEvent) {
      emit(errorEvent, errorPayload(error));
    }
  } finally {
    clearInterval(heartbeat);
    // readable-check: allow optional-call - platform object: a raw reply stand-in may not emit close
    rawReply.off?.("close", closeStream);
    const clientDisconnected = closed;
    closeStream();
    if (!clientDisconnected && !rawReply.destroyed && !rawReply.writableEnded) {
      rawReply.end();
    }
  }
}

export {
  sendVibe64EventStream
};
