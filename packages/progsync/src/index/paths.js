import fs from "node:fs";
import path from "node:path";

import {
  PROGRAM_DIRECTORY,
  PROGRAM_INDEX_DIRECTORY,
  TARGETS
} from "./constants.js";
import { ProgSyncError } from "./errors.js";

function slashPath(value) {
  return String(value || "").replaceAll(path.sep, "/");
}

function projectRootPath(projectRoot) {
  if (!projectRoot) {
    throw new ProgSyncError(
      "PROJECT_ROOT_REQUIRED",
      "ProgSync requires an explicit projectRoot."
    );
  }
  const resolved = path.resolve(projectRoot);
  if (!fs.existsSync(resolved) || !fs.statSync(resolved).isDirectory()) {
    throw new ProgSyncError(
      "PROJECT_ROOT_NOT_FOUND",
      `Project root does not exist: ${resolved}`,
      { projectRoot: resolved }
    );
  }
  return resolved;
}

function projectRelativePath(projectRoot, filePath) {
  const root = projectRootPath(projectRoot);
  const absolute = path.isAbsolute(filePath)
    ? path.resolve(filePath)
    : path.resolve(root, filePath);
  const relative = slashPath(path.relative(root, absolute));
  if (!relative || relative === ".") {
    throw new ProgSyncError(
      "FILE_PATH_REQUIRED",
      "A file path below the project root is required."
    );
  }
  if (relative === ".." || relative.startsWith("../") || path.isAbsolute(relative)) {
    throw new ProgSyncError(
      "PATH_OUTSIDE_PROJECT",
      `Path is outside the project root: ${filePath}`,
      { filePath, projectRoot: root }
    );
  }
  return relative;
}

function absoluteProjectPath(projectRoot, relativePath) {
  const root = projectRootPath(projectRoot);
  const normalized = slashPath(relativePath).replace(/^\.\//u, "");
  const absolute = path.resolve(root, normalized);
  const checked = projectRelativePath(root, absolute);
  if (checked !== normalized) {
    throw new ProgSyncError(
      "NON_CANONICAL_PROJECT_PATH",
      `Expected a canonical project-relative path, received: ${relativePath}`,
      { normalized: checked }
    );
  }
  let current = root;
  for (const segment of normalized.split("/")) {
    current = path.join(current, segment);
    try {
      if (fs.lstatSync(current).isSymbolicLink()) {
        throw new ProgSyncError(
          "SYMLINKED_PROJECT_PATH",
          `ProgSync does not read or write module paths through symbolic links: ${relativePath}`,
          { relativePath: normalized }
        );
      }
    } catch (error) {
      if (error?.code === "ENOENT") {
        break;
      }
      throw error;
    }
  }
  return absolute;
}

function targetForImplementationPath(implementationPath) {
  const extension = path.posix.extname(slashPath(implementationPath)).toLowerCase();
  const target = TARGETS[extension];
  if (!target) {
    throw new ProgSyncError(
      "UNSUPPORTED_TARGET",
      `ProgSync does not yet support ${extension || "extensionless"} targets.`,
      {
        implementationPath,
        supportedExtensions: Object.keys(TARGETS)
      }
    );
  }
  return {
    extension,
    ...target
  };
}

function auxiliaryRootForImplementationPath(implementationPath) {
  const normalized = slashPath(implementationPath).replace(/^\.\//u, "");
  targetForImplementationPath(normalized);
  const extension = path.posix.extname(normalized);
  return `${normalized.slice(0, -extension.length)}/`;
}

function isOwnedAuxiliaryPath(implementationPath, candidatePath) {
  return slashPath(candidatePath).replace(/^\.\//u, "").startsWith(
    auxiliaryRootForImplementationPath(implementationPath)
  );
}

function implementationToProgramPath(implementationPath) {
  const normalized = slashPath(implementationPath).replace(/^\.\//u, "");
  if (
    normalized.startsWith(`${PROGRAM_DIRECTORY}/`) ||
    normalized.startsWith(".program/")
  ) {
    throw new ProgSyncError(
      "IMPLEMENTATION_PATH_EXPECTED",
      `Expected a managed implementation path, received: ${implementationPath}`
    );
  }
  targetForImplementationPath(normalized);
  return `${PROGRAM_DIRECTORY}/${normalized}.md`;
}

function programToImplementationPath(programPath) {
  const normalized = slashPath(programPath).replace(/^\.\//u, "");
  const prefix = `${PROGRAM_DIRECTORY}/`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(".md")) {
    throw new ProgSyncError(
      "PROGRAM_PATH_EXPECTED",
      `Expected a Program path below ${PROGRAM_DIRECTORY}/ ending in .md: ${programPath}`
    );
  }
  const implementationPath = normalized.slice(prefix.length, -3);
  targetForImplementationPath(implementationPath);
  return implementationPath;
}

function resolveModulePair(projectRoot, inputPath) {
  const root = projectRootPath(projectRoot);
  const relative = projectRelativePath(root, inputPath);
  const isProgram = relative.startsWith(`${PROGRAM_DIRECTORY}/`) && relative.endsWith(".md");
  const programPath = isProgram
    ? relative
    : implementationToProgramPath(relative);
  const implementationPath = isProgram
    ? programToImplementationPath(relative)
    : relative;
  const target = targetForImplementationPath(implementationPath);
  return {
    projectRoot: root,
    programPath,
    implementationPath,
    target
  };
}

function projectionPathForProgram(programPath) {
  const normalized = slashPath(programPath).replace(/^\.\//u, "");
  const prefix = `${PROGRAM_DIRECTORY}/`;
  if (!normalized.startsWith(prefix) || !normalized.endsWith(".md")) {
    throw new ProgSyncError(
      "PROGRAM_PATH_EXPECTED",
      `Cannot project a non-Program path: ${programPath}`
    );
  }
  return `${PROGRAM_INDEX_DIRECTORY}/${normalized.slice(prefix.length)}.json`;
}

function isSupportedImplementationPath(filePath) {
  const normalized = slashPath(filePath);
  return Boolean(TARGETS[path.posix.extname(normalized).toLowerCase()]);
}

function isTargetBoundProgramPath(filePath) {
  const normalized = slashPath(filePath);
  if (!normalized.startsWith(`${PROGRAM_DIRECTORY}/`) || !normalized.endsWith(".md")) {
    return false;
  }
  const implementationPath = normalized.slice(PROGRAM_DIRECTORY.length + 1, -3);
  return isSupportedImplementationPath(implementationPath);
}

export {
  absoluteProjectPath,
  auxiliaryRootForImplementationPath,
  implementationToProgramPath,
  isOwnedAuxiliaryPath,
  isSupportedImplementationPath,
  isTargetBoundProgramPath,
  programToImplementationPath,
  projectRelativePath,
  projectRootPath,
  projectionPathForProgram,
  resolveModulePair,
  slashPath,
  targetForImplementationPath
};
