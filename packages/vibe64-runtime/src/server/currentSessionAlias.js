import { randomUUID } from "node:crypto";
import { lstat, mkdir, readlink, rename, rm, symlink } from "node:fs/promises";
import path from "node:path";

import {
  isMissingPathError,
  normalizeText,
  vibe64Error
} from "@local/vibe64-core/server/core";

const VIBE64_CURRENT_SESSION_ALIAS_NAME = "selected";

function resolveVibe64CurrentSessionAliasPath(sessionsRoot = "") {
  const normalizedSessionsRoot = normalizeText(sessionsRoot);
  if (!normalizedSessionsRoot) {
    throw vibe64Error(
      "Current Vibe64 session alias requires sessionsRoot.",
      "vibe64_sessions_root_required"
    );
  }
  return path.join(path.resolve(normalizedSessionsRoot), VIBE64_CURRENT_SESSION_ALIAS_NAME);
}

function requireCurrentSessionAliasPath(aliasPath = "") {
  const normalizedAliasPath = normalizeText(aliasPath);
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
  const normalizedSessionId = normalizeText(sessionId);
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
  const expectedTarget = currentSessionAliasTarget(normalizeText(sessionId));
  if (await readlink(resolvedAliasPath) !== expectedTarget) {
    return;
  }
  await rm(resolvedAliasPath, {
    force: true
  });
}

export {
  clearVibe64CurrentSessionAliasIfMatches,
  resolveVibe64CurrentSessionAliasPath,
  updateVibe64CurrentSessionAlias
};
