// The systemd units the helper writes: their names, paths, account and sandbox lines, and the unit files of
// deployment and managed services.

import { existsSync } from "node:fs";
import path from "node:path";

import { DEFAULT_PATH } from "./commandEnvironment.js";
import {
  DAEMON_USERNAME_PREFIX,
  HOST_SETTINGS_ROOT,
  safeUsername,
  VIBE64_GROUP,
  workspaceFromDaemonUsername,
  workspaceTempRoot
} from "./hostAccounts.js";
import { canonicalPath, relativePathParts } from "./hostFiles.js";

const SYSTEMD_UNIT_ROOT = "/etc/systemd/system";

// A person's or the daemon's execution runs as a member of the shared group;
// an application's only as itself, inside its sandbox, where its area and its
// receipt are all it may write.
function accountUnitLines(targetUser = {}, { receiptRoot = "" } = {}) {
  if (!targetUser.application) {
    return [
      `User=${targetUser.username}`,
      `Group=${VIBE64_GROUP}`,
      "SupplementaryGroups=nix-users",
      "UMask=0007"
    ];
  }
  return [
    `User=${targetUser.username}`,
    `Group=${targetUser.username}`,
    "UMask=0077",
    ...applicationSandboxLines(targetUser.application, [receiptRoot])
  ];
}

function releaseServicePort(value) {
  const port = Number(value);
  if (!Number.isSafeInteger(port) || port < 1024 || port > 65535) {
    throw new Error("Vibe64 exec helper rejected a release service port.");
  }
  return port;
}

// What an application's commands and release service run inside: its own area
// is all they may write, they never gain privileges, and they see no other
// user's processes, homes, temporary or shared-memory files, devices or System
// V IPC, nor the kernel's settings. They use only internet, local and netlink sockets (Node's
// os.networkInterfaces() needs netlink) and the system calls of an ordinary
// service; any other call fails with EPERM rather than killing the process.
function applicationSandboxLines(identity = {}, writablePaths = []) {
  return [
    "NoNewPrivileges=yes",
    "PrivateTmp=yes",
    "PrivateDevices=yes",
    "PrivateIPC=yes",
    "TemporaryFileSystem=/dev/shm:mode=1777,nosuid,nodev",
    "ProtectSystem=strict",
    `ReadWritePaths=${[identity.appRoot, identity.databaseRoot, ...writablePaths.filter(Boolean)]
      .map(systemdUnitSafeValue).join(" ")}`,
    "ProtectHome=yes",
    "ProtectProc=invisible",
    "ProtectKernelTunables=yes",
    "ProtectKernelModules=yes",
    "ProtectKernelLogs=yes",
    "ProtectControlGroups=yes",
    "RestrictSUIDSGID=yes",
    "RestrictNamespaces=yes",
    "LockPersonality=yes",
    "CapabilityBoundingSet=",
    "RestrictAddressFamilies=AF_INET AF_INET6 AF_UNIX AF_NETLINK",
    "SystemCallArchitectures=native",
    "SystemCallFilter=@system-service",
    "SystemCallErrorNumber=EPERM",
    // The host's own settings, people and applications are no business of a
    // project's code, though some of those files are readable by every account.
    `InaccessiblePaths=${HOST_SETTINGS_ROOT}`
  ];
}

function assertSafeManagedServicePath(candidatePath = "", owner = {}, label = "path") {
  const resolved = resolveAllowedManagedServicePath(candidatePath, owner);
  if (!existsSync(resolved)) {
    throw new Error(`Vibe64 managed service ${label} does not exist.`);
  }
  return resolved;
}

function managedServiceRoot(owner = {}) {
  const username = safeUsername(owner.username);
  const workspace = workspaceFromDaemonUsername(username);
  if (!workspace) {
    throw new Error("Vibe64 exec helper could not resolve the managed service workspace.");
  }
  return path.join("/var/lib/vibe64", workspace, "services");
}

function resolveAllowedManagedServicePath(candidatePath = "", owner = {}) {
  const normalized = String(candidatePath || "").trim();
  if (!normalized) {
    throw new Error("Vibe64 exec helper rejected an empty managed service path.");
  }
  const resolved = canonicalPath(normalized, { allowMissingLeaf: true });
  if (relativePathParts(canonicalPath(managedServiceRoot(owner)), resolved).length > 0) {
    return resolved;
  }
  throw new Error("Vibe64 exec helper rejected a managed service path outside the workspace service root.");
}

// A release service unit of the calling daemon's own workspace; no daemon
// installs, stops, removes or reads another workspace's.
function assertValidDeploymentUnitName(unitName = "", owner = {}) {
  const normalized = String(unitName || "").trim();
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  if (
    !owner.username?.startsWith(DAEMON_USERNAME_PREFIX) ||
    !normalized.startsWith(`vibe64-release-${workspace}-`) ||
    !normalized.endsWith(".service") ||
    !/^[A-Za-z0-9_.@:-]+$/u.test(normalized) ||
    normalized.includes("/") ||
    normalized.includes("..")
  ) {
    throw new Error("Vibe64 exec helper rejected an unsafe deployment service unit name.");
  }
  return normalized;
}

function assertValidManagedServiceUnitName(unitName = "", owner = {}) {
  const normalized = String(unitName || "").trim();
  const workspace = path.basename(path.dirname(managedServiceRoot(owner)));
  if (
    !normalized.startsWith(`vibe64-managed-${workspace}-`) ||
    !normalized.endsWith(".service") ||
    !/^[A-Za-z0-9_.@:-]+$/u.test(normalized) ||
    normalized.includes("/") ||
    normalized.includes("..")
  ) {
    throw new Error("Vibe64 exec helper rejected an unsafe managed service unit name.");
  }
  return normalized;
}

function assertValidManagedServiceProcessModel(value = "") {
  const processModel = String(value || "").trim();
  if (processModel !== "forking" && processModel !== "simple") {
    throw new Error("Vibe64 exec helper rejected an unsupported managed service process model.");
  }
  return processModel;
}

function systemdUnitPath(unitName = "", owner = {}) {
  return path.join(SYSTEMD_UNIT_ROOT, assertValidDeploymentUnitName(unitName, owner));
}

function managedSystemdUnitPath(unitName = "", owner = {}) {
  return path.join(SYSTEMD_UNIT_ROOT, assertValidManagedServiceUnitName(unitName, owner));
}

function serviceAccountUnitLines(owner = {}) {
  return [
    `User=${systemdUnitSafeValue(owner.username)}`,
    `Group=${VIBE64_GROUP}`,
    "SupplementaryGroups=nix-users",
    "UMask=0007"
  ];
}

function serviceResourceUnitLines(owner = {}) {
  const workspace = workspaceFromDaemonUsername(safeUsername(owner.username));
  return [
    `Slice=vibe64-${workspace}-work.slice`,
    "MemoryAccounting=yes",
    "IOAccounting=yes",
    "TasksAccounting=yes",
    "KillMode=control-group",
    "OOMPolicy=stop"
  ];
}

function deploymentServiceUnit({
  environmentFile = "",
  helperPath = "",
  loopbackPort = 0,
  owner = {},
  requiredUnits = [],
  startScript = "",
  unitName = "",
  user = {},
  workingDirectory = ""
} = {}) {
  const dependencies = Array.isArray(requiredUnits) ? requiredUnits : [];
  return [
    "[Unit]",
    `Description=Vibe64 release service ${unitName}`,
    `After=${["network-online.target", ...dependencies].join(" ")}`,
    "Wants=network-online.target",
    ...(dependencies.length > 0 ? [`Requires=${dependencies.join(" ")}`] : []),
    "StartLimitIntervalSec=60",
    "StartLimitBurst=5",
    "",
    "[Service]",
    "Type=simple",
    ...accountUnitLines(user),
    ...serviceResourceUnitLines(owner),
    // It may listen on its own loopback port and nowhere else, so it can never
    // take over another service's port while that service is down. UDP stays
    // open: a UDP client (Node's dgram, for StatsD or syslog) binds before it
    // sends, often to port 0, which no port rule names, and no host service
    // listens on an unprivileged UDP port.
    `SocketBindAllow=tcp:${releaseServicePort(loopbackPort)}`,
    "SocketBindAllow=udp",
    "SocketBindDeny=any",
    `WorkingDirectory=${systemdUnitSafeValue(workingDirectory)}`,
    `Environment=PATH=${systemdUnitSafeValue(DEFAULT_PATH)}`,
    "Environment=TMPDIR=/tmp",
    // The service's own user loads its environment at every start; see
    // runReleaseService. setpriv holds even where a drop-in switches the
    // unit's NoNewPrivileges= off.
    `ExecStart=/usr/bin/setpriv --no-new-privs -- ${systemdUnitSafeValue(helperPath)} run-release-service "${systemdUnitSafeValue(environmentFile)}" "${systemdUnitSafeValue(startScript)}"`,
    "Restart=always",
    "RestartSec=3",
    "KillSignal=SIGTERM",
    "TimeoutStopSec=30",
    "",
    "[Install]",
    "WantedBy=multi-user.target",
    ""
  ].join("\n");
}

function managedServiceUnit({
  owner = {},
  pidFile = "",
  processModel = "simple",
  startScript = "",
  unitName = "",
  workingDirectory = ""
} = {}) {
  const normalizedProcessModel = assertValidManagedServiceProcessModel(processModel);
  return [
    "[Unit]",
    `Description=Vibe64 managed service ${unitName}`,
    "After=network-online.target",
    "Wants=network-online.target",
    "",
    "[Service]",
    `Type=${normalizedProcessModel}`,
    ...serviceAccountUnitLines(owner),
    ...serviceResourceUnitLines(owner),
    `WorkingDirectory=${systemdUnitSafeValue(workingDirectory)}`,
    `Environment=PATH=${systemdUnitSafeValue(DEFAULT_PATH)}`,
    `Environment=TMPDIR=${systemdUnitSafeValue(workspaceTempRoot(owner.username))}`,
    `ExecStart=${systemdUnitSafeValue(startScript)}`,
    ...(normalizedProcessModel === "forking" ? [`PIDFile=${systemdUnitSafeValue(pidFile)}`] : []),
    "Restart=on-failure",
    "RestartSec=3",
    "TimeoutStartSec=90",
    "TimeoutStopSec=30",
    ""
  ].join("\n");
}

function systemdUnitSafeValue(value = "") {
  const text = String(value || "").trim();
  if (!text || /[\r\n]/u.test(text)) {
    throw new Error("Vibe64 exec helper rejected an unsafe systemd value.");
  }
  return text.replaceAll("\\", "\\\\").replaceAll("\"", "\\\"");
}

export {
  accountUnitLines,
  applicationSandboxLines,
  assertSafeManagedServicePath,
  assertValidDeploymentUnitName,
  assertValidManagedServiceProcessModel,
  assertValidManagedServiceUnitName,
  deploymentServiceUnit,
  managedServiceUnit,
  managedSystemdUnitPath,
  releaseServicePort,
  resolveAllowedManagedServicePath,
  SYSTEMD_UNIT_ROOT,
  systemdUnitPath
};
