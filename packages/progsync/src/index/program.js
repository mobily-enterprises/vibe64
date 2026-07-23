import crypto from "node:crypto";
import fs from "node:fs/promises";

import { ProgSyncError } from "./errors.js";
import { writeFileAtomic } from "./files.js";
import {
  absoluteProjectPath,
  auxiliaryRootForImplementationPath,
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

function visibleMarkdownLines(lines) {
  const visible = new Array(lines.length).fill(true);
  let fence = null;
  for (let index = 0; index < lines.length; index += 1) {
    const line = lines[index];
    if (fence) {
      visible[index] = false;
      const close = line.match(/^ {0,3}(`+|~+)[ \t]*$/u);
      if (
        close &&
        close[1][0] === fence.marker &&
        close[1].length >= fence.length
      ) {
        fence = null;
      }
      continue;
    }
    const open = line.match(/^ {0,3}(`{3,}|~{3,})(.*)$/u);
    if (open && (open[1][0] !== "`" || !open[2].includes("`"))) {
      visible[index] = false;
      fence = { marker: open[1][0], length: open[1].length };
    }
  }
  return visible;
}

function maskInlineCodeSpans(line) {
  const source = String(line || "");
  let masked = source;
  let openerStart = 0;

  while (openerStart < source.length) {
    if (source[openerStart] !== "`") {
      openerStart += 1;
      continue;
    }
    let openerEnd = openerStart + 1;
    while (source[openerEnd] === "`") {
      openerEnd += 1;
    }
    const delimiterLength = openerEnd - openerStart;
    let candidateStart = openerEnd;
    let closingEnd = -1;
    while (candidateStart < source.length) {
      if (source[candidateStart] !== "`") {
        candidateStart += 1;
        continue;
      }
      let candidateEnd = candidateStart + 1;
      while (source[candidateEnd] === "`") {
        candidateEnd += 1;
      }
      if (candidateEnd - candidateStart === delimiterLength) {
        closingEnd = candidateEnd;
        break;
      }
      candidateStart = candidateEnd;
    }
    if (closingEnd === -1) {
      openerStart = openerEnd;
      continue;
    }
    masked = `${masked.slice(0, openerStart)}${" ".repeat(closingEnd - openerStart)}${masked.slice(closingEnd)}`;
    openerStart = closingEnd;
  }

  return masked;
}

function markdownHeadings(lines) {
  const headings = [];
  const visible = visibleMarkdownLines(lines);

  for (let index = 0; index < lines.length; index += 1) {
    if (!visible[index]) {
      continue;
    }
    const line = lines[index];
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
    try {
      targetForImplementationPath(relative.replace(/\.md$/u, ""));
    } catch (error) {
      if (error?.code === "UNSUPPORTED_TARGET") {
        return "library";
      }
      throw error;
    }
  }
  return "value";
}

function classMemberFromHeading(headingText) {
  const match = String(headingText || "").match(/^`(static )?([^`]+)`$/u);
  if (!match || !match[2].endsWith("()")) {
    return null;
  }
  const name = match[2];
  if (name === "constructor()") {
    return match[1]
      ? { invalid: "A class constructor cannot be static." }
      : { memberKind: "constructor", name };
  }
  return {
    memberKind: match[1] ? "static" : "instance",
    name
  };
}

function providedIdentityAnchor(provided) {
  if (provided.kind === "class") {
    return `class-${symbolAnchor(provided.name)}`;
  }
  if (!provided.owner) {
    return symbolAnchor(provided.name);
  }
  const memberName = provided.memberKind === "static"
    ? `static ${provided.name}`
    : provided.name;
  return symbolAnchor(`${provided.owner}.${memberName}`);
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
  const providersBySymbol = new Map();
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
    const previousProvider = providersBySymbol.get(symbol);
    if (previousProvider === provider) {
      diagnostics.push({
        code: "DUPLICATE_USE",
        line: usesHeading.line + offset + 1,
        message: `${symbol} from ${provider} is listed more than once.`
      });
    } else if (previousProvider) {
      diagnostics.push({
        code: "AMBIGUOUS_USE_SYMBOL",
        line: usesHeading.line + offset + 1,
        message: `${symbol} cannot resolve to both ${previousProvider} and ${provider}. Uses symbols must be unique within a Program module.`
      });
    } else {
      providersBySymbol.set(symbol, provider);
    }
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
  const visible = visibleMarkdownLines(lines);
  for (let index = 0; index < lines.length; index += 1) {
    if (!visible[index]) {
      continue;
    }
    const line = lines[index];
    const searchable = maskInlineCodeSpans(line)
      .replace(/!?\[[^\]]+\]\([^)]+\)/gu, "");
    const pattern = /\[([A-Za-z][A-Za-z0-9]*(?: [A-Za-z][A-Za-z0-9]*)*)\](?!\s*[([])/gu;
    for (const match of searchable.matchAll(pattern)) {
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

function parameterName(text) {
  return String(text || "").match(/`([^`]+)`/u)?.[1] || null;
}

function parseParameters(source, line, diagnostics) {
  const text = String(source || "").trim();
  if (/^(?:None|No parameters)\.?$/iu.test(text)) {
    return [];
  }
  const parameters = [];
  let current = null;
  for (const [offset, sourceLine] of text.split("\n").entries()) {
    if (!sourceLine.trim()) {
      continue;
    }
    const match = sourceLine.match(/^(\s*)[*-]\s+(.+?)\s*$/u);
    if (!match) {
      diagnostics.push({
        code: "INVALID_PARAMETER_ITEM",
        line: line + offset,
        message: "Parameters must contain one Markdown bullet per argument and nested bullets for object fields."
      });
      continue;
    }
    const item = {
      description: match[2],
      name: parameterName(match[2])
    };
    if (match[1].length === 0) {
      current = { ...item, fields: [] };
      parameters.push(current);
    } else if (!current) {
      diagnostics.push({
        code: "ORPHAN_PARAMETER_FIELD",
        line: line + offset,
        message: "An object-field bullet must follow its containing argument."
      });
    } else {
      current.fields.push(item);
    }
  }
  if (parameters.length === 0) {
    diagnostics.push({
      code: "EMPTY_PARAMETERS",
      line,
      message: "Parameters must list every argument or state `No parameters.`"
    });
  }
  for (const parameter of parameters) {
    const describesObject = /\bobject containing\b/iu.test(parameter.description);
    if (!describesObject && !parameter.name) {
      diagnostics.push({
        code: "MISSING_PARAMETER_NAME",
        line,
        message: "Every positional parameter bullet must name its exact parameter in backticks."
      });
    }
    if (describesObject && parameter.fields.length === 0) {
      diagnostics.push({
        code: "EMPTY_OBJECT_PARAMETER",
        line,
        message: "An object parameter must list its public fields as nested bullets."
      });
    }
    if (!describesObject && parameter.fields.length > 0) {
      diagnostics.push({
        code: "UNDECLARED_OBJECT_PARAMETER",
        line,
        message: "A parameter with nested fields must say that it is an object containing those fields."
      });
    }
    for (const field of parameter.fields) {
      if (!field.name) {
        diagnostics.push({
          code: "MISSING_PARAMETER_FIELD_NAME",
          line,
          message: "Every object-field bullet must name its exact field in backticks."
        });
      }
    }
  }
  return parameters;
}

function operationSections(lines, headings, heading, diagnostics) {
  const body = sectionLines(lines, headings, heading);
  const nested = headings.filter((candidate) => (
    candidate.level === 4 &&
    candidate.index > heading.index &&
    candidate.index < body.endIndex
  ));
  const expected = ["Parameters", "What it does", "Returns"];
  const sections = {};
  for (const name of expected) {
    const matching = nested.filter((candidate) => candidate.text === name);
    if (matching.length !== 1) {
      diagnostics.push({
        code: `INVALID_${name.toUpperCase().replaceAll(" ", "_")}_COUNT`,
        line: matching[0]?.line || heading.line,
        message: `${heading.text} requires exactly one #### ${name} section; found ${matching.length}.`
      });
      continue;
    }
    const content = contentBelowHeading(lines, headings, matching[0]);
    if (!content) {
      diagnostics.push({
        code: `EMPTY_${name.toUpperCase().replaceAll(" ", "_")}`,
        line: matching[0].line,
        message: `#### ${name} cannot be empty.`
      });
    }
    sections[name] = {
      content,
      heading: matching[0]
    };
  }
  for (const unexpected of nested.filter((candidate) => !expected.includes(candidate.text))) {
    diagnostics.push({
      code: "UNEXPECTED_OPERATION_SECTION",
      line: unexpected.line,
      message: `${heading.text} has unsupported operation section #### ${unexpected.text}.`
    });
  }
  if (
    expected.every((name) => sections[name]) &&
    expected.some((name, index) => nested.indexOf(sections[name].heading) !== index)
  ) {
    diagnostics.push({
      code: "INVALID_OPERATION_SECTION_ORDER",
      line: heading.line,
      message: `${heading.text} sections must be ordered Parameters, What it does, Returns.`
    });
  }
  const parameters = sections.Parameters
    ? parseParameters(
      sections.Parameters.content,
      sections.Parameters.heading.line + 1,
      diagnostics
    )
    : [];
  return {
    behavior: sections["What it does"]?.content || "",
    parameters,
    parametersSource: sections.Parameters?.content || "",
    returns: sections.Returns?.content || ""
  };
}

function parseProgram(programSource, { programPath = "program/unknown.js.md" } = {}) {
  const source = String(programSource ?? "").replace(/\r\n?/gu, "\n");
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
    const match = line.trim().match(/^- The exported class \[`([^`]+)`\]\(#class-([a-z0-9][a-z0-9-]*)\)\.$/u);
    return match
      ? [{ anchor: match[2], line: (providesHeading?.line || 0) + offset + 1, name: match[1] }]
      : [];
  });

  for (const [offset, line] of providesSection.lines.entries()) {
    if (line.includes("#class-") && !line.trim().match(
      /^- The exported class \[`([^`]+)`\]\(#class-([a-z0-9][a-z0-9-]*)\)\.$/u
    )) {
      diagnostics.push({
        code: "INVALID_CLASS_PROVIDE",
        line: (providesHeading?.line || 0) + offset + 1,
        message: "An exported class must use `- The exported class [`Name`](#class-name).` beneath Provides."
      });
    }
  }

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
    if (underClass) {
      const member = classMemberFromHeading(heading.text);
      if (!member || member.invalid) {
        diagnostics.push({
          code: "INVALID_CLASS_MEMBER_HEADING",
          line: heading.line,
          message: member?.invalid || "A public instance method uses `method()`; a static method uses `static method()`; and the constructor uses `constructor()`."
        });
      }
    } else if (underProvides && !/^`[^`]+`$/u.test(heading.text)) {
      diagnostics.push({
        code: "INVALID_PROVIDE_HEADING",
        line: heading.line,
        message: "Provided symbols require exact backticked level-three headings."
      });
    }
  }

  for (const classHeading of classHeadings) {
    const className = classHeading.text.match(/^Class\s+`([^`]+)`$/u)?.[1] || "";
    const classSection = sectionLines(lines, headings, classHeading);
    const members = headings
      .filter((heading) => (
        heading.level === 3 &&
        heading.index > classHeading.index &&
        heading.index < classSection.endIndex
      ))
      .map((heading) => classMemberFromHeading(heading.text))
      .filter((member) => member && !member.invalid);
    const constructors = members.filter((member) => member.memberKind === "constructor");
    if (constructors.length !== 1) {
      diagnostics.push({
        code: "INVALID_CLASS_CONSTRUCTOR_COUNT",
        line: classHeading.line,
        message: `Exported class ${className} requires exactly one ### \`constructor()\` operation; found ${constructors.length}.`
      });
    }
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
    const member = classMatch ? classMemberFromHeading(heading.text) : null;
    const nameMatch = classMatch ? null : heading.text.match(/^`([^`]+)`$/u);
    if ((classMatch && (!member || member.invalid)) || (!classMatch && !nameMatch)) {
      continue;
    }
    const name = member?.name || nameMatch[1];
    const owner = classMatch?.[1] || null;
    const description = contentBelowHeading(lines, headings, heading);
    const kind = inferProvidedKind({ owner, programPath, symbol: name });
    const operation = ["command", "function", "method"].includes(kind)
      ? operationSections(lines, headings, heading, diagnostics)
      : null;
    provides.push({
      name,
      owner,
      kind,
      ...(owner ? { memberKind: member.memberKind } : {}),
      description,
      ...(operation || {}),
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
    const identity = providedIdentityAnchor(provided);
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
    schemaVersion: 2,
    programFile: normalizedProgramPath,
    targetFile: target.targetFile,
    targetKind: target.targetKind,
    auxiliaryRoot: target.targetFile
      ? auxiliaryRootForImplementationPath(target.targetFile)
      : null,
    sourceHash: `sha256:${crypto.createHash("sha256").update(parsed.source).digest("hex")}`,
    title: parsed.title,
    preamble: parsed.preamble,
    typeReferences: parsed.typeReferences.map((reference) => ({
      name: reference.name,
      provider: `@/types.md#${symbolAnchor(reference.name)}`,
      source: reference.source
    })),
    provides: parsed.provides.map((provided) => ({
      id: `@/${providerPath}#${providedIdentityAnchor(provided)}`,
      name: provided.name,
      ...(provided.owner ? { owner: provided.owner } : {}),
      ...(provided.memberKind ? { memberKind: provided.memberKind } : {}),
      kind: provided.kind,
      description: provided.description,
      ...(["command", "function", "method"].includes(provided.kind)
        ? {
          parameters: provided.parameters,
          behavior: provided.behavior,
          returns: provided.returns
        }
        : {}),
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
