#!/usr/bin/env node
// The privileged exec helper: it reads one request, checks it, and acts as the
// person, application or service account the request names. The modules beside
// it import only Node built-ins and each other; a release bundles them into this
// one file, which is installed and run on its own.
import process from "node:process";

import { handleStagingAccountOperation } from "./stagingAccounts.js";
import {
  ALLOWED_COMMANDS,
  helperChildEnv,
  resolveAllowedCwd,
  runUserCommand
} from "./commandEnvironment.js";
import { assertNormalizedPayload, consumeManagedExecutionRequestPayload, readPayload } from "./helperPayload.js";
import {
  assertExpectedId,
  assertHumanUsername,
  resolveOsUser,
  resolveOwnerUser,
  safeUsername
} from "./hostAccounts.js";
import { handleManagedExecutionOperation, runManagedExecutionPayload } from "./managedExecution.js";
import {
  addPerson,
  assertActablePerson,
  assertPersonAccount,
  hostPersonFacts,
  PERSON_REFUSED_EXIT_CODE,
  registerPerson,
  upgradePersonRegistry
} from "./personRegistry.js";
import { handleStagingAccessOperation, runStagingEnter, runStagingService, runStagingShell } from "./stagingLogin.js";
import {
  handleStagingUnitOperation,
  handleManagedServiceOperation,
  relinkSystemdUnits,
  runStagingUnit
} from "./serviceOperations.js";

const ALLOWED_OPERATIONS = new Set([
  "account-auth-terminal",
  "staging-account",
  "account-status",
  "codex-app-server",
  "staging-unit",
  "github-api-command",
  "github-toolchain",
  "github-workflow-command",
  "health-status",
  "managed-execution",
  "managed-service",
  "opencode-app-server",
  "staging-access",
  "vibe64-command",
  "workspace-cache-command"
]);

async function main() {
  if (process.argv[2] === "run-managed") {
    await runManagedExecutionPayload(process.argv[3] || "");
    return;
  }
  if (process.argv[2] === "run-staging-unit") {
    runStagingUnit(process.argv[3] || "", process.argv[4] || "");
    return;
  }
  // sshd's forced command for a staging account's staging login, run
  // as that account (stagingLogin.js), the one thing that login may run
  // through sudo: its own staging service's output, state and restart, or
  // entering it, and what entering runs as that account inside the service.
  if (process.argv[2] === "staging-shell" && process.argv.length === 3) {
    runStagingShell();
    return;
  }
  if (process.argv[2] === "staging-service") {
    runStagingService(process.argv.slice(3));
    return;
  }
  if (process.argv[2] === "staging-enter") {
    runStagingEnter(process.argv.slice(3));
    return;
  }
  // Root-only: the daemon's sudo rule names only
  // `execute`, so it can never make or register a person itself.
  if (process.argv[2] === "upgrade-person-registry") {
    if (process.argv.length !== 4) {
      throw new Error("Usage: vibe64-exec-helper upgrade-person-registry <workspace>");
    }
    upgradePersonRegistry(process.argv[3]);
    return;
  }
  if (process.argv[2] === "register-person") {
    if (process.argv.length !== 5) {
      throw new Error("Usage: vibe64-exec-helper register-person <workspace> <username>");
    }
    registerPerson(process.argv[3], process.argv[4]);
    return;
  }
  // A login the workspace's member list names (a host that adds its people
  // from such a list runs it as root): registered as register-person registers
  // one, made first, without a password, when it has no account.
  if (process.argv[2] === "add-person") {
    if (process.argv.length !== 5) {
      throw new Error("Usage: vibe64-exec-helper add-person <workspace> <username>");
    }
    addPerson(process.argv[3], process.argv[4]);
    return;
  }
  // At every start of a host whose helper units live outside systemd's own folder, before its services start.
  if (process.argv[2] === "relink-units") {
    if (process.argv.length !== 3) {
      throw new Error("Usage: vibe64-exec-helper relink-units");
    }
    relinkSystemdUnits();
    return;
  }
  // Exits 0 for an account Vibe64 may act as, and 3 with the reason for one it
  // never may, so host setup can hand an owner's administration to another
  // account first and SSH access can refuse an administrator.
  if (process.argv[2] === "check-person") {
    if (process.argv.length !== 4) {
      throw new Error("Usage: vibe64-exec-helper check-person <username>");
    }
    assertHumanUsername(process.argv[3]);
    assertPersonAccount(resolveOsUser(process.argv[3]), hostPersonFacts(process.argv[3]));
    return;
  }
  if (process.argv[2] !== "execute" || process.argv.length > 4) {
    throw new Error("Usage: vibe64-exec-helper execute [payload-json-file]");
  }
  const payloadPath = process.argv[3] || "";
  const payload = payloadPath
    ? consumeManagedExecutionRequestPayload(payloadPath, resolveOwnerUser())
    : readPayload();
  assertNormalizedPayload(payload);
  const operation = String(payload.operation || "").trim();
  if (!ALLOWED_OPERATIONS.has(operation)) {
    throw new Error("Vibe64 exec helper rejected an unknown operation.");
  }
  if (payloadPath && operation !== "managed-execution") {
    throw new Error("Vibe64 exec helper accepts a payload file only for a managed execution.");
  }
  if (operation === "staging-unit") {
    handleStagingUnitOperation(payload);
    return;
  }
  if (operation === "managed-service") {
    handleManagedServiceOperation(payload);
    return;
  }
  if (operation === "managed-execution") {
    handleManagedExecutionOperation(payload);
    return;
  }
  if (operation === "staging-account") {
    handleStagingAccountOperation(payload);
    return;
  }
  if (operation === "staging-access") {
    handleStagingAccessOperation(payload);
    return;
  }
  const username = safeUsername(payload.username);
  assertHumanUsername(username);
  const command = String(payload.command || "").trim();
  if (!ALLOWED_COMMANDS.has(command)) {
    throw new Error("Vibe64 exec helper rejected an unknown command.");
  }
  const targetUser = resolveOsUser(username);
  assertExpectedId("uid", payload.uid, targetUser.uid);
  assertExpectedId("gid", payload.gid, targetUser.gid);
  const owner = resolveOwnerUser();
  assertActablePerson(owner, targetUser);
  const cwd = resolveAllowedCwd(payload.cwd || "", owner.username, {
    operation,
    targetUser
  });
  const env = helperChildEnv(payload.env || {}, targetUser, owner.username, operation);
  const args = Array.isArray(payload.args) ? payload.args.map((arg) => String(arg)) : [];
  const input = payload.inputBase64
    ? Buffer.from(String(payload.inputBase64), "base64")
    : undefined;

  process.umask(0o007);
  const child = runUserCommand(targetUser, command, args, {
    cwd,
    env,
    ...(input === undefined
      ? {
          stdio: "inherit"
        }
      : {
          input,
          stdio: ["pipe", "inherit", "inherit"]
        })
  });
  if (child.error) {
    throw child.error;
  }
  process.exit(typeof child.status === "number" ? child.status : 1);
}

// Last, so that every constant above exists before main() runs.
if (import.meta.main) {
  main().catch((error) => {
    process.stderr.write(`${String(error?.message || error)}\n`);
    process.exit(error?.exitCode === PERSON_REFUSED_EXIT_CODE ? PERSON_REFUSED_EXIT_CODE : 2);
  });
}
