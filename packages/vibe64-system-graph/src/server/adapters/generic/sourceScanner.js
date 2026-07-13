import { createHash } from "node:crypto";
import { readFile, readdir } from "node:fs/promises";
import path from "node:path";

import {
  normalizeFileCityPath
} from "../../../shared/fileCityContract.js";

const MAX_SOURCE_FILE_BYTES = 4 * 1024 * 1024;
const MAX_SOURCE_FILES = 20_000;
const EXCLUDED_DIRECTORIES = new Set([
  ".angular",
  ".cache",
  ".git",
  ".next",
  ".nuxt",
  ".output",
  ".parcel-cache",
  ".pnpm-store",
  ".svelte-kit",
  ".turbo",
  ".venv",
  ".vite",
  ".vibe64",
  ".yarn",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target",
  "vendor"
]);

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function sourceLineCount(source = "") {
  const normalized = String(source || "").replace(/\r\n?|\n/gu, "\n");
  if (!normalized) {
    return 0;
  }
  const separators = normalized.match(/\n/gu)?.length || 0;
  return separators + (normalized.endsWith("\n") ? 0 : 1);
}

function sourceFileIncluded(filePath = "", profile = {}) {
  const name = path.posix.basename(filePath);
  const normalized = String(filePath || "").toLowerCase();
  return (profile.specialFiles || []).includes(name) ||
    (profile.extensions || []).some((extension) => normalized.endsWith(String(extension).toLowerCase()));
}

function sourcePathExcluded(filePath = "", profile = {}) {
  const normalized = normalizeFileCityPath(filePath);
  return (profile.excludedPaths || []).some((excludedPath) => {
    const excluded = normalizeFileCityPath(excludedPath);
    return normalized === excluded || normalized.startsWith(`${excluded}/`);
  });
}

function pathInside(rootPath = "", candidatePath = "") {
  const root = normalizeFileCityPath(rootPath);
  const candidate = normalizeFileCityPath(candidatePath);
  return candidate === root || candidate.startsWith(`${root}/`);
}

function executionSideForPath(filePath = "", profile = {}) {
  for (const campus of profile.campuses || []) {
    if ((campus.roots || []).some((root) => pathInside(root, filePath))) {
      return campus.executionSide || "unknown";
    }
  }
  return "unknown";
}

async function scanSourceTree(sourceRoot, profile = {}) {
  const files = [];
  const diagnostics = [];
  let limitReported = false;

  async function visit(absoluteDirectory, relativeDirectory = "") {
    if (files.length >= MAX_SOURCE_FILES) {
      if (!limitReported) {
        diagnostics.push({
          code: "source_file_limit_reached",
          line: 0,
          message: `The draft ${profile.label} System adapter stopped after ${MAX_SOURCE_FILES} source files.`,
          path: relativeDirectory
        });
        limitReported = true;
      }
      return;
    }
    const entries = await readdir(absoluteDirectory, { withFileTypes: true });
    for (const entry of entries.sort((left, right) => left.name.localeCompare(right.name))) {
      if (files.length >= MAX_SOURCE_FILES) {
        break;
      }
      const relativePath = normalizeFileCityPath(path.posix.join(relativeDirectory, entry.name));
      const absolutePath = path.join(absoluteDirectory, entry.name);
      if (entry.isDirectory()) {
        if (!EXCLUDED_DIRECTORIES.has(entry.name) && !sourcePathExcluded(relativePath, profile)) {
          await visit(absolutePath, relativePath);
        }
        continue;
      }
      if (!entry.isFile() || !sourceFileIncluded(relativePath, profile)) {
        continue;
      }
      const content = await readFile(absolutePath);
      if (content.length > MAX_SOURCE_FILE_BYTES) {
        diagnostics.push({
          code: "source_file_too_large",
          line: 0,
          message: `Skipped a source file larger than ${MAX_SOURCE_FILE_BYTES} bytes.`,
          path: relativePath
        });
        continue;
      }
      if (content.includes(0)) {
        diagnostics.push({
          code: "binary_source_file_skipped",
          line: 0,
          message: "Skipped a source-looking file containing binary data.",
          path: relativePath
        });
        continue;
      }
      const source = content.toString("utf8");
      files.push({
        bytes: content.length,
        executionSide: executionSideForPath(relativePath, profile),
        hash: createHash("sha256").update(content).digest("hex"),
        id: `file:${relativePath}`,
        implementedEntityIds: [],
        imports: [],
        lines: sourceLineCount(source),
        packageId: "",
        path: relativePath
      });
    }
  }

  await visit(sourceRoot);
  return {
    diagnostics: stableSort(diagnostics, (diagnostic) => `${diagnostic.path}:${diagnostic.code}`),
    files: stableSort(files, (file) => file.path)
  };
}

export {
  EXCLUDED_DIRECTORIES,
  MAX_SOURCE_FILE_BYTES,
  MAX_SOURCE_FILES,
  scanSourceTree
};
