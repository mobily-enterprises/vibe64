#!/usr/bin/env node
// The privileged exec helper: it reads one request, checks it, and acts as the
// person, application or service account the request names. The modules beside
// it import only Node built-ins and each other; a release bundles them into this
// one file, which is installed and run on its own.
import process from "node:process";

import { handleApplicationAccountOperation } from "./applicationAccounts.js";
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
  assertActablePerson,
  assertPersonAccount,
  handleUserManagementOperation,
  hostPersonFacts,
  PERSON_REFUSED_EXIT_CODE,
  registerPerson,
  upgradePersonRegistry
} from "./personRegistry.js";
import { handleProductionAccessOperation, runProductionService, runProductionShell } from "./productionLogin.js";
import { handleDeploymentServiceOperation, handleManagedServiceOperation, runReleaseService } from "./serviceOperations.js";

const ALLOWED_OPERATIONS = new Set([
  "account-auth-terminal",
  "application-account",
  "account-status",
  "codex-app-server",
  "create-system-user",
  "deployment-service",
  "enable-system-user",
  "github-api-command",
  "github-toolchain",
  "github-workflow-command",
  "health-status",
  "managed-execution",
  "managed-service",
  "opencode-app-server",
  "production-access",
  "vibe64-command",
  "workspace-cache-command"
]);

async function main() {
  if (process.argv[2] === "run-managed") {
    await runManagedExecutionPayload(process.argv[3] || "");
    return;
  }
  if (process.argv[2] === "run-release-service") {
    runReleaseService(process.argv[3] || "", process.argv[4] || "");
    return;
  }
  // sshd's forced command for an application account's production login, run
  // as that account (productionLogin.js), and the one thing that login may run
  // through sudo: its own release service's output, state and restart.
  if (process.argv[2] === "production-shell" && process.argv.length === 3) {
    runProductionShell();
    return;
  }
  if (process.argv[2] === "production-service") {
    runProductionService(process.argv.slice(3));
    return;
  }
  // Root-only: the daemon's sudo rule names only
  // `execute`, so it can never register a person itself.
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
  if (operation === "deployment-service") {
    handleDeploymentServiceOperation(payload);
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
  if (operation === "application-account") {
    handleApplicationAccountOperation(payload);
    return;
  }
  if (operation === "production-access") {
    handleProductionAccessOperation(payload);
    return;
  }
  const username = safeUsername(payload.username);
  if (operation === "create-system-user" || operation === "enable-system-user") {
    handleUserManagementOperation(operation, payload, username);
    return;
  }
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
