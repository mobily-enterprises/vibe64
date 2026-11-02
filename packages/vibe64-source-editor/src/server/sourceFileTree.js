import { lstat, readdir } from "node:fs/promises";
import path from "node:path";

import { sourceEditorPathExcluded } from "./filePolicy.js";
import { sourceEditorLanguageForPath } from "./sourceEditorLanguage.js";
import {
  absoluteSourceEditorPath,
  normalizeSourceEditorRelativePath,
  sourceEditorError,
  sourceEditorPathStats
} from "./sourceEditorPaths.js";
import { sourceEditorResultLimit, sourceEditorResultOffset } from "./sourceFileMatches.js";

// The source tree the editor shows: one folder's page of entries and the
// folders that reveal one file.
const SOURCE_EDITOR_TREE_PAGE_LIMIT = 20;

async function sourceEditorDirectoryPage(context = {}, options = {}) {
  const {
    limit = SOURCE_EDITOR_TREE_PAGE_LIMIT,
    offset = 0,
    path: relativePathValue = ""
  } = options;
  const {
    policy,
    sourceRoot
  } = context;
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (relativePath && sourceEditorPathExcluded(policy, relativePath)) {
    throw sourceEditorError("The selected directory is excluded from source editing.", "vibe64_source_editor_directory_excluded", {
      path: relativePath
    }, 403);
  }
  const absolutePath = absoluteSourceEditorPath(sourceRoot, relativePath);
  if (relativePath) {
    const stats = await sourceEditorPathStats(sourceRoot, relativePath);
    if (!stats.isDirectory()) {
      throw sourceEditorError("Choose a source directory.", "vibe64_invalid_source_editor_directory", {
        path: relativePath
      });
    }
  }

  const depth = relativePath ? relativePath.split("/").length : 0;
  const normalizedLimit = sourceEditorResultLimit(limit, SOURCE_EDITOR_TREE_PAGE_LIMIT);
  const normalizedOffset = sourceEditorResultOffset(offset);
  if (depth >= policy.maxTreeDepth) {
    return directoryNode(relativePath, [], {
      hasMore: false,
      limit: normalizedLimit,
      loaded: true,
      nextOffset: normalizedOffset,
      offset: normalizedOffset,
      total: 0,
      truncated: true
    });
  }

  const entries = await readdir(absolutePath, {
    withFileTypes: true
  });
  entries.sort((left, right) => {
    if (left.isDirectory() !== right.isDirectory()) {
      return left.isDirectory() ? -1 : 1;
    }
    return left.name.localeCompare(right.name);
  });

  const visibleEntries = [];
  for (const entry of entries) {
    const childRelativePath = relativePath
      ? `${relativePath}/${entry.name}`
      : entry.name;
    if (sourceEditorPathExcluded(policy, childRelativePath) || entry.isSymbolicLink()) {
      continue;
    }
    if (entry.isDirectory() || entry.isFile()) {
      visibleEntries.push({
        entry,
        relativePath: childRelativePath
      });
    }
  }

  const total = Math.min(visibleEntries.length, policy.maxTreeEntries);
  const pageEntries = visibleEntries.slice(normalizedOffset, Math.min(total, normalizedOffset + normalizedLimit));
  const children = await Promise.all(pageEntries.map(async ({ entry, relativePath: childRelativePath }) => {
    if (entry.isDirectory()) {
      return directoryNode(childRelativePath, [], {
        loaded: false
      });
    }
    return sourceEditorFileNode(sourceRoot, childRelativePath);
  }));
  const nextOffset = Math.min(total, normalizedOffset + children.length);
  return directoryNode(relativePath, children, {
    hasMore: nextOffset < total,
    limit: normalizedLimit,
    loaded: true,
    nextOffset,
    offset: normalizedOffset,
    total,
    truncated: visibleEntries.length > total
  });
}

function directoryNode(relativePath = "", children = [], metadata = {}) {
  return {
    children,
    hasMore: metadata.hasMore === true,
    limit: Number.isInteger(metadata.limit) ? metadata.limit : SOURCE_EDITOR_TREE_PAGE_LIMIT,
    loaded: metadata.loaded === true,
    name: relativePath ? path.posix.basename(relativePath) : "",
    nextOffset: Number.isInteger(metadata.nextOffset) ? metadata.nextOffset : children.length,
    offset: Number.isInteger(metadata.offset) ? metadata.offset : 0,
    path: relativePath,
    total: Number.isInteger(metadata.total) ? metadata.total : children.length,
    truncated: metadata.truncated === true,
    type: "directory"
  };
}

async function sourceEditorFileNode(sourceRoot = "", relativePath = "") {
  const stats = await lstat(absoluteSourceEditorPath(sourceRoot, relativePath));
  return {
    language: sourceEditorLanguageForPath(relativePath),
    name: path.posix.basename(relativePath),
    path: relativePath,
    size: stats.size,
    type: "file"
  };
}

async function sourceEditorFileRevealTree(context = {}, relativePathValue = "") {
  const relativePath = normalizeSourceEditorRelativePath(relativePathValue);
  if (!relativePath) {
    return null;
  }
  const segments = relativePath.split("/").filter(Boolean);
  if (!segments.length) {
    return null;
  }
  let node = await sourceEditorFileNode(context.sourceRoot, relativePath);
  for (let index = segments.length - 1; index > 0; index -= 1) {
    const directoryPath = segments.slice(0, index).join("/");
    node = directoryNode(directoryPath, [node], {
      hasMore: false,
      loaded: false,
      nextOffset: 1,
      total: 1
    });
  }
  return directoryNode("", [node], {
    hasMore: false,
    loaded: false,
    nextOffset: 1,
    total: 1
  });
}

export {
  directoryNode,
  sourceEditorDirectoryPage,
  sourceEditorFileRevealTree
};
