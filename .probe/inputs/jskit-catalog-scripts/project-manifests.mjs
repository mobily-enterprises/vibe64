import { readFile, readdir } from "node:fs/promises";
import path from "node:path";
import { fileExists, toPosixPath } from "./files.mjs";

// A JSKIT project's manifests: its root package.json and every workspace
// package.json it declares, read as records that keep their original text.
const SKIPPED_DIRECTORY_NAMES = new Set([
  ".git",
  ".cache",
  ".next",
  ".nuxt",
  ".output",
  ".turbo",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "tmp"
]);
function normalizeWorkspacePatterns(value) {
  if (Array.isArray(value)) {
    return value;
  }
  if (value && typeof value === "object" && Array.isArray(value.packages)) {
    return value.packages;
  }
  return [];
}

function globToRegExp(pattern = "") {
  const source = toPosixPath(pattern).replace(/^\.\//u, "").replace(/\/$/u, "");
  let expression = "^";

  for (let index = 0; index < source.length; index += 1) {
    const character = source[index];
    if (character === "*") {
      if (source[index + 1] === "*") {
        index += 1;
        if (source[index + 1] === "/") {
          index += 1;
          expression += "(?:.*/)?";
        } else {
          expression += ".*";
        }
      } else {
        expression += "[^/]*";
      }
      continue;
    }
    if (character === "?") {
      expression += "[^/]";
      continue;
    }
    expression += /[.+^${}()|[\]\\]/u.test(character) ? `\\${character}` : character;
  }

  return new RegExp(`${expression}$`, "u");
}

function createWorkspaceMatcher(workspaces) {
  const patterns = normalizeWorkspacePatterns(workspaces)
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  const includes = patterns
    .filter((entry) => !entry.startsWith("!"))
    .map(globToRegExp);
  const excludes = patterns
    .filter((entry) => entry.startsWith("!"))
    .map((entry) => globToRegExp(entry.slice(1)));

  return function matchesWorkspace(relativeDirectory = "") {
    const normalized = toPosixPath(relativeDirectory).replace(/^\.\//u, "").replace(/\/$/u, "");
    return includes.some((matcher) => matcher.test(normalized)) &&
      !excludes.some((matcher) => matcher.test(normalized));
  };
}

async function readJsonRecord(absolutePath) {
  const contents = await readFile(absolutePath, "utf8");
  let value;
  try {
    value = JSON.parse(contents);
  } catch (error) {
    throw new Error(`${absolutePath} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`);
  }
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${absolutePath} must contain a JSON object.`);
  }
  return { absolutePath, contents, value };
}

async function collectNestedPackageJsonPaths(directory, results = []) {
  for (const entry of await readdir(directory, { withFileTypes: true }).catch(() => [])) {
    if (!entry.isDirectory() || SKIPPED_DIRECTORY_NAMES.has(entry.name) || entry.name.startsWith(".")) {
      continue;
    }
    const childDirectory = path.join(directory, entry.name);
    const manifestPath = path.join(childDirectory, "package.json");
    if (await fileExists(manifestPath)) {
      results.push(manifestPath);
    }
    await collectNestedPackageJsonPaths(childDirectory, results);
  }
  return results;
}

async function discoverProjectManifests(projectRoot, additionalManifests = []) {
  const root = path.resolve(projectRoot);
  const rootManifestPath = path.join(root, "package.json");
  if (!(await fileExists(rootManifestPath))) {
    throw new Error(`JSKIT project root has no package.json: ${root}`);
  }
  const rootManifest = await readJsonRecord(rootManifestPath);
  const matchesWorkspace = createWorkspaceMatcher(rootManifest.value.workspaces);
  const nestedPaths = await collectNestedPackageJsonPaths(root);
  const workspacePaths = nestedPaths
    .filter((manifestPath) => matchesWorkspace(path.relative(root, path.dirname(manifestPath))))
    .sort((left, right) => left.localeCompare(right));
  const manifests = [rootManifest];
  for (const manifestPath of new Set([...workspacePaths, ...additionalManifests.map((file) => path.resolve(root, file))])) {
    if (manifestPath === rootManifestPath) continue;
    manifests.push(await readJsonRecord(manifestPath));
  }
  return Object.freeze(manifests);
}

function serializePackageJson(value, originalContents = "") {
  const indentMatch = /\n([ \t]+)"/u.exec(String(originalContents || ""));
  const indentation = indentMatch?.[1] || "  ";
  return `${JSON.stringify(value, null, indentation)}\n`;
}

export { discoverProjectManifests, readJsonRecord, serializePackageJson };
