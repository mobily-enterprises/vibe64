import { randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";

import { isMissingPathError, vibe64Error } from "@local/vibe64-core/server/core";
import { toText } from "@local/vibe64-core/shared/toText";

const VIBE64_CURRENT_SESSION_ALIAS_NAME = "selected";

function resolveVibe64CurrentSessionAliasPath(sessionsRoot = "") {
  const normalizedSessionsRoot = toText(sessionsRoot);
  if (!normalizedSessionsRoot) {
    throw vibe64Error(
      "Current Vibe64 session alias requires sessionsRoot.",
      "vibe64_sessions_root_required"
    );
  }
  return path.join(path.resolve(normalizedSessionsRoot), VIBE64_CURRENT_SESSION_ALIAS_NAME);
}

function requireCurrentSessionAliasPath(aliasPath = "") {
  const normalizedAliasPath = toText(aliasPath);
  if (!normalizedAliasPath) {
    throw vibe64Error(
      "Current Vibe64 session alias requires aliasPath.",
      "vibe64_current_session_alias_path_required"
    );
  }
  return path.resolve(normalizedAliasPath);
}

async function lstatIfExists(targetPath) {
  try {
    return await lstat(targetPath);
  } catch (error) {
    if (isMissingPathError(error)) {
      return null;
    }
    throw error;
  }
}

function currentSessionAliasTarget(sessionId = "") {
  return path.join("active", sessionId);
}

async function updateVibe64CurrentSessionAlias({
  aliasPath = "",
  sessionId = ""
} = {}) {
  const resolvedAliasPath = requireCurrentSessionAliasPath(aliasPath);
  const normalizedSessionId = toText(sessionId);
  const aliasStat = await lstatIfExists(resolvedAliasPath);
  if (aliasStat && !aliasStat.isSymbolicLink()) {
    throw vibe64Error(
      `Cannot manage current Vibe64 session alias because ${resolvedAliasPath} is not a symbolic link.`,
      "vibe64_current_session_alias_conflict"
    );
  }
  if (!normalizedSessionId) {
    if (aliasStat) {
      await rm(resolvedAliasPath, {
        force: true
      });
    }
    return;
  }

  const target = currentSessionAliasTarget(normalizedSessionId);
  if (aliasStat && await readlink(resolvedAliasPath) === target) {
    return;
  }

  const aliasDirectory = path.dirname(resolvedAliasPath);
  const temporaryAliasPath = path.join(
    aliasDirectory,
    `.${VIBE64_CURRENT_SESSION_ALIAS_NAME}-${randomUUID()}`
  );
  try {
    await mkdir(aliasDirectory, {
      recursive: true
    });
    await symlink(target, temporaryAliasPath, "dir");
    await rename(temporaryAliasPath, resolvedAliasPath);
  } finally {
    await rm(temporaryAliasPath, {
      force: true
    });
  }
}

async function clearVibe64CurrentSessionAliasIfMatches({
  aliasPath = "",
  sessionId = ""
} = {}) {
  const resolvedAliasPath = requireCurrentSessionAliasPath(aliasPath);
  const aliasStat = await lstatIfExists(resolvedAliasPath);
  if (!aliasStat?.isSymbolicLink()) {
    return;
  }
  const expectedTarget = currentSessionAliasTarget(toText(sessionId));
  if (await readlink(resolvedAliasPath) !== expectedTarget) {
    return;
  }
  await rm(resolvedAliasPath, {
    force: true
  });
}

async function readVibe64CurrentSessionAlias({
  aliasPath = ""
} = {}) {
  const resolvedAliasPath = requireCurrentSessionAliasPath(aliasPath);
  const aliasStat = await lstatIfExists(resolvedAliasPath);
  if (!aliasStat) {
    return "";
  }
  if (!aliasStat.isSymbolicLink()) {
    throw vibe64Error(
      `Cannot read current Vibe64 session because ${resolvedAliasPath} is not a symbolic link.`,
      "vibe64_current_session_alias_conflict"
    );
  }
  const target = await readlink(resolvedAliasPath);
  const normalizedTarget = path.normalize(target);
  if (
    path.isAbsolute(target) ||
    path.dirname(normalizedTarget) !== "active" ||
    path.basename(normalizedTarget) !== toText(path.basename(normalizedTarget))
  ) {
    throw vibe64Error(
      `Cannot read invalid current Vibe64 session alias target: ${target || "(empty)"}.`,
      "vibe64_current_session_alias_invalid"
    );
  }
  return path.basename(normalizedTarget);
}

export {
  clearVibe64CurrentSessionAliasIfMatches,
  readVibe64CurrentSessionAlias,
  resolveVibe64CurrentSessionAliasPath,
  updateVibe64CurrentSessionAlias
};
