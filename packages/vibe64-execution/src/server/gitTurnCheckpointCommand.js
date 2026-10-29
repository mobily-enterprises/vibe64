// The child side of createGitTurnCheckpointAsOneJob(): it runs the checkpoint's
// git sequence directly, inside the one command the daemon started, with that
// command's resolved env (HOME, PATH, safe directories and commit identity).
import { runCaptureCommand } from "./engines/capture.js";
import { createGitTurnCheckpoint } from "./gitTurnCheckpoint.js";
import { configureVibe64Host } from "./hostProfile.js";
import { DEFAULT_COMMAND_MAX_BUFFER_BYTES } from "./request.js";

const MAX_INPUT_BYTES = 64 * 1024;

function runLocalCommand(request = {}) {
  return runCaptureCommand(request.command, request.args, {
    cwd: request.cwd,
    env: {
      ...process.env,
      ...(request.env || {})
    },
    input: request.input,
    maxBuffer: DEFAULT_COMMAND_MAX_BUFFER_BYTES,
    timeout: request.timeout
  });
}

async function readInput() {
  let serialized = "";
  for await (const chunk of process.stdin) {
    serialized += String(chunk || "");
    if (Buffer.byteLength(serialized) > MAX_INPUT_BYTES) {
      throw new Error("Checkpoint input is too large.");
    }
  }
  return JSON.parse(serialized || "{}");
}

try {
  const payload = await readInput();
  configureVibe64Host(payload?.hostProfile || null);
  const input = payload?.input && typeof payload.input === "object" ? payload.input : {};
  const value = await createGitTurnCheckpoint({ ...input, runCommand: runLocalCommand });
  process.stdout.write(JSON.stringify({ ok: true, value }));
} catch (error) {
  process.stdout.write(JSON.stringify({
    error: {
      code: String(error?.code || "vibe64_checkpoint_failed"),
      message: String(error?.message || "Vibe64 turn checkpoint failed.")
    },
    ok: false
  }));
  process.exitCode = 1;
}
