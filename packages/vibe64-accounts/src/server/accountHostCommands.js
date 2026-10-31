import path from "node:path";
import { runVibe64Command } from "@local/vibe64-execution/server";

// Host commands an account operation runs: who runs them, with which runtimes,
// and what their output says.

function hostCommandResultOutput(result = {}) {
  return [result?.output, result?.stderr, result?.stdout].filter(Boolean).join("\n");
}

function commandArgv(commandArgs) {
  return Array.isArray(commandArgs) ? commandArgs.map(String) : [];
}

function hostCommandOptionsForCredentialContext(context = {}) {
  return {
    hostGid: context?.gid ?? context?.hostGid ?? "",
    hostUid: context?.uid ?? context?.hostUid ?? "",
    toolHomeSource: context?.toolHomeSource || "",
    username: context?.username || context?.ownerUserKey || ""
  };
}

function normalizeProcessId(value = null) {
  if (value === null || value === undefined || String(value).trim() === "") {
    return null;
  }
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

function currentProcessMatchesHostIdentity({
  hostGid = null,
  hostUid = null,
  gid = null,
  uid = null
} = {}) {
  const expectedUid = normalizeProcessId(hostUid ?? uid);
  const expectedGid = normalizeProcessId(hostGid ?? gid);
  // readable-check: allow method-probe - platform object: process.getuid() and process.getgid() exist only on POSIX
  const actualUid = typeof process.getuid === "function" ? process.getuid() : null;
  // readable-check: allow method-probe - platform object: process.getuid() and process.getgid() exist only on POSIX
  const actualGid = typeof process.getgid === "function" ? process.getgid() : null;
  return expectedUid !== null &&
    expectedGid !== null &&
    actualUid !== null &&
    actualGid !== null &&
    expectedUid === actualUid &&
    expectedGid === actualGid;
}

function accountCommandActor(options = {}) {
  const username = String(options.username || options.ownerUserKey || "").trim();
  if (!username || currentProcessMatchesHostIdentity(options)) {
    return "app";
  }
  return "owner-user";
}

function accountCommandRuntimes(command = "") {
  const normalized = String(command || "").trim();
  if (normalized === "gh") {
    return ["gh", "git"];
  }
  if (normalized === "git") {
    return ["git", "gh"];
  }
  if (path.basename(normalized) === "codex") {
    return ["operator-clis", "node26", "git"];
  }
  return ["operator-clis", "node26", "git", "gh"];
}

async function runDefaultHostCommand(commandArgs, options = {}) {
  const args = commandArgv(commandArgs);
  const command = args.shift();
  if (!command) {
    return {
      exitCode: 1,
      ok: false,
      output: "No host command was provided.",
      stderr: "No host command was provided.",
      stdout: ""
    };
  }
  const credentialHome = {
    gid: options.hostGid ?? options.gid ?? null,
    home: options.toolHomeSource || "",
    uid: options.hostUid ?? options.uid ?? null,
    username: options.username || options.ownerUserKey || ""
  };
  const cwd = credentialHome.home || process.cwd();
  return runVibe64Command({
    actor: accountCommandActor(options),
    allowedRoots: [
      cwd
    ],
    args,
    command,
    credentialHome,
    cwd,
    envPolicy: "auth",
    mode: "capture",
    purpose: "account",
    runtimes: accountCommandRuntimes(command),
    timeout: options.timeout || 20_000,
    userKey: credentialHome.username
  });
}

export {
  accountCommandActor,
  accountCommandRuntimes,
  commandArgv,
  hostCommandOptionsForCredentialContext,
  hostCommandResultOutput,
  runDefaultHostCommand
};
