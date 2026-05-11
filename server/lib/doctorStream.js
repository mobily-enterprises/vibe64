function nowIso() {
  return new Date().toISOString();
}

function writeStreamEvent(rawReply, event, payload = {}) {
  rawReply.write(`event: ${event}\n`);
  rawReply.write(`data: ${JSON.stringify({
    ...payload,
    at: payload.at || nowIso()
  })}\n\n`);
}

async function runDoctorStep({
  emit,
  id,
  label,
  run
}) {
  emit("check.started", {
    id,
    label
  });

  try {
    const result = await run();
    emit("check.finished", {
      check: result,
      id: result?.id || id,
      label: result?.label || label,
      status: result?.status || "unknown"
    });
    return result;
  } catch (error) {
    emit("check.error", {
      error: String(error?.message || error || "Check failed."),
      id,
      label
    });
    throw error;
  }
}

async function sendDoctorEventStream(reply, run) {
  if (!reply?.raw) {
    throw new Error("sendDoctorEventStream requires a Fastify reply with raw stream access.");
  }

  reply.hijack?.();

  const rawReply = reply.raw;
  let closed = false;
  const markClosed = () => {
    closed = true;
  };

  rawReply.on?.("close", markClosed);
  rawReply.writeHead(200, {
    "Cache-Control": "no-cache, no-transform",
    "Connection": "keep-alive",
    "Content-Type": "text/event-stream; charset=utf-8",
    "X-Accel-Buffering": "no"
  });
  rawReply.write("retry: 600000\n");
  rawReply.write(": connected\n\n");

  const heartbeat = setInterval(() => {
    if (!closed) {
      rawReply.write(": heartbeat\n\n");
    }
  }, 15000);
  heartbeat.unref?.();

  const emit = (event, payload = {}) => {
    if (!closed) {
      writeStreamEvent(rawReply, event, payload);
    }
  };

  try {
    emit("run.started", {});
    const status = await run({
      emit,
      runStep: (step) => runDoctorStep({
        emit,
        ...step
      })
    });
    emit("run.finished", {
      status
    });
  } catch (error) {
    emit("run.error", {
      error: String(error?.message || error || "Doctor stream failed.")
    });
  } finally {
    clearInterval(heartbeat);
    rawReply.off?.("close", markClosed);
    if (!closed) {
      rawReply.end();
    }
  }
}

export {
  runDoctorStep,
  sendDoctorEventStream
};
