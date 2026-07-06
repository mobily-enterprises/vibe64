import {
  existsSync,
  lstatSync,
  readFileSync
} from "node:fs";
import path from "node:path";

import {
  gitSafeDirectoryArgs
} from "./gitSafeDirectories.js";

function safeLstat(filePath) {
  try {
    return lstatSync(filePath);
  } catch {
    return null;
  }
}

function linkedGitDir(targetRoot) {
  if (!targetRoot) {
    return "";
  }

  const gitFilePath = path.join(path.resolve(String(targetRoot)), ".git");
  const gitFileStat = safeLstat(gitFilePath);
  if (!gitFileStat?.isFile()) {
    return "";
  }

  const gitFile = readFileSync(gitFilePath, "utf8");
  const match = gitFile.match(/^gitdir:\s*(.+?)\s*$/imu);
  if (!match?.[1]) {
    return "";
  }

  const rawGitDir = match[1].trim();
  return path.resolve(path.dirname(gitFilePath), rawGitDir);
}

function metadataHostSourceFromGitDir(gitDir) {
  const normalizedGitDir = path.resolve(gitDir);
  const gitDirectoryMarker = `${path.sep}.git${path.sep}`;
  const markerIndex = normalizedGitDir.lastIndexOf(gitDirectoryMarker);

  if (markerIndex >= 0) {
    return normalizedGitDir.slice(0, markerIndex + `${path.sep}.git`.length);
  }

  return normalizedGitDir;
}

function repositoryHostSourceFromGitDir(gitDir) {
  const metadataHostSource = metadataHostSourceFromGitDir(gitDir);
  return path.basename(metadataHostSource) === ".git"
    ? path.dirname(metadataHostSource)
    : metadataHostSource;
}

function linkedGitMetadataHostSource(targetRoot) {
  const gitDir = linkedGitDir(targetRoot);
  if (!gitDir) {
    return "";
  }

  const hostSource = metadataHostSourceFromGitDir(gitDir);
  return existsSync(hostSource) ? hostSource : "";
}

function linkedGitRepositoryHostSource(targetRoot) {
  const gitDir = linkedGitDir(targetRoot);
  if (!gitDir) {
    return "";
  }

  const hostSource = repositoryHostSourceFromGitDir(gitDir);
  return existsSync(hostSource) ? hostSource : "";
}

function gitSafeDirectoryArgsForTarget(targetRoot) {
  return gitSafeDirectoryArgs(targetRoot ? [path.resolve(String(targetRoot))] : []);
}

export {
  gitSafeDirectoryArgsForTarget as gitSafeDirectoryArgs,
  linkedGitMetadataHostSource,
  linkedGitRepositoryHostSource
};
