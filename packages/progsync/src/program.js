import crypto from "node:crypto";
import fs from "node:fs/promises";

import { ProgSyncError } from "./errors.js";
import { writeFileAtomic } from "./files.js";
import {
  absoluteProjectPath,
  programToImplementationPath,
  projectionPathForProgram,
  slashPath,
  targetForImplementationPath
} from "./paths.js";

function normalizeSymbolName(value) {
  return String(value || "")
    .trim()
    .replace(/^`|`$/gu, "");
}

function symbolAnchor(value) {
  const normalized = normalizeSymbolName(value);
  if (normalized === "*") {
    return "all-exports";
  }
  return normalized
    .replace(/\(\)$/u, "")
    .normalize("NFKD")
    .toLowerCase()
    .replace(/[^a-z0-9]+/gu, "-")
    .replace(/^-+|-+$/gu, "");
}

function markdownHeadings(lines) {
  const headings = [];
  let fence = "";

  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      if (!fence) {
        fence = marker;
      } else if (fence === marker) {
        fence = "";
      }
      continue;
    }
    if (fence) {
      continue;
    }
    const match = line.match(/^(#{1,6})\s+(.+?)\s*$/u);
    if (!match) {
      continue;
    }
    headings.push({
      index,
      level: match[1].length,
      line: index + 1,
      text: match[2].trim()
    });
  }

  return headings;
}

function contentBelowHeading(lines, headings, heading) {
  const next = headings.find((candidate) => (
    candidate.index > heading.index && candidate.level <= heading.level
  ));
  return lines
    .slice(heading.index + 1, next ? next.index : lines.length)
    .join("\n")
    .trim();
}

function sectionLines(lines, headings, heading) {
  const next = headings.find((candidate) => (
    candidate.index > heading.index && candidate.level <= heading.level
  ));
  return {
    endIndex: next ? next.index : lines.length,
    lines: lines.slice(heading.index + 1, next ? next.index : lines.length)
  };
}

function inferProvidedKind({ owner, programPath, symbol }) {
  if (owner) {
    return "method";
  }
  if (slashPath(programPath) === "program/types.md") {
    return "type";
  }
  if (/\.vue\.md$/u.test(programPath)) {
    return "component";
  }
  if (/\.html\.md$/u.test(programPath)) {
    return "document";
  }
  const relative = slashPath(programPath).replace(/^program\//u, "");
  const commandName = relative.match(/^bin\/(?:.*\/)?([^/]+)\.(?:js|mjs)\.md$/u)?.[1];
  if (commandName && symbol === commandName) {
    return "command";
  }
  const testName = relative.match(/(?:^|\/)([^/]+)\.test\.(?:js|mjs)\.md$/u)?.[1];
  if (testName && symbol === `${testName} tests`) {
    return "test";
  }
  if (/\(\)$/u.test(symbol)) {
    return "function";
  }
  if (!relative.includes("/")) {
    return "library";
  }
  return "value";
}

function hasTraversalSegment(value) {
  return String(value || "").split("/").some((segment) => segment === "..");
}

function canonicalProvider(provider) {
  if (provider.startsWith("@/")) {
    const match = provider.match(/^@\/([^#]+\.md)#([a-z0-9][a-z0-9-]*)$/u);
    return Boolean(
      match &&
      !match[1].startsWith("/") &&
      !match[1].includes("\\") &&
      !hasTraversalSegment(match[1])
    );
  }
  if (provider.startsWith("package:")) {
    return /^package:npm\/[^\s#]+#[a-z0-9][a-z0-9-]*$/u.test(provider);
  }
  if (provider.startsWith("platform:")) {
    return /^platform:[^\s#]+#[a-z0-9][a-z0-9-]*$/u.test(provider);
  }
  if (provider.startsWith("asset:")) {
    const identity = provider.slice("asset:".length);
    return Boolean(
      identity &&
      !identity.startsWith("/") &&
      !identity.includes("\\") &&
      !/\s/u.test(identity) &&
      !hasTraversalSegment(identity)
    );
  }
  return false;
}

function parseUses(lines, headings, usesHeading, diagnostics) {
  const uses = [];
  const seen = new Set();
  const section = sectionLines(lines, headings, usesHeading);
  let statesNothingOutside = false;

  for (let offset = 0; offset < section.lines.length; offset += 1) {
    const line = section.lines[offset];
    const trimmed = line.trim();
    if (!trimmed) {
      continue;
    }
    if (!trimmed.startsWith("-")) {
      diagnostics.push({
        code: "INVALID_USES_CONTENT",
        line: usesHeading.line + offset + 1,
        message: "Uses contains only provider-list items or `- Nothing outside this file.`"
      });
      continue;
    }
    if (/^-\s+Nothing outside this file\.?$/iu.test(trimmed)) {
      statesNothingOutside = true;
      continue;
    }
    const match = trimmed.match(/^-\s+\[(`[^`]+`)\]\(([^)]+)\)(?:\s+(.*))?$/u);
    if (!match) {
      diagnostics.push({
        code: "INVALID_USE",
        line: usesHeading.line + offset + 1,
        message: "Every Uses item must be a Markdown link to its exact provider."
      });
      continue;
    }
    const symbol = normalizeSymbolName(match[1]);
    const provider = match[2].trim();
    if (provider.startsWith("@/types.md#")) {
      diagnostics.push({
        code: "TYPE_IN_USES",
        line: usesHeading.line + offset + 1,
        message: "Shared types use [Type name] in Program prose and do not appear in Uses."
      });
    }
    if (
      !provider.startsWith("@/") &&
      !provider.startsWith("package:") &&
      !provider.startsWith("platform:") &&
      !provider.startsWith("asset:")
    ) {
      diagnostics.push({
        code: "INVALID_PROVIDER",
        line: usesHeading.line + offset + 1,
        message: `Provider for ${symbol} must use @/, package:, platform:, or asset:.`
      });
    }
    if (!canonicalProvider(provider)) {
      diagnostics.push({
        code: "MALFORMED_PROVIDER",
        line: usesHeading.line + offset + 1,
        message: `Provider for ${symbol} is not a canonical Program provider identity.`
      });
    }
    const identity = `${provider}|${symbolAnchor(symbol)}`;
    if (seen.has(identity)) {
      diagnostics.push({
        code: "DUPLICATE_USE",
        line: usesHeading.line + offset + 1,
        message: `${symbol} from ${provider} is listed more than once.`
      });
    }
    seen.add(identity);
    uses.push({
      symbol,
      provider,
      description: (match[3] || "").trim(),
      source: {
        line: usesHeading.line + offset + 1
      }
    });
  }

  if (uses.length === 0 && !statesNothingOutside) {
    diagnostics.push({
      code: "EMPTY_USES",
      line: usesHeading.line,
      message: "Uses must contain provider links or `- Nothing outside this file.`"
    });
  }
  if (uses.length > 0 && statesNothingOutside) {
    diagnostics.push({
      code: "CONTRADICTORY_USES",
      line: usesHeading.line,
      message: "Uses cannot name dependencies and also state that nothing outside the file is used."
    });
  }

  return uses;
}

function parseTypeReferences(lines, lineOffset = 0) {
  const references = new Map();
  let fence = "";
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    const fenceMatch = line.match(/^\s*(`{3,}|~{3,})/u);
    if (fenceMatch) {
      const marker = fenceMatch[1][0];
      fence = fence ? (fence === marker ? "" : fence) : marker;
      continue;
    }
    if (fence) {
      continue;
    }
    const pattern = /\[([A-Za-z][A-Za-z0-9]*(?: [A-Za-z][A-Za-z0-9]*)*)\](?!\s*[([])/gu;
    for (const match of line.matchAll(pattern)) {
      const name = match[1];
      if (!references.has(name)) {
        references.set(name, {
          name,
          source: { line: lineOffset + index + 1 }
        });
      }
    }
  }
  return [...references.values()];
}

function openingSentence(source) {
  const text = String(source ?? "");
  let codeFenceLength = 0;
  for (let index = 0; index < text.length; index += 1) {
    if (text[index] === "`") {
      let runLength = 1;
      while (text[index + runLength] === "`") {
        runLength += 1;
      }
      if (codeFenceLength === 0) {
        codeFenceLength = runLength;
      } else if (runLength === codeFenceLength) {
        codeFenceLength = 0;
      }
      index += runLength - 1;
      continue;
    }
    if (
      text[index] === "." &&
      codeFenceLength === 0 &&
      (index === text.length - 1 || /\s/u.test(text[index + 1]))
    ) {
      return text.slice(0, index + 1);
    }
  }
  return text;
}

function parseProgram(programSource, { programPath = "program/unknown.js.md" } = {}) {
  const source = String(programSource ?? "").replaceAll("\r\n", "\n");
  const lines = source.split("\n");
  const headings = markdownHeadings(lines);
  const diagnostics = [];
  const h1 = headings.filter((heading) => heading.level === 1);
  const usesHeadings = headings.filter((heading) => heading.level === 2 && heading.text === "Uses");
  const providesHeadings = headings.filter((heading) => heading.level === 2 && heading.text === "Provides");

  if (h1.length !== 1) {
    diagnostics.push({
      code: "INVALID_TITLE_COUNT",
      line: h1[0]?.line || 1,
      message: `Program requires exactly one level-one title; found ${h1.length}.`
    });
  }
  if (usesHeadings.length !== 1) {
    diagnostics.push({
      code: "INVALID_USES_COUNT",
      line: usesHeadings[0]?.line || 1,
      message: `Program requires exactly one ## Uses section; found ${usesHeadings.length}.`
    });
  }
  if (providesHeadings.length !== 1) {
    diagnostics.push({
      code: "INVALID_PROVIDES_COUNT",
      line: providesHeadings[0]?.line || 1,
      message: `Program requires exactly one ## Provides section; found ${providesHeadings.length}.`
    });
  }

  const titleHeading = h1[0] || null;
  const firstLevelTwo = headings.find((heading) => heading.level === 2);
  const preamble = titleHeading
    ? lines
      .slice(titleHeading.index + 1, firstLevelTwo ? firstLevelTwo.index : lines.length)
      .join("\n")
      .trim()
    : "";
  const uses = usesHeadings[0]
    ? parseUses(lines, headings, usesHeadings[0], diagnostics)
    : [];
  const typeReferences = parseTypeReferences(lines);
  const provides = [];
  const classHeadings = headings.filter((heading) => (
    heading.level === 2 && /^Class\s+`[^`]+`$/u.test(heading.text)
  ));
  const providesHeading = providesHeadings[0] || null;
  const providesSection = providesHeading
    ? sectionLines(lines, headings, providesHeading)
    : { endIndex: -1, lines: [] };
  const listedClasses = providesSection.lines.flatMap((line, offset) => {
    const match = line.trim().match(/^-\s+.*\[`([^`]+)`\]\(#class-([a-z0-9][a-z0-9-]*)\).*$/u);
    return match
      ? [{ anchor: match[2], line: (providesHeading?.line || 0) + offset + 1, name: match[1] }]
      : [];
  });

  for (const heading of headings.filter((candidate) => candidate.level === 3)) {
    const priorLevelTwo = [...headings]
      .reverse()
      .find((candidate) => candidate.level === 2 && candidate.index < heading.index);
    const underProvides = Boolean(
      providesHeading &&
      heading.index > providesHeading.index &&
      heading.index < providesSection.endIndex
    );
    const underClass = Boolean(priorLevelTwo?.text.match(/^Class\s+`[^`]+`$/u));
    if ((underProvides || underClass) && !/^`[^`]+`$/u.test(heading.text)) {
      diagnostics.push({
        code: "INVALID_PROVIDE_HEADING",
        line: heading.line,
        message: "Provided symbols and public methods require exact backticked level-three headings."
      });
    }
  }

  for (const classHeading of classHeadings) {
    const className = classHeading.text.match(/^Class\s+`([^`]+)`$/u)?.[1] || "";
    if (!listedClasses.some((listed) => (
      listed.name === className && listed.anchor === symbolAnchor(className)
    ))) {
      diagnostics.push({
        code: "UNLISTED_CLASS",
        line: classHeading.line,
        message: `Exported class ${className} must be listed in ## Provides.`
      });
    }
    provides.push({
      name: className,
      kind: "class",
      description: contentBelowHeading(lines, headings, classHeading).split(/^###\s/mu)[0].trim(),
      typeReferences: parseTypeReferences(
        contentBelowHeading(lines, headings, classHeading).split(/^###\s/mu)[0].trim().split("\n"),
        classHeading.line
      ),
      source: {
        line: classHeading.line
      }
    });
  }

  for (const listed of listedClasses) {
    if (listed.anchor !== symbolAnchor(listed.name)) {
      diagnostics.push({
        code: "INVALID_CLASS_LINK",
        line: listed.line,
        message: `Class ${listed.name} must link to #class-${symbolAnchor(listed.name)}.`
      });
    }
    if (!classHeadings.some((heading) => heading.text === `Class \`${listed.name}\``)) {
      diagnostics.push({
        code: "MISSING_CLASS_SECTION",
        line: listed.line,
        message: `Class ${listed.name} is listed in Provides but has no level-two class section.`
      });
    }
  }

  for (const heading of headings.filter((candidate) => candidate.level === 3)) {
    const nameMatch = heading.text.match(/^`([^`]+)`$/u);
    if (!nameMatch) {
      continue;
    }
    const priorLevelTwo = [...headings]
      .reverse()
      .find((candidate) => candidate.level === 2 && candidate.index < heading.index);
    const classMatch = priorLevelTwo?.text.match(/^Class\s+`([^`]+)`$/u);
    const underProvides = Boolean(
      providesHeading &&
      heading.index > providesHeading.index &&
      heading.index < providesSection.endIndex
    );
    if (!underProvides && !classMatch) {
      continue;
    }
    const name = nameMatch[1];
    const owner = classMatch?.[1] || null;
    const description = contentBelowHeading(lines, headings, heading);
    provides.push({
      name,
      owner,
      kind: inferProvidedKind({ owner, programPath, symbol: name }),
      description,
      typeReferences: parseTypeReferences(description.split("\n"), heading.line),
      source: {
        line: heading.line
      }
    });
  }

  if (providesHeading && provides.length === 0) {
    diagnostics.push({
      code: "EMPTY_PROVIDES",
      line: providesHeading.line,
      message: "Program must describe at least one provided public symbol."
    });
  }

  const providedIdentities = new Map();
  for (const provided of provides) {
    const identity = symbolAnchor(provided.owner
      ? `${provided.owner}.${provided.name}`
      : provided.name);
    if (providedIdentities.has(identity)) {
      diagnostics.push({
        code: "DUPLICATE_PROVIDE",
        line: provided.source.line,
        message: `${provided.owner ? `${provided.owner}.` : ""}${provided.name} duplicates another provided symbol identity.`
      });
    } else {
      providedIdentities.set(identity, provided);
    }
    if (!provided.description) {
      diagnostics.push({
        code: "EMPTY_PROVIDE_DESCRIPTION",
        line: provided.source.line,
        message: `${provided.name} requires a human-readable definition.`
      });
    }
    if (
      (provided.kind === "function" || provided.kind === "method") &&
      !/^The (?:function|method)\b/u.test(provided.description)
    ) {
      diagnostics.push({
        code: "INVALID_OPERATION_SIGNATURE",
        line: provided.source.line,
        message: `${provided.name} must begin with "The function" or "The method" and its human-readable signature.`
      });
    }
    if (
      (provided.kind === "function" || provided.kind === "method") &&
      !/\breturns?\b/iu.test(openingSentence(provided.description))
    ) {
      diagnostics.push({
        code: "MISSING_OPERATION_RESULT",
        line: provided.source.line,
        message: `${provided.name} must state its result or that it returns no value in its opening signature.`
      });
    }
  }

  return {
    diagnostics,
    preamble,
    programPath: slashPath(programPath),
    provides,
    source,
    title: titleHeading?.text || "",
    typeReferences,
    uses,
    valid: diagnostics.length === 0
  };
}

function assertValidProgram(programSource, options = {}) {
  const parsed = parseProgram(programSource, options);
  if (!parsed.valid) {
    throw new ProgSyncError(
      "INVALID_PROGRAM",
      `Program validation failed for ${options.programPath || "the supplied module"}.`,
      { diagnostics: parsed.diagnostics }
    );
  }
  return parsed;
}

function relationshipKind(use) {
  if (use.provider.startsWith("asset:")) {
    return "generation";
  }
  const providerPath = use.provider.match(/^@\/([^#]+)/u)?.[1] || "";
  if (providerPath && !providerPath.includes("/")) {
    return "generation";
  }
  return "runtime";
}

function programTarget(programPath) {
  const normalized = slashPath(programPath);
  if (normalized === "program/types.md") {
    return {
      targetFile: null,
      targetKind: "types"
    };
  }
  try {
    const targetFile = programToImplementationPath(normalized);
    return {
      targetFile,
      targetKind: targetForImplementationPath(targetFile).kind
    };
  } catch (error) {
    const relative = normalized.replace(/^program\//u, "");
    if (!relative.includes("/") && relative.endsWith(".md")) {
      return {
        targetFile: null,
        targetKind: "library"
      };
    }
    throw error;
  }
}

function canonicalObject(value) {
  if (Array.isArray(value)) {
    return value.map(canonicalObject);
  }
  if (!value || typeof value !== "object") {
    return value;
  }
  return Object.fromEntries(
    Object.keys(value)
      .sort((left, right) => left.localeCompare(right))
      .map((key) => [key, canonicalObject(value[key])])
  );
}

function stableJson(value) {
  return `${JSON.stringify(canonicalObject(value), null, 2)}\n`;
}

function buildProgramProjection({ parsedProgram = null, programPath, programSource }) {
  const parsed = parsedProgram || parseProgram(programSource, { programPath });
  const target = programTarget(programPath);
  const normalizedProgramPath = slashPath(programPath);
  const providerPath = normalizedProgramPath.replace(/^program\//u, "");
  return canonicalObject({
    schemaVersion: 1,
    programFile: normalizedProgramPath,
    targetFile: target.targetFile,
    targetKind: target.targetKind,
    sourceHash: `sha256:${crypto.createHash("sha256").update(parsed.source).digest("hex")}`,
    title: parsed.title,
    preamble: parsed.preamble,
    types: parsed.typeReferences.map((reference) => reference.name),
    provides: parsed.provides.map((provided) => ({
      id: `@/${providerPath}#${symbolAnchor(provided.owner ? `${provided.owner}.${provided.name}` : provided.name)}`,
      name: provided.name,
      ...(provided.owner ? { owner: provided.owner } : {}),
      kind: provided.kind,
      description: provided.description,
      source: provided.source
    })),
    uses: parsed.uses.map((use) => ({
      symbol: use.symbol,
      provider: use.provider,
      kind: relationshipKind(use),
      ...(use.description ? { description: use.description } : {}),
      source: use.source
    })),
    diagnostics: parsed.diagnostics
  });
}

async function writeProgramProjection({
  parsedProgram = null,
  programPath,
  programSource,
  projectRoot,
  projection: suppliedProjection = null
}) {
  const projection = suppliedProjection || buildProgramProjection({
    parsedProgram,
    programPath,
    programSource
  });
  const projectionPath = projectionPathForProgram(programPath);
  const absolutePath = absoluteProjectPath(projectRoot, projectionPath);
  await writeFileAtomic(absolutePath, stableJson(projection), 0o644);
  return {
    projection,
    projectionPath
  };
}

async function projectionStatus({
  parsedProgram = null,
  programPath,
  programSource,
  projectRoot,
  projection: suppliedProjection = null
}) {
  const projection = suppliedProjection || buildProgramProjection({
    parsedProgram,
    programPath,
    programSource
  });
  const projectionPath = projectionPathForProgram(programPath);
  const absolutePath = absoluteProjectPath(projectRoot, projectionPath);
  const expected = stableJson(projection);
  let actual = null;
  try {
    actual = await fs.readFile(absolutePath, "utf8");
  } catch (error) {
    if (error?.code !== "ENOENT") {
      throw error;
    }
  }
  return {
    current: actual === expected,
    expected,
    projection,
    projectionPath
  };
}

export {
  assertValidProgram,
  buildProgramProjection,
  parseProgram,
  projectionStatus,
  stableJson,
  symbolAnchor,
  writeProgramProjection
};
