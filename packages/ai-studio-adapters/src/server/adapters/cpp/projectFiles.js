import {
  readdir,
  readFile
} from "node:fs/promises";
import path from "node:path";

import {
  normalizeText,
  pathExists
} from "@local/ai-studio-core/server/core";

const CPP_HEADER_EXTENSIONS = new Set([".h", ".hh", ".hpp", ".hxx", ".ipp", ".tpp"]);
const CPP_SOURCE_EXTENSIONS = new Set([".c", ".cc", ".cpp", ".cxx", ".m", ".mm"]);
const CPP_SCAN_DIRECTORIES = Object.freeze(["src", "include", "tests", "test", "lib", "app"]);
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".ai-studio",
  "build",
  "cmake-build-debug",
  "cmake-build-release",
  "node_modules",
  "out",
  "vendor"
]);

function normalizedRelativePath(value = "") {
  return normalizeText(value).replaceAll(path.sep, "/");
}

function fileExtension(filePath = "") {
  return path.extname(filePath).toLowerCase();
}

function isCppHeader(filePath = "") {
  return CPP_HEADER_EXTENSIONS.has(fileExtension(filePath));
}

function isCppSource(filePath = "") {
  return CPP_SOURCE_EXTENSIONS.has(fileExtension(filePath));
}

function isCppFile(filePath = "") {
  return isCppHeader(filePath) || isCppSource(filePath);
}

async function readTextIfExists(filePath = "") {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return "";
    }
    throw error;
  }
}

async function listFilesRecursive(root = "", relativeDirectory = "") {
  const directory = path.join(root, relativeDirectory);
  let entries = [];
  try {
    entries = await readdir(directory, {
      withFileTypes: true
    });
  } catch (error) {
    if (error?.code === "ENOENT" || error?.code === "ENOTDIR") {
      return [];
    }
    throw error;
  }

  const files = [];
  for (const entry of entries) {
    if (IGNORED_DIRECTORIES.has(entry.name)) {
      continue;
    }
    const relativePath = path.join(relativeDirectory, entry.name);
    if (entry.isDirectory()) {
      files.push(...await listFilesRecursive(root, relativePath));
      continue;
    }
    if (entry.isFile()) {
      files.push(normalizedRelativePath(relativePath));
    }
  }
  return files;
}

async function findCppFiles(targetRoot = "") {
  const discovered = new Set();
  for (const directory of CPP_SCAN_DIRECTORIES) {
    for (const filePath of await listFilesRecursive(targetRoot, directory)) {
      if (isCppFile(filePath)) {
        discovered.add(filePath);
      }
    }
  }
  for (const filePath of await listFilesRecursive(targetRoot, "")) {
    if (!filePath.includes("/") && isCppFile(filePath)) {
      discovered.add(filePath);
    }
  }
  const files = [...discovered].sort((left, right) => left.localeCompare(right));
  return {
    all: files,
    headers: files.filter(isCppHeader),
    sources: files.filter(isCppSource)
  };
}

function markerExists(markers = [], markerId = "") {
  return markers.some((marker) => marker.id === markerId && marker.exists);
}

function detectCppBuildSystem(markers = []) {
  if (markerExists(markers, "cmake_lists")) {
    return "cmake";
  }
  if (markerExists(markers, "makefile") || markerExists(markers, "gnumakefile")) {
    return "make";
  }
  if (markerExists(markers, "meson_build")) {
    return "meson";
  }
  return "unknown";
}

function buildManifestExists(markers = []) {
  return detectCppBuildSystem(markers) !== "unknown";
}

function parseCmakeTargets(cmakeText = "") {
  const targets = [];
  const targetPattern = /\badd_(executable|library)\s*\(\s*([A-Za-z_][A-Za-z0-9_.:-]*)/gu;
  for (const match of cmakeText.matchAll(targetPattern)) {
    targets.push({
      kind: match[1],
      name: match[2]
    });
  }
  return targets.sort((left, right) => left.name.localeCompare(right.name));
}

function parseCmakeProjectName(cmakeText = "") {
  return normalizeText(cmakeText.match(/\bproject\s*\(\s*([A-Za-z_][A-Za-z0-9_.:-]*)/u)?.[1]);
}

async function readCmakeProject(targetRoot = "") {
  const cmakeText = await readTextIfExists(path.join(targetRoot, "CMakeLists.txt"));
  return {
    projectName: parseCmakeProjectName(cmakeText),
    targets: parseCmakeTargets(cmakeText)
  };
}

function parseMakeTargets(makefileText = "") {
  const targets = [];
  const targetPattern = /^([A-Za-z0-9_.-][A-Za-z0-9_.-]*):(?:\s|$)/gmu;
  for (const match of makefileText.matchAll(targetPattern)) {
    if (!match[1].startsWith(".")) {
      targets.push(match[1]);
    }
  }
  return [...new Set(targets)].sort((left, right) => left.localeCompare(right));
}

async function readMakeTargets(targetRoot = "") {
  const makefilePath = await pathExists(path.join(targetRoot, "Makefile"))
    ? path.join(targetRoot, "Makefile")
    : path.join(targetRoot, "GNUmakefile");
  return parseMakeTargets(await readTextIfExists(makefilePath));
}

function cppProjectReady({
  cppFiles = {},
  markers = []
} = {}) {
  return buildManifestExists(markers) && (cppFiles.all || []).length > 0;
}

export {
  buildManifestExists,
  cppProjectReady,
  detectCppBuildSystem,
  findCppFiles,
  markerExists,
  parseCmakeTargets,
  parseMakeTargets,
  readCmakeProject,
  readMakeTargets,
  readTextIfExists
};
