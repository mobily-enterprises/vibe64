import {
  existsSync,
  lstatSync,
  readFileSync
} from "node:fs";
import path from "node:path";

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

function metadataMountSourceFromGitDir(gitDir) {
  const normalizedGitDir = path.resolve(gitDir);
  const gitDirectoryMarker = `${path.sep}.git${path.sep}`;
  const markerIndex = normalizedGitDir.lastIndexOf(gitDirectoryMarker);

  if (markerIndex >= 0) {
    return normalizedGitDir.slice(0, markerIndex + `${path.sep}.git`.length);
  }

  return normalizedGitDir;
}

function repositoryMountSourceFromGitDir(gitDir) {
  const metadataMountSource = metadataMountSourceFromGitDir(gitDir);
  return path.basename(metadataMountSource) === ".git"
    ? path.dirname(metadataMountSource)
    : metadataMountSource;
}

function linkedGitMetadataMountSource(targetRoot) {
  const gitDir = linkedGitDir(targetRoot);
  if (!gitDir) {
    return "";
  }

  const mountSource = metadataMountSourceFromGitDir(gitDir);
  return existsSync(mountSource) ? mountSource : "";
}

function linkedGitRepositoryMountSource(targetRoot) {
  const gitDir = linkedGitDir(targetRoot);
  if (!gitDir) {
    return "";
  }

  const mountSource = repositoryMountSourceFromGitDir(gitDir);
  return existsSync(mountSource) ? mountSource : "";
}

function gitToolchainMountArgs(targetRoot) {
  const mountSource = linkedGitRepositoryMountSource(targetRoot);
  return mountSource ? ["-v", `${mountSource}:${mountSource}`] : [];
}

function gitSafeDirectoryArgs(targetRoot) {
  const safeDirectories = ["/workspace"];
  if (linkedGitMetadataMountSource(targetRoot)) {
    safeDirectories.push(path.resolve(String(targetRoot)));
  }

  return Array.from(new Set(safeDirectories)).flatMap((safeDirectory) => [
    "-c",
    `safe.directory=${safeDirectory}`
  ]);
}

export {
  gitSafeDirectoryArgs,
  gitToolchainMountArgs,
  linkedGitMetadataMountSource,
  linkedGitRepositoryMountSource
};
