import crypto from "node:crypto";
import { execa } from "execa";
import process from "node:process";

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/u.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function stableHash(value) {
  return crypto
    .createHash("sha256")
    .update(String(value || ""))
    .digest("hex")
    .slice(0, 12);
}

function normalizeRunResult(result = {}) {
  const stdout = String(result.stdout || "");
  const stderr = String(result.stderr || "");
  const output = String(result.all || [stdout, stderr].filter(Boolean).join("\n")).trim();

  return {
    exitCode: result.exitCode,
    ok: result.exitCode === 0,
    output,
    stderr: stderr.trim(),
    stdout: stdout.trim()
  };
}

function emitCommandOutput(onOutput = null, chunk = "") {
  if (typeof onOutput !== "function") {
    return;
  }
  try {
    onOutput(String(chunk || ""));
  } catch {
    // Output observers must not change command execution semantics.
  }
}

async function runHostCommand(command, args, {
  cwd,
  env,
  input,
  onOutput = null,
  timeout = 15_000
} = {}) {
  const commandEnv = env && typeof env === "object" && !Array.isArray(env)
    ? {
        ...process.env,
        ...env
      }
    : process.env;
  try {
    const subprocess = execa(command, args, {
      all: true,
      cwd,
      env: commandEnv,
      input,
      reject: false,
      timeout
    });
    if (typeof onOutput === "function" && subprocess.all) {
      subprocess.all.on("data", (chunk) => {
        emitCommandOutput(onOutput, chunk);
      });
    }
    const result = await subprocess;
    return normalizeRunResult(result);
  } catch (error) {
    return {
      exitCode: typeof error.exitCode === "number" ? error.exitCode : 1,
      ok: false,
      output: String(error.all || error.message || "").trim(),
      stderr: String(error.stderr || "").trim(),
      stdout: String(error.stdout || "").trim()
    };
  }
}

export {
  normalizeRunResult,
  runHostCommand,
  shellQuote,
  stableHash
};
