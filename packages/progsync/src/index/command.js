import { spawn } from "node:child_process";
import path from "node:path";

function commandEnvironment(command, explicitEnvironment) {
  const commandName = path.basename(String(command)).toLowerCase();
  const isGit = commandName === "git" || commandName === "git.exe";
  const inheritedEnvironment = isGit
    ? Object.fromEntries(Object.entries(process.env).filter(([name]) => (
      !name.toUpperCase().startsWith("GIT_")
    )))
    : process.env;
  return { ...inheritedEnvironment, ...explicitEnvironment };
}

function commandFailure(command, args, result) {
  const error = new Error(
    result.error || `${command} ${args.join(" ")} exited with status ${result.exitCode}.`
  );
  error.code = result.exitCode;
  error.exitCode = result.exitCode;
  error.output = result.output;
  error.signal = result.signal;
  error.stderr = result.stderr;
  error.stdout = result.stdout;
  error.timedOut = result.timedOut;
  return error;
}

async function runProgSyncCommand(command, args = [], {
  cwd = process.cwd(),
  env = {},
  input = undefined,
  maxBuffer = 32 * 1024 * 1024,
  onOutput = null,
  forwardSignals = false,
  reject = true,
  timeout = undefined
} = {}) {
  const result = await new Promise((resolve) => {
    const ownsProcessGroup = process.platform !== "win32";
    const child = spawn(command, args, {
      cwd,
      detached: ownsProcessGroup,
      env: commandEnvironment(command, env),
      shell: false,
      stdio: ["pipe", "pipe", "pipe"]
    });
    const stdout = [];
    const stderr = [];
    let capturedBytes = 0;
    let overflow = false;
    let timedOut = false;
    let timer = null;
    let terminationError = null;
    let interruptedSignal = null;
    let settled = false;

    const terminate = () => {
      try {
        if (ownsProcessGroup && child.pid) {
          process.kill(-child.pid, "SIGKILL");
        } else {
          child.kill("SIGKILL");
        }
      } catch (error) {
        if (error?.code === "ESRCH") {
          return null;
        }
        child.kill("SIGKILL");
        return error.message;
      }
      return null;
    };

    const signalHandlers = new Map();
    const removeSignalHandlers = () => {
      for (const [signal, handler] of signalHandlers) {
        process.removeListener(signal, handler);
      }
    };
    const finish = (value) => {
      if (settled) {
        return;
      }
      settled = true;
      if (timer) {
        clearTimeout(timer);
      }
      removeSignalHandlers();
      resolve(value);
      if (interruptedSignal) {
        setImmediate(() => process.kill(process.pid, interruptedSignal));
      }
    };
    if (forwardSignals) {
      for (const signal of ["SIGINT", "SIGTERM"]) {
        const handler = () => {
          interruptedSignal ||= signal;
          terminationError ||= terminate();
        };
        signalHandlers.set(signal, handler);
        process.once(signal, handler);
      }
    }

    const capture = (target) => (chunk) => {
      capturedBytes += chunk.length;
      if (capturedBytes > maxBuffer) {
        overflow = true;
        terminationError ||= terminate();
        return;
      }
      target.push(chunk);
      onOutput?.(chunk.toString("utf8"));
    };
    child.stdout.on("data", capture(stdout));
    child.stderr.on("data", capture(stderr));

    if (timeout !== undefined) {
      timer = setTimeout(() => {
        timedOut = true;
        terminationError ||= terminate();
      }, timeout);
      timer.unref?.();
    }

    child.on("error", (error) => {
      finish({
        error: error.message,
        exitCode: null,
        ok: false,
        output: "",
        signal: null,
        stderr: "",
        stdout: "",
        timedOut
      });
    });
    child.on("close", (exitCode, signal) => {
      const stdoutText = Buffer.concat(stdout).toString("utf8");
      const stderrText = Buffer.concat(stderr).toString("utf8");
      finish({
        error: terminationError || (overflow
          ? `Command output exceeded ${maxBuffer} bytes.`
          : timedOut
            ? `Command timed out after ${timeout}ms.`
            : null),
        exitCode,
        ok: !interruptedSignal && !overflow && !timedOut && exitCode === 0,
        output: `${stdoutText}${stderrText}`,
        signal,
        stderr: stderrText,
        stdout: stdoutText,
        timedOut
      });
    });

    if (input !== undefined && input !== null) {
      child.stdin.end(String(input));
    } else {
      child.stdin.end();
    }
  });

  if (!result.ok && reject) {
    throw commandFailure(command, args, result);
  }
  return result;
}

export {
  runProgSyncCommand
};
