// A Preview's access and managed app identities: its auth, identity capability and selection, and the
// identity command runner for its launch terminal.

import { vibe64Error } from "@local/vibe64-core/server/core";
import { currentProjectRequestContext, currentProjectScopeKey } from "@local/vibe64-core/server/projectRequestContext";
import {
  normalizePreviewAuthKind,
  normalizePreviewApplicationIdentities,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  previewAuthEnvironment,
  previewAuthIdentityAvailable,
  previewAuthIdentityTypes,
  previewAuthSecretPath,
  readPreviewAuthSecret
} from "@local/vibe64-core/server/previewAuth";
import { previewApplicationIdentityLabel } from "@local/vibe64-core/shared/previewIdentity";
import { vibe64SessionDebugError, vibe64SessionDebugLog } from "@local/vibe64-runtime/server/sessionDebugLog";
import { createPreviewIdentityCommandRunner } from "./previewIdentityCommand.js";

function previewAuthForLaunchTerminal(terminal = {}, options = {}) {
  const {
    sessionId = "",
    targetHref = ""
  } = options;
  const metadata = terminal.metadata && typeof terminal.metadata === "object" && !Array.isArray(terminal.metadata)
    ? terminal.metadata
    : {};
  const kind = normalizePreviewAuthKind(metadata.previewAuth);
  if (!kind) {
    return null;
  }
  let secret = "";
  try {
    secret = readPreviewAuthSecret(previewAuthSecretPath({
      sessionRoot: metadata.sessionRoot,
      terminalSessionId: terminal.id
    }));
  } catch (error) {
    vibe64SessionDebugLog("server.outputTargetTerminal.previewIdentity.secretReadError", {
      error: vibe64SessionDebugError(error),
      sessionId,
      terminalSessionId: String(terminal.id || "")
    }, {
      level: "warn"
    });
    return null;
  }
  if (!secret) {
    return null;
  }
  return {
    identityTypes: previewAuthIdentityTypes({
      identityTypes: metadata.previewIdentity?.identityTypes,
      kind
    }),
    kind,
    projectScope: String(metadata.projectScope || currentProjectScopeKey()).trim(),
    secret,
    sessionId,
    sessionRoot: String(metadata.sessionRoot || ""),
    targetHref,
    sessionSourceRoot: String(metadata.sessionSourceRoot || ""),
    terminalSessionId: String(terminal.id || "")
  };
}

/**
 * What the Preview offers for signing in: the configured identities its
 * application accepts, the default, and why switching is unavailable. The
 * project's invalid entries are skipped, never fatal: skippedIdentities names
 * each with its position and reason, and fileProblem says why a file that is
 * not an identity list gave none.
 */
function previewIdentityCapability({
  previewApplicationIdentities = [],
  previewApplicationIdentityProblems = {},
  preview = {},
  terminal = null
} = {}) {
  const previewReady = ["ready", "stale"].includes(String(preview.state || "")) && Boolean(preview.href);
  const previewAuthKind = normalizePreviewAuthKind(terminal?.metadata?.previewAuth);
  const identitySupported = previewAuthIdentityAvailable({
    kind: previewAuthKind
  });
  const previewAuth = previewAuthForLaunchTerminal(terminal || {}, {
    sessionId: terminal?.metadata?.sessionId || "",
    targetHref: preview.targetHref || ""
  });
  const identityTypes = previewAuthIdentityTypes(previewAuth || {
    kind: previewAuthKind
  });
  const configuredIdentities = normalizePreviewApplicationIdentities(previewApplicationIdentities);
  const identities = configuredIdentities.filter((identity) => (
    identityTypes.includes(identity.type)
  ));
  const available = previewReady &&
    identityTypes.length > 0 &&
    previewAuthIdentityAvailable(previewAuth || {});
  return {
    available,
    defaultIdentityName: identities[0]?.name || "",
    defaultMode: identities.length > 0 ? "identity" : "guest",
    disabledReason: available
      ? ""
      : !previewReady
          ? String(preview.message || "Run the preview before selecting an application identity.")
          : identitySupported
            ? identityTypes.length < 1
              ? "This preview does not advertise a supported application user identifier."
              : "Preview identity authorization is unavailable. Restart the preview."
            : "This preview does not support application identity switching.",
    fileProblem: String(previewApplicationIdentityProblems.fileProblem || ""),
    identities,
    identityTypes,
    rejectedIdentities: configuredIdentities
      .filter((identity) => !identityTypes.includes(identity.type))
      .map((identity) => identity.name),
    skippedIdentities: (Array.isArray(previewApplicationIdentityProblems.invalidIdentities)
      ? previewApplicationIdentityProblems.invalidIdentities
      : [])
      .map(({ name = "", position = 0, reason = "" }) => ({ name, position, reason }))
  };
}

function previewIdentitySelection(input = {}, {
  identities = [],
  skippedIdentities = []
} = {}) {
  const mode = String(input.mode || "identity").trim();
  if (!["identity", "guest"].includes(mode)) {
    throw vibe64Error("Preview identity mode is invalid.", "vibe64_preview_identity_mode_invalid");
  }
  if (mode === "guest") {
    return {
      requestedIdentity: {
        mode: "guest"
      },
      selection: {
        operation: PREVIEW_IDENTITY_LOGOUT_OPERATION
      }
    };
  }
  const requestedName = String(input.identityName || "").trim().toLowerCase();
  const identity = requestedName && requestedName !== "default"
    ? identities.find((entry) => entry.name === requestedName)
    : identities[0];
  const skipped = !identity && requestedName
    ? skippedIdentities.find((entry) => String(entry?.name || "").trim().toLowerCase() === requestedName)
    : null;
  if (skipped) {
    throw vibe64Error(
      `Managed app ${previewApplicationIdentityLabel(skipped)} is skipped. ${skipped.reason} ` +
        "Rename or remove it in Dashboard > App access.",
      "vibe64_preview_identity_name_skipped",
      { params: { identityName: requestedName } }
    );
  }
  if (!identity) {
    const availableNames = identities.map((entry) => entry.name).join(", ");
    throw requestedName && availableNames
      ? vibe64Error(
        `Unknown managed app identity ${requestedName}. Choose one of: ${availableNames}.`,
        "vibe64_preview_identity_name_unknown",
        { params: { identityName: requestedName, availableNames } }
      )
      : vibe64Error("No managed app identity is configured for this project.", "vibe64_preview_identity_not_configured");
  }
  const selector = {
    type: identity.type,
    value: identity.value
  };
  return {
    requestedIdentity: {
      displayName: identity.name,
      mode,
      name: identity.name,
      selector
    },
    selection: {
      operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
      selector
    }
  };
}

function launchExecutionProject(context = {}, terminalEnvRecords = {}) {
  return {
    projectsRoot: context.projectsRoot || "",
    runtimeConfigEnv: terminalEnvRecords.runtimeConfigEnv,
    runtimeTargetRoot: context.projectContextRoot || "",
    serviceDataRoot: context.serviceDataRoot || "",
    slug: String(currentProjectRequestContext()?.slug || "").trim(),
    targetRoot: context.sessionSourceRoot || ""
  };
}

function previewIdentityCommandRunnerForLaunchTerminal({
  context = {},
  runCommand = null,
  targetHref = "",
  terminal = null
} = {}) {
  const capability = terminal?.metadata?.previewIdentity;
  if (!capability || !runCommand) {
    return null;
  }
  const previewAuth = previewAuthForLaunchTerminal(terminal, {
    sessionId: terminal?.metadata?.sessionId || "",
    targetHref
  });
  if (!previewAuthIdentityAvailable(previewAuth || {})) {
    return null;
  }
  return createPreviewIdentityCommandRunner({
    allowedRoots: [
      context.sessionSourceRoot,
      capability.sourceRoot
    ].filter(Boolean),
    capability,
    // Identity exchange is a host-to-app protocol invocation, not another app
    // launch. It needs only the one-time exchange secret and its declared
    // aliases. Loading the complete project environment here can provision or
    // inspect managed resources (notably a session database) while the user is
    // waiting on a ten-second UI interaction.
    env: previewAuthEnvironment({
      ...previewAuth,
      previewIdentity: capability
    }),
    project: launchExecutionProject(context, {
      runtimeConfigEnv: {}
    }),
    runCommand,
    runtimes: capability.runtimes,
    session: context.session || {},
    sourceRoot: capability.sourceRoot,
    targetHref
  });
}

export {
  launchExecutionProject,
  previewAuthForLaunchTerminal,
  previewIdentityCapability,
  previewIdentityCommandRunnerForLaunchTerminal,
  previewIdentitySelection
};
