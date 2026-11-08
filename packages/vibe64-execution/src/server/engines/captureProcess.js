import { spawn } from "node:child_process";
import { statSync } from "node:fs";
import path from "node:path";
import { StringDecoder } from "node:string_decoder";
import { stripVTControlCharacters } from "node:util";

// The defaults capture commands had while they ran through execa 9, kept so
// results and messages stay the same: output limit per stream, and the delay
// before a timed-out command that ignores SIGTERM gets SIGKILL.
const DEFAULT_MAX_BUFFER = 100_000_000;
const FORCE_KILL_DELAY_MS = 5_000;
const SIGNAL_DESCRIPTIONS = Object.freeze({
  SIGABRT: "Aborted",
  SIGALRM: "Timeout or timer",
  SIGHUP: "Terminal closed",
  SIGINT: "User interruption with CTRL-C",
  SIGKILL: "Forced termination",
  SIGPIPE: "Broken pipe or socket",
  SIGQUIT: "User interruption with CTRL-\\",
  SIGSEGV: "Segmentation fault",
  SIGTERM: "Termination",
  SIGUSR1: "Application-specific signal",
  SIGUSR2: "Application-specific signal"
});
const PLAIN_ARGUMENT = /^[\w./-]+$/u;
const SPECIAL_CHARACTER = /\p{Separator}|\p{Other}/gu;
const COMMON_ESCAPES = Object.freeze({ " ": " ", "\b": "\\b", "\f": "\\f", "\n": "\\n", "\r": "\\r", "\t": "\\t" });

function escapeControlCharacters(line) {
  return line.replaceAll(SPECIAL_CHARACTER, (character) => {
    if (COMMON_ESCAPES[character] !== undefined) return COMMON_ESCAPES[character];
    const codepoint = character.codePointAt(0);
    return codepoint <= 0xffff ? `\\u${codepoint.toString(16).padStart(4, "0")}` : `\\U${codepoint.toString(16)}`;
  });
}

function escapeLines(text) {
  return stripVTControlCharacters(text).split("\n").map(escapeControlCharacters).join("\n");
}

/** The command line as failure messages show it: each argument quoted only when it needs it. */
function escapedCommandLine(command, args) {
  return [command, ...args].map((part) => {
    const escaped = escapeControlCharacters(String(part));
    if (PLAIN_ARGUMENT.test(escaped)) return escaped;
    return process.platform === "win32"
      ? `"${escaped.replaceAll("\"", "\"\"")}"`
      : `'${escaped.replaceAll("'", "'\\''")}'`;
  }).join(" ");
}

// A missing working directory makes spawn report the command as missing;
// name the directory as well.
function spawnFailureDetail(error, cwd) {
  const message = String(error?.message ?? error);
  if (cwd === process.cwd()) return message;
  try {
    if (!statSync(cwd).isDirectory()) return `The "cwd" option is not a directory: ${cwd}.\n${message}`;
  } catch (statError) {
    return `The "cwd" option is invalid: ${cwd}.\n${statError.message}\n${message}`;
  }
  return message;
}

function failurePrefix(failure) {
  const forceful = failure.forcefullyTerminated
    ? ` and was forcefully terminated after ${FORCE_KILL_DELAY_MS} milliseconds`
    : "";
  if (failure.timedOut) return `Command timed out after ${failure.timeout} milliseconds${forceful}`;
  if (failure.maxBuffer) {
    return `Command's ${failure.maxBuffer.stream} was larger than ${failure.maxBuffer.limit} ${failure.maxBuffer.unit}${forceful}`;
  }
  if (failure.spawnError?.code !== undefined) return `Command failed with ${failure.spawnError.code}${forceful}`;
  if (failure.signal) {
    const description = SIGNAL_DESCRIPTIONS[failure.signal];
    return `Command was killed with ${failure.signal}${description ? ` (${description})` : ""}`;
  }
  if (failure.exitCode !== undefined) return `Command failed with exit code ${failure.exitCode}`;
  return "Command failed";
}

/** The one-line failure summary capture results carry as their error. */
function failureMessage(failure) {
  const detail = failure.spawnError ? escapeLines(spawnFailureDetail(failure.spawnError, failure.cwd))
    : failure.maxBuffer ? "maxBuffer exceeded" : "";
  return `${failurePrefix(failure)}: ${failure.commandLine}${detail ? `\n${detail}` : ""}`;
}

/**
 * One stream's captured text, decoded as it arrives so a character split
 * between chunks stays whole, and cut at its limit.
 */
function capturedText(encoding, limit) {
  const decoder = new StringDecoder(encoding);
  const parts = [];
  let length = 0;
  let full = false;
  return {
    /** @returns {boolean} false once the text reached its limit and stopped growing. */
    write(chunk) {
      if (full) return false;
      const text = decoder.write(chunk);
      if (length + text.length > limit) {
        parts.push(text.slice(0, limit - length));
        length = limit;
        full = true;
        return false;
      }
      parts.push(text);
      length += text.length;
      return true;
    },
    text() {
      if (!full) {
        const rest = decoder.end();
        if (rest) parts.push(rest.slice(0, limit - length));
        full = true;
      }
      return parts.join("");
    }
  };
}

/**
 * Starts a command with its output captured, its own process group (outside
 * Windows) and a timeout. stdout, stderr and both interleaved are decoded in
 * outputEncoding; a stream stops being read at maxBuffer characters, and the
 * command then fails. completion settles once the command has exited and its
 * output has closed, and never rejects.
 * @param {string} command
 * @param {string[]} args
 * @param {{ cwd?: string, env?: Record<string, string>, input?: string | Uint8Array | null,
 *   maxBuffer?: number, onOutput?: ((text: string) => void) | null, outputEncoding?: BufferEncoding,
 *   timeout?: number }} [options]
 */
function startCaptureProcess(command, args, {
  cwd = "",
  env = {},
  input = undefined,
  maxBuffer = DEFAULT_MAX_BUFFER,
  onOutput = null,
  outputEncoding = "utf8",
  timeout = 0
} = {}) {
  const limit = Number.isSafeInteger(maxBuffer) && maxBuffer > 0 ? maxBuffer : DEFAULT_MAX_BUFFER;
  const output = {
    all: capturedText(outputEncoding, limit * 2),
    stderr: capturedText(outputEncoding, limit),
    stdout: capturedText(outputEncoding, limit)
  };
  const hasInput = input !== undefined && input !== null;
  const child = spawn(command, args, {
    cwd: cwd || undefined,
    detached: process.platform !== "win32",
    env,
    stdio: [hasInput ? "pipe" : "ignore", "pipe", "pipe"],
    windowsHide: true
  });
  const failure = {
    commandLine: escapedCommandLine(command, args),
    cwd: path.resolve(cwd || "."),
    forcefullyTerminated: false,
    maxBuffer: null,
    spawnError: null,
    timedOut: false,
    timeout
  };
  let exited = false;
  let forceKillTimer = null;
  let settle = () => {};
  // Registered before anything else can throw: an unhandled "error" event
  // would end the server. A spawn failure arrives here, and so does a
  // signal the operating system refused.
  child.on("error", (error) => {
    failure.spawnError ||= error;
    // A command that never started has no output to wait for.
    if (child.pid === undefined) settle();
  });
  const terminate = () => {
    if (exited || !child.kill("SIGTERM") || forceKillTimer) return;
    forceKillTimer = setTimeout(() => {
      if (!exited && child.kill("SIGKILL")) failure.forcefullyTerminated = true;
    }, FORCE_KILL_DELAY_MS);
  };
  const capture = (name, stream) => (chunk) => {
    output.all.write(chunk);
    if (!output[name].write(chunk)) {
      failure.maxBuffer ||= { limit, stream: name, unit: "characters" };
      // Reading stops, so a command that keeps writing ends on SIGPIPE. One
      // that stops writing keeps running until it exits or times out.
      stream.destroy();
    }
    if (typeof onOutput === "function") {
      try {
        onOutput(String(chunk || ""));
      } catch {
        // Output observers must not change command execution semantics.
      }
    }
  };
  // Streams are missing only when spawn could not even set them up.
  if (child.stdout) child.stdout.on("data", capture("stdout", child.stdout));
  if (child.stderr) child.stderr.on("data", capture("stderr", child.stderr));
  if (hasInput && child.stdin) {
    // A command that exits without reading its input is not a failure.
    child.stdin.on("error", () => {});
    child.stdin.end(input);
  }
  const timeoutTimer = timeout > 0 ? setTimeout(() => {
    failure.timedOut = true;
    terminate();
  }, timeout) : null;
  const completion = new Promise((resolve) => {
    settle = (exitCode, signal) => {
      if (exited) return;
      exited = true;
      clearTimeout(timeoutTimer);
      clearTimeout(forceKillTimer);
      const ended = failure.spawnError ? {} : {
        exitCode: typeof exitCode === "number" && exitCode >= 0 ? exitCode : undefined,
        signal: signal || undefined
      };
      const failed = failure.spawnError || failure.timedOut || failure.maxBuffer || ended.exitCode !== 0;
      resolve({
        all: output.all.text(),
        code: failure.spawnError?.code,
        exitCode: ended.exitCode,
        shortMessage: failed ? failureMessage({ ...failure, ...ended }) : "",
        signal: ended.signal,
        stderr: output.stderr.text(),
        stdout: output.stdout.text(),
        timedOut: failure.timedOut
      });
    };
    child.once("close", settle);
  });
  return {
    completion,
    kill: (signal) => child.kill(signal),
    pid: child.pid
  };
}

export { startCaptureProcess };
