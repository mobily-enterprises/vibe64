import {
  runVibe64Command
} from "@local/vibe64-execution/server";
import path from "node:path";

function runtimesForCommand(command) {
  const commandName = path.basename(String(command || ""));
  if (commandName === "git") {
    return ["git"];
  }
  if (commandName === "node") {
    return ["node26"];
  }
  if (commandName === "codex") {
    return ["operator-clis", "node26"];
  }
  return [];
}

function commandFailure(command, args, result) {
  const error = new Error(
    result.error || `${command} ${args.join(" ")} exited with status ${result.exitCode}.`
  );
  error.code = result.exitCode;
  error.commandCode = result.code;
  error.exitCode = result.exitCode;
  error.output = result.output;
  error.signal = result.signal;
  error.stderr = result.stderr;
  error.stdout = result.stdout;
  error.timedOut = result.timedOut;
  return error;
}

function decodeBase64Output(value) {
  const source = String(value || "");
  if (!source || source.length % 4 !== 0 || !/^[A-Za-z0-9+/]*={0,2}$/u.test(source)) {
    return source;
  }
  return Buffer.from(source, "base64").toString("utf8");
}

async function runProgSyncCommand(command, args = [], {
  allowedRoots = [],
  cwd = process.cwd(),
  env = {},
  input = undefined,
  maxBuffer = undefined,
  onOutput = null,
  outputEncoding = "utf8",
  reject = true,
  timeout = undefined
} = {}) {
  const rawResult = await runVibe64Command({
    actor: "app",
    allowedRoots: allowedRoots.length > 0 ? allowedRoots : [cwd],
    args,
    command,
    cwd,
    env,
    envPolicy: "project",
    input,
    maxBuffer,
    mode: "capture",
    onOutput,
    outputEncoding,
    purpose: "adapter",
    runtimes: runtimesForCommand(command),
    timeout
  });
  const result = outputEncoding === "base64"
    ? {
        ...rawResult,
        output: decodeBase64Output(rawResult.output),
        stderr: decodeBase64Output(rawResult.stderr),
        stdout: decodeBase64Output(rawResult.stdout)
      }
    : rawResult;
  if (!result.ok && reject) {
    throw commandFailure(command, args, result);
  }
  return result;
}

export {
  runProgSyncCommand
};
