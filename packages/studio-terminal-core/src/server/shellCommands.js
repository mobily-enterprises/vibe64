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

function normalizeDockerUserId(value = "") {
  const normalized = Number.parseInt(String(value || "").trim(), 10);
  return Number.isSafeInteger(normalized) && normalized >= 0 ? String(normalized) : "";
}

function dockerUserArgs({
  gid = "",
  uid = ""
} = {}) {
  const normalizedUid = normalizeDockerUserId(uid);
  const normalizedGid = normalizeDockerUserId(gid);
  return normalizedUid && normalizedGid
    ? [
        "-u",
        `${normalizedUid}:${normalizedGid}`
      ]
    : [];
}

function hostUserDockerArgs() {
  if (typeof process.getuid !== "function" || typeof process.getgid !== "function") {
    return [];
  }
  return dockerUserArgs({
    gid: process.getgid(),
    uid: process.getuid()
  });
}

export {
  dockerUserArgs,
  dockerCommand,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  normalizeDockerUserId,
  normalizeRunResult,
  runHostCommand,
  shellQuote,
  stableHash
};
