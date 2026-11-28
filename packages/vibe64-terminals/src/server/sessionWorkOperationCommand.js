import { runCaptureCommand } from "@local/vibe64-execution/server/capture";
import { configureVibe64Host } from "@local/vibe64-execution/server/hostProfile";
import { performSessionWorkOperation, sessionWorkOperationFailure } from "./sessionWorkOperations.js";

const MAX_INPUT_BYTES = 1024 * 1024;

// Each Git command runs in its own process group, which a stop of this process does not reach. A stage
// Cancel can stop (`stoppable`) stops them itself when it is stopped, and then answers as they fail.
const stopping = new AbortController();

function runLocalCommand(request = {}) {
  return runCaptureCommand(request.command, request.args, {
    cwd: request.cwd,
    env: {
      ...process.env,
      ...(request.env || {})
    },
    execution: request.execution,
    input: request.input,
    maxBuffer: request.maxBuffer,
    outputEncoding: request.outputEncoding,
    signal: stopping.signal,
    timeout: request.timeout
  });
}

async function readInput() {
  let serialized = "";
  for await (const chunk of process.stdin) {
    serialized += String(chunk || "");
    if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) {
      throw new Error("Session repository operation input is too large.");
    }
  }
  return JSON.parse(serialized || "{}");
}

try {
  const payload = await readInput();
  if (payload?.stoppable === true) process.once("SIGTERM", () => stopping.abort());
  configureVibe64Host(payload?.hostProfile || null);
  const response = await performSessionWorkOperation(payload, { runCommand: runLocalCommand });
  process.stdout.write(JSON.stringify(response));
  if (!response.ok) process.exitCode = 1;
} catch (error) {
  process.stdout.write(JSON.stringify(sessionWorkOperationFailure(error)));
  process.exitCode = 1;
}
