import crypto from "node:crypto";
import { execa } from "execa";
import process from "node:process";

import {
  STUDIO_HOST_GID_ENV,
  STUDIO_HOST_UID_ENV
} from "./studioRuntimeIdentity.js";

function shellQuote(value) {
  const stringValue = String(value);
  if (/^[A-Za-z0-9_./:=@,+-]+$/u.test(stringValue)) {
    return stringValue;
  }
  return `'${stringValue.replaceAll("'", "'\\''")}'`;
}

function dockerCommand(args) {
  return ["docker", ...args].map(shellQuote).join(" ");
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

async function runHostCommand(command, args, {
  cwd,
  env,
  input,
  timeout = 15_000
} = {}) {
  const commandEnv = env && typeof env === "object" && !Array.isArray(env)
    ? {
        ...process.env,
        ...env
      }
    : process.env;
  try {
    const result = await execa(command, args, {
      all: true,
      cwd,
      env: commandEnv,
      input,
      reject: false,
      timeout
    });
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

function hostUserIdentityEnvArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return [
    "-e",
    `${STUDIO_HOST_UID_ENV}=${process.getuid()}`,
    "-e",
    `${STUDIO_HOST_GID_ENV}=${process.getgid()}`
  ];
}

function hostUserDockerArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return ["-u", `${process.getuid()}:${process.getgid()}`];
}

export {
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  normalizeRunResult,
  runHostCommand,
  shellQuote,
  stableHash
};
