import { readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";
import { toPosixPath } from "./files.mjs";

const PATTERN_DOCUMENT_NAME = "PATTERN.md";
const PATTERN_EXAMPLE_DIRECTORY = "example";
const PATTERN_ID_PATTERN = /^[a-z0-9]+(?:[/-][a-z0-9]+(?:-[a-z0-9]+)*)*$/;
const PATTERN_FRONT_MATTER_FIELDS = new Set([
  "id",
  "title",
  "summary",
  "keywords",
  "requires"
]);
const REQUIRED_PATTERN_SECTIONS = Object.freeze([
  "Use when",
  "Do not use when",
  "Product decisions",
  "Invariants",
  "Framework APIs",
  "Example files",
  "Variation points",
  "Verification",
  "Avoid"
]);

function normalizeText(value = "") {
  return String(value || "").trim();
}

function sortedUniqueStrings(values = []) {
  return [...new Set(values.map(normalizeText).filter(Boolean))]
    .sort((left, right) => left.localeCompare(right));
}

function parseCommaSeparatedValue(value = "") {
  return sortedUniqueStrings(String(value || "").split(","));
}

function requirePatternFrontMatter(source = "", { documentPath = PATTERN_DOCUMENT_NAME } = {}) {
  const normalizedSource = String(source || "").replace(/\r\n?/g, "\n");
  if (!normalizedSource.startsWith("---\n")) {
    throw new Error(`${documentPath} must begin with Markdown front matter.`);
  }

  const closingIndex = normalizedSource.indexOf("\n---\n", 4);
  if (closingIndex < 0) {
    throw new Error(`${documentPath} has unterminated Markdown front matter.`);
  }

  const fields = {};
  const fieldLines = normalizedSource.slice(4, closingIndex).split("\n");
  for (const [index, rawLine] of fieldLines.entries()) {
    const line = normalizeText(rawLine);
    if (!line) {
      continue;
    }

    const separatorIndex = line.indexOf(":");
    if (separatorIndex < 1) {
      throw new Error(`${documentPath} front matter line ${index + 2} must be key: value.`);
    }

    const key = normalizeText(line.slice(0, separatorIndex));
    const value = normalizeText(line.slice(separatorIndex + 1));
    if (!PATTERN_FRONT_MATTER_FIELDS.has(key)) {
      throw new Error(`${documentPath} front matter contains unsupported field "${key}".`);
    }
    if (Object.hasOwn(fields, key)) {
      throw new Error(`${documentPath} front matter repeats field "${key}".`);
    }
    fields[key] = value;
  }

  return {
    fields,
    body: normalizedSource.slice(closingIndex + 5)
  };
}

function requirePatternSections(body = "", { documentPath = PATTERN_DOCUMENT_NAME } = {}) {
  const headings = new Set(
    [...String(body || "").matchAll(/^##\s+(.+?)\s*$/gm)]
      .map((match) => normalizeText(match[1]).toLowerCase())
  );

  const missing = REQUIRED_PATTERN_SECTIONS.filter(
    (section) => !headings.has(section.toLowerCase())
  );
  if (missing.length > 0) {
    throw new Error(`${documentPath} is missing required section(s): ${missing.join(", ")}.`);
  }
}

function parsePatternDocument(source = "", { documentPath = PATTERN_DOCUMENT_NAME } = {}) {
  const { fields, body } = requirePatternFrontMatter(source, { documentPath });
  const id = normalizeText(fields.id);
  const title = normalizeText(fields.title);
  const summary = normalizeText(fields.summary);
  const keywords = parseCommaSeparatedValue(fields.keywords);
  const requires = parseCommaSeparatedValue(fields.requires);

  if (!PATTERN_ID_PATTERN.test(id)) {
    throw new Error(`${documentPath} id must be a lowercase slash-separated pattern id.`);
  }
  if (!title) {
    throw new Error(`${documentPath} requires title.`);
  }
  if (!summary) {
    throw new Error(`${documentPath} requires summary.`);
  }
  if (keywords.length < 1) {
    throw new Error(`${documentPath} requires at least one keyword.`);
  }

  const firstHeading = String(body || "").match(/^#\s+(.+?)\s*$/m)?.[1] || "";
  if (normalizeText(firstHeading) !== title) {
    throw new Error(`${documentPath} first heading must exactly match title "${title}".`);
  }
  requirePatternSections(body, { documentPath });

  return Object.freeze({
    id,
    title,
    summary,
    keywords: Object.freeze(keywords),
    requires: Object.freeze(requires)
  });
}

async function directoryExists(directoryPath) {
  try {
    return (await stat(directoryPath)).isDirectory();
  } catch (error) {
    if (error?.code === "ENOENT") {
      return false;
    }
    throw error;
  }
}

async function collectFiles(rootDirectory) {
  const files = [];

  async function walk(currentDirectory) {
    const entries = await readdir(currentDirectory, { withFileTypes: true });
    entries.sort((left, right) => left.name.localeCompare(right.name));

    for (const entry of entries) {
      const absolutePath = path.join(currentDirectory, entry.name);
      if (entry.isDirectory()) {
        await walk(absolutePath);
        continue;
      }
      if (entry.isFile()) {
        files.push(toPosixPath(path.relative(rootDirectory, absolutePath)));
      }
    }
  }

  await walk(rootDirectory);
  return files;
}

async function discoverPackagePatterns({ packageRoot, packageJson } = {}) {
  const resolvedPackageRoot = path.resolve(String(packageRoot || ""));
  const packageId = normalizeText(packageJson?.name);
  const packageVersion = normalizeText(packageJson?.version);
  if (!packageId || !packageVersion) {
    throw new Error(`Pattern owner at ${resolvedPackageRoot} requires package name and version.`);
  }

  const patternsRoot = path.join(resolvedPackageRoot, "patterns");
  if (!(await directoryExists(patternsRoot))) {
    return [];
  }

  const patternDirectories = (await readdir(patternsRoot, { withFileTypes: true }))
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith("."))
    .sort((left, right) => left.name.localeCompare(right.name));
  const patterns = [];

  for (const entry of patternDirectories) {
    const patternRoot = path.join(patternsRoot, entry.name);
    const documentPath = path.join(patternRoot, PATTERN_DOCUMENT_NAME);
    const relativeDocumentPath = toPosixPath(path.relative(resolvedPackageRoot, documentPath));
    let source;
    try {
      source = await readFile(documentPath, "utf8");
    } catch (error) {
      if (error?.code === "ENOENT") {
        throw new Error(`${packageId} pattern directory ${entry.name} requires ${PATTERN_DOCUMENT_NAME}.`);
      }
      throw error;
    }

    const metadata = parsePatternDocument(source, {
      documentPath: `${packageId}/${relativeDocumentPath}`
    });
    if (metadata.id.split("/").at(-1) !== entry.name) {
      throw new Error(
        `${packageId}/${relativeDocumentPath} id "${metadata.id}" must end with directory name "${entry.name}".`
      );
    }

    const exampleRoot = path.join(patternRoot, PATTERN_EXAMPLE_DIRECTORY);
    if (!(await directoryExists(exampleRoot))) {
      throw new Error(`${packageId} pattern ${metadata.id} requires an example/ directory.`);
    }
    const files = await collectFiles(exampleRoot);
    if (files.length < 1) {
      throw new Error(`${packageId} pattern ${metadata.id} requires at least one example file.`);
    }

    patterns.push(Object.freeze({
      ...metadata,
      packageId,
      packageVersion,
      documentPath: relativeDocumentPath,
      examplePath: toPosixPath(path.relative(resolvedPackageRoot, exampleRoot)),
      files: Object.freeze(files)
    }));
  }

  return patterns;
}

function assertUniquePatternIds(patterns = []) {
  const ownerById = new Map();
  for (const pattern of patterns) {
    const previousOwner = ownerById.get(pattern.id);
    if (previousOwner) {
      throw new Error(
        `Duplicate JSKIT pattern id "${pattern.id}" in ${previousOwner} and ${pattern.packageId}.`
      );
    }
    ownerById.set(pattern.id, pattern.packageId);
  }
}

export {
  PATTERN_DOCUMENT_NAME,
  PATTERN_EXAMPLE_DIRECTORY,
  REQUIRED_PATTERN_SECTIONS,
  assertUniquePatternIds,
  discoverPackagePatterns,
  parsePatternDocument
};
