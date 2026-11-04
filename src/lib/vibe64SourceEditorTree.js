// The source tree as the editor holds it: directory pages merged as they load,
// the selected file's ancestors revealed, and the loaded folders listed again
// on refresh.
import { normalizeSourceEditorPath } from "@/lib/vibe64SourceEditorLinks.js";

const SOURCE_EDITOR_TREE_PAGE_SIZE = 20;

function normalizeTreeNode(value = null) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return null;
  }
  const type = String(value.type || "");
  const path = normalizeSourceEditorPath(value.path);
  if (type === "file") {
    return {
      language: String(value.language || ""),
      name: String(value.name || ""),
      path,
      size: Number(value.size || 0),
      type
    };
  }
  if (type !== "directory") {
    return null;
  }
  return {
    children: (Array.isArray(value.children) ? value.children : [])
      .map((child) => normalizeTreeNode(child))
      .filter(Boolean),
    hasMore: value.hasMore === true,
    limit: Math.max(1, Number(value.limit || SOURCE_EDITOR_TREE_PAGE_SIZE)),
    loaded: value.loaded === true,
    name: String(value.name || ""),
    nextOffset: Math.max(0, Number(value.nextOffset || 0)),
    offset: Math.max(0, Number(value.offset || 0)),
    path,
    total: Math.max(0, Number(value.total || 0)),
    truncated: value.truncated === true,
    type
  };
}

function mergeDirectoryChildren(existingChildren, pageChildren = [], append = false) {
  const byKey = new Map((existingChildren || []).map((child) => [treeNodeKey(child), child]));
  const mergedChildren = pageChildren.map((child) => {
    const previous = byKey.get(treeNodeKey(child));
    return child.type === "directory" && previous?.loaded && !child.loaded
      ? { ...child, ...previous, name: child.name }
      : child;
  });
  if (!append) {
    return mergedChildren;
  }
  for (const child of mergedChildren) {
    byKey.set(treeNodeKey(child), child);
  }
  return [...byKey.values()];
}

function treeNodeKey(node = {}) {
  return normalizeSourceEditorPath(node.path) || String(node.name || "");
}

function sortTreeNodes(children = []) {
  return [...children].sort((left, right) => {
    if (left?.type !== right?.type) {
      return left?.type === "directory" ? -1 : 1;
    }
    return String(left?.name || "").localeCompare(String(right?.name || ""));
  });
}

function mergeDirectoryPage(root = null, directoryPath = "", page = null, append = false) {
  const normalizedPath = normalizeSourceEditorPath(directoryPath);
  const normalizedPage = normalizeTreeNode(page);
  if (!normalizedPage) {
    return root;
  }
  if (!normalizedPath) {
    return {
      ...normalizedPage,
      children: mergeDirectoryChildren(root?.children, normalizedPage.children, append)
    };
  }
  function visit(node = null) {
    if (!node || node.type !== "directory") {
      return node;
    }
    if (normalizeSourceEditorPath(node.path) === normalizedPath) {
      return {
        ...node,
        ...normalizedPage,
        children: mergeDirectoryChildren(node.children, normalizedPage.children, append)
      };
    }
    return {
      ...node,
      children: (Array.isArray(node.children) ? node.children : []).map((child) => visit(child))
    };
  }
  return visit(root);
}

function mergeRevealedTreeNode(existing = null, reveal = null) {
  const normalizedReveal = normalizeTreeNode(reveal);
  if (!normalizedReveal) {
    return normalizeTreeNode(existing);
  }
  const normalizedExisting = normalizeTreeNode(existing);
  if (!normalizedExisting || treeNodeKey(normalizedExisting) !== treeNodeKey(normalizedReveal)) {
    return normalizedReveal;
  }
  if (normalizedExisting.type !== "directory" || normalizedReveal.type !== "directory") {
    return normalizedExisting;
  }
  const childrenByKey = new Map((normalizedExisting.children || [])
    .map((child) => [treeNodeKey(child), child]));
  for (const child of normalizedReveal.children || []) {
    const key = treeNodeKey(child);
    childrenByKey.set(key, mergeRevealedTreeNode(childrenByKey.get(key), child));
  }
  return {
    ...normalizedExisting,
    children: sortTreeNodes([...childrenByKey.values()])
  };
}

function mergeRevealTree(root = null, revealTree = null) {
  const normalizedReveal = normalizeTreeNode(revealTree);
  if (!normalizedReveal) {
    return root;
  }
  return mergeRevealedTreeNode(root, normalizedReveal);
}

function findTreeDirectory(root = null, directoryPath = "") {
  const normalizedPath = normalizeSourceEditorPath(directoryPath);
  if (!root || root.type !== "directory") {
    return null;
  }
  if (normalizeSourceEditorPath(root.path) === normalizedPath) {
    return root;
  }
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const found = findTreeDirectory(child, normalizedPath);
    if (found) {
      return found;
    }
  }
  return null;
}

function loadedFileAncestorDirectoryPaths(root = null, filePath = "", ancestors = []) {
  const normalizedFilePath = normalizeSourceEditorPath(filePath);
  if (!root || !normalizedFilePath) {
    return null;
  }
  if (root.type === "file") {
    return normalizeSourceEditorPath(root.path) === normalizedFilePath ? ancestors : null;
  }
  if (root.type !== "directory") {
    return null;
  }
  const normalizedDirectoryPath = normalizeSourceEditorPath(root.path);
  const childAncestors = normalizedDirectoryPath
    ? [...ancestors, normalizedDirectoryPath]
    : ancestors;
  for (const child of Array.isArray(root.children) ? root.children : []) {
    const found = loadedFileAncestorDirectoryPaths(child, normalizedFilePath, childAncestors);
    if (found) {
      return found;
    }
  }
  return null;
}

function loadedTreeDirectoryPaths(root = null) {
  const paths = [];
  function visit(node = null) {
    if (!node || node.type !== "directory") {
      return;
    }
    const normalizedPath = normalizeSourceEditorPath(node.path);
    if (normalizedPath && node.loaded === true) {
      paths.push(normalizedPath);
    }
    for (const child of Array.isArray(node.children) ? node.children : []) {
      visit(child);
    }
  }
  visit(root);
  return [...new Set(paths)].sort((left, right) => {
    const depthDifference = left.split("/").length - right.split("/").length;
    return depthDifference || left.localeCompare(right);
  });
}

export {
  SOURCE_EDITOR_TREE_PAGE_SIZE,
  findTreeDirectory,
  loadedFileAncestorDirectoryPaths,
  loadedTreeDirectoryPaths,
  mergeDirectoryPage,
  mergeRevealTree,
  normalizeTreeNode
};
