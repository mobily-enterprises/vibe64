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

function hostSupplementaryGroupDockerArgs() {
  if (typeof process.getgroups !== "function") {
    return [];
  }
  const primaryGid = typeof process.getgid === "function" ? process.getgid() : null;
  const groups = Array.from(new Set(process.getgroups()
    .map((gid) => Number(gid))
    .filter((gid) => Number.isSafeInteger(gid) && gid > 0 && gid !== primaryGid)
    .map((gid) => String(gid))));
  return groups.flatMap((gid) => [
    "--group-add",
    gid
  ]);
}

function setprivSupplementaryGroupArgsScript({
  variableName = "setpriv_group_args"
} = {}) {
  const name = String(variableName || "").trim() || "setpriv_group_args";
  return [
    `${name}="--clear-groups"`,
    "supplementary_groups=\"$({ id -G 2>/dev/null | tr ' ' '\\n'; if [ -S /var/run/docker.sock ]; then stat -c '%g' /var/run/docker.sock 2>/dev/null || true; fi; } | awk -v primary=\"$VIBE64_HOST_GID\" '$1 ~ /^[0-9]+$/ && $1 != \"0\" && $1 != primary { print $1 }' | sort -n -u | paste -sd, -)\"",
    `if [ -n "$supplementary_groups" ]; then ${name}="--groups $supplementary_groups"; fi`
  ];
}

export {
  dockerUserArgs,
  dockerCommand,
  hostSupplementaryGroupDockerArgs,
  hostUserDockerArgs,
  hostUserIdentityEnvArgs,
  normalizeDockerUserId,
  normalizeRunResult,
  runHostCommand,
  setprivSupplementaryGroupArgsScript,
  shellQuote,
  stableHash
};
