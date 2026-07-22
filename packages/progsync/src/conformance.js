import fs from "node:fs/promises";
import path from "node:path";

import { sourceFactUses } from "./context.js";
import { ProgSyncError } from "./errors.js";
import { assertValidProgram, parseProgram, symbolAnchor } from "./program.js";
import { absoluteProjectPath } from "./paths.js";
import { extractSourceFacts } from "./structural.js";

function callableName(name) {
  return `${name}()`;
}

function expectedProvideName(exported) {
  return exported.kind === "function"
    ? callableName(exported.name)
    : exported.name;
}

function exactParameters(description, parameters = []) {
  return parameters.filter((parameter) => !description.includes(`\`${parameter}\``));
}

function objectParameterGroupCount(description) {
  const signatureEnd = String(description || "").search(/\breturns?\b/iu);
  const signature = signatureEnd === -1
    ? String(description || "")
    : String(description || "").slice(0, signatureEnd);
  return [...signature.matchAll(
    /\bone (?:optional )?(?:\[[^\]]+\]\s+)?object containing\b/giu
  )].length;
}

function describedParameterGroups(description) {
  const signatureEnd = String(description || "").search(/\breturns?\b/iu);
  const signature = signatureEnd === -1
    ? String(description || "")
    : String(description || "").slice(0, signatureEnd);
  const objectMatch = /\bone (?:optional )?(?:\[[^\]]+\]\s+)?object containing\b/iu.exec(signature);
  if (!objectMatch) {
    return null;
  }
  const parameterNames = (text) => [...text.matchAll(
    /`([A-Za-z_$][A-Za-z0-9_$]*)`\s+as\b/gu
  )].map((match) => match[1]);
  const positionalNames = parameterNames(signature.slice(0, objectMatch.index));
  const objectNames = parameterNames(signature.slice(objectMatch.index + objectMatch[0].length));
  if (objectNames.length === 0) {
    return null;
  }
  return [
    ...positionalNames.map((name) => ({ kind: "identifier", names: [name] })),
    { kind: "object", names: objectNames }
  ];
}

function parameterGroupText(groups) {
  return groups.length === 0
    ? "no arguments"
    : groups.map((group) => (
      group.kind === "object"
        ? `one object containing ${group.names.map((field) => `\`${field}\``).join(", ")}`
        : group.names.map((parameter) => `\`${parameter}\``).join(", ") || group.kind
    )).join("; ");
}

function validateParameterGrouping(name, provided, exported, diagnostics) {
  const expectedObjectGroups = objectParameterGroupCount(provided.description);
  const groups = exported.parameterGroups || [];
  const describedGroups = describedParameterGroups(provided.description);
  if (describedGroups) {
    const actualGroups = groups.map((group) => ({
      kind: group.kind,
      names: group.names || []
    }));
    if (JSON.stringify(describedGroups) !== JSON.stringify(actualGroups)) {
      diagnostics.push(
        `${name} must preserve its Program parameter grouping. ` +
        `Program arguments: ${parameterGroupText(describedGroups)}. ` +
        `Candidate arguments: ${parameterGroupText(actualGroups)}.`
      );
    }
    return;
  }
  const actualObjectGroups = groups.filter((group) => group.kind === "object").length;
  if (expectedObjectGroups === actualObjectGroups) {
    return;
  }
  diagnostics.push(
    `${name} must preserve its Program parameter grouping: the opening signature declares ` +
    `${expectedObjectGroups} object argument${expectedObjectGroups === 1 ? "" : "s"}, ` +
    `but the candidate has ${actualObjectGroups}. Candidate arguments: ${parameterGroupText(groups)}.`
  );
}

function regularExpressionText(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function resolvedForwardExport(exported, sourceFacts, projectRoot) {
  if (exported.kind !== "forward" || exported.imported === "*") {
    return exported;
  }
  const importedModule = (sourceFacts.imports || []).find((entry) => (
    entry.specifier === exported.from
  ));
  if (!importedModule?.programProvider) {
    return exported;
  }
  try {
    const source = await fs.readFile(
      absoluteProjectPath(projectRoot, importedModule.programProvider),
      "utf8"
    );
    const provider = parseProgram(source, {
      programPath: importedModule.programProvider
    });
    if (!provider.valid) {
      return exported;
    }
    const topLevel = provider.provides.filter((candidate) => !candidate.owner);
    const provided = topLevel.find((candidate) => (
      !candidate.owner &&
      symbolAnchor(candidate.name) === symbolAnchor(exported.imported)
    )) || (exported.imported === "default" && topLevel.length === 1
      ? topLevel[0]
      : null);
    if (!provided) {
      return exported;
    }
    return {
      ...exported,
      kind: provided.kind === "function" || provided.kind === "class"
        ? provided.kind
        : "value",
      methods: provided.kind === "class"
        ? provider.provides
          .filter((candidate) => candidate.owner === provided.name)
          .map((candidate) => ({
            kind: "method",
            name: candidate.name.replace(/\(\)$/u, ""),
            parameters: [],
            private: false
          }))
        : undefined,
      parameters: []
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return exported;
    }
    throw error;
  }
}

async function validateJavaScriptProvides(
  parsedProgram,
  sourceFacts,
  diagnostics,
  projectRoot
) {
  const topLevel = parsedProgram.provides.filter((provided) => !provided.owner);
  const expected = new Map();
  if (sourceFacts.entrypoint) {
    expected.set(sourceFacts.entrypoint.name, sourceFacts.entrypoint);
  }
  for (const unresolvedExport of sourceFacts.exports || []) {
    const exported = await resolvedForwardExport(
      unresolvedExport,
      sourceFacts,
      projectRoot
    );
    const name = expectedProvideName(exported);
    expected.set(name, exported);
    const provided = topLevel.find((candidate) => candidate.name === name);
    if (!provided) {
      diagnostics.push(`Implementation export ${exported.name} must be provided as ${name}.`);
      continue;
    }
    validateParameterGrouping(name, provided, exported, diagnostics);
    if (!describedParameterGroups(provided.description)) {
      for (const parameter of exactParameters(provided.description, exported.parameters)) {
        diagnostics.push(`${name} must name parameter \`${parameter}\` in its signature.`);
      }
    }
    if (exported.kind !== "class") {
      continue;
    }
    const methods = parsedProgram.provides.filter((candidate) => candidate.owner === exported.name);
    for (const method of (exported.methods || []).filter((candidate) => !candidate.private)) {
      const methodName = method.kind === "get" || method.kind === "set"
        ? method.name
        : callableName(method.name);
      const providedMethod = methods.find((candidate) => candidate.name === methodName);
      if (!providedMethod) {
        diagnostics.push(`Exported class ${exported.name} must describe public method ${methodName}.`);
        continue;
      }
      validateParameterGrouping(
        `${exported.name}.${methodName}`,
        providedMethod,
        method,
        diagnostics
      );
      if (!describedParameterGroups(providedMethod.description)) {
        for (const parameter of exactParameters(providedMethod.description, method.parameters)) {
          diagnostics.push(`${exported.name}.${methodName} must name parameter \`${parameter}\`.`);
        }
      }
    }
  }
  for (const provided of topLevel) {
    if (!expected.has(provided.name)) {
      diagnostics.push(`Program provides ${provided.name}, but the implementation does not export it.`);
    }
  }
}

function sameUse(left, right) {
  const leftProvider = String(left.provider || "");
  const rightProvider = String(right.provider || "");
  const [leftBase, leftAnchor = ""] = leftProvider.split("#");
  const [rightBase, rightAnchor = ""] = rightProvider.split("#");
  return leftBase === rightBase &&
    symbolAnchor(leftAnchor) === symbolAnchor(rightAnchor) &&
    symbolAnchor(left.symbol) === symbolAnchor(right.symbol);
}

async function validateImplementationUses({
  diagnostics,
  pair,
  parsedProgram,
  projectRoot,
  sourceFacts
}) {
  const requirements = await sourceFactUses(sourceFacts, {
    projectRoot,
    targetKind: pair.target.kind
  });
  for (const required of requirements) {
    if (!parsedProgram.uses.some((use) => sameUse(use, required))) {
      diagnostics.push(
        `Implementation dependency ${required.symbol} from ${required.provider} is missing from Program Uses.`
      );
    }
  }
  return requirements;
}

function providerTarget(provider) {
  const match = String(provider || "").match(/^@\/([^#]+\.md)#/u);
  if (!match || match[1] === "types.md" || !match[1].includes("/")) {
    return null;
  }
  return match[1].replace(/\.md$/u, "");
}

function programUseRequiresRuntimeBinding(use) {
  if (use.provider.startsWith("asset:") || use.provider.startsWith("@/types.md#")) {
    return false;
  }
  if (use.provider.startsWith("platform:") || use.provider.startsWith("package:")) {
    return true;
  }
  return Boolean(providerTarget(use.provider));
}

function validateProgramUses(parsedProgram, requirements, diagnostics) {
  for (const use of parsedProgram.uses) {
    if (
      programUseRequiresRuntimeBinding(use) &&
      !requirements.some((required) => sameUse(use, required))
    ) {
      diagnostics.push(
        `${use.symbol} from ${use.provider} has no matching implementation use of that exact symbol.`
      );
    }
  }
}

function validateVueSurface(pair, parsedProgram, sourceFacts, diagnostics) {
  const topLevel = parsedProgram.provides.filter((provided) => !provided.owner);
  const expectedName = path.posix.basename(pair.implementationPath, ".vue");
  if (topLevel.length !== 1 || topLevel[0].name !== expectedName) {
    diagnostics.push(`Vue Program must provide exactly the component ${expectedName}.`);
    return;
  }
  const description = topLevel[0].description;
  for (const prop of sourceFacts.props || []) {
    if (!description.includes(`\`${prop}\``)) {
      diagnostics.push(`${expectedName} must describe prop \`${prop}\`.`);
    }
  }
  for (const event of sourceFacts.emits || []) {
    if (!description.includes(`\`${event}\``)) {
      diagnostics.push(`${expectedName} must describe emitted event \`${event}\`.`);
    }
  }
  for (const operation of sourceFacts.exposes || []) {
    if (!description.includes(`\`${operation}\``)) {
      diagnostics.push(`${expectedName} must describe exposed operation \`${operation}\`.`);
    }
  }
  for (const slot of sourceFacts.slots || []) {
    if (!description.includes(`\`${slot}\``)) {
      diagnostics.push(`${expectedName} must describe slot \`${slot}\`.`);
    }
  }
}

function validateHtmlSurface(parsedProgram, diagnostics) {
  const topLevel = parsedProgram.provides.filter((provided) => !provided.owner);
  if (topLevel.length !== 1) {
    diagnostics.push("HTML Program must provide exactly one document or fragment.");
  }
}

function sameFileCallDiagnostics(parsedProgram) {
  const diagnostics = [];
  const functions = parsedProgram.provides.filter((provided) => (
    !provided.owner && provided.kind === "function"
  ));
  for (const provided of functions) {
    for (const other of functions) {
      if (provided === other) {
        continue;
      }
      const bareName = other.name.replace(/\(\)$/u, "");
      const exposesCall = new RegExp(
        `\\b(?:calls|invokes|uses)\\s+\\x60${regularExpressionText(bareName)}(?:\\(\\))?\\x60`,
        "iu"
      );
      if (exposesCall.test(provided.description)) {
        diagnostics.push(
          `${provided.name} exposes same-file call ${other.name}; describe its local behavior instead.`
        );
      }
    }
  }
  return diagnostics;
}

async function validatePairConformance({
  implementationSource,
  pair,
  programSource,
  projectRoot = pair.projectRoot
}) {
  const parsedProgram = assertValidProgram(programSource, {
    programPath: pair.programPath
  });
  const sourceFacts = await extractSourceFacts({
    implementationPath: pair.implementationPath,
    projectRoot,
    source: implementationSource,
    targetKind: pair.target.kind
  });
  const diagnostics = [
    ...sameFileCallDiagnostics(parsedProgram),
    ...(sourceFacts.diagnostics || []).map((diagnostic) => (
      `${diagnostic.code}: ${diagnostic.message}`
    ))
  ];
  if (pair.target.kind === "javascript") {
    await validateJavaScriptProvides(
      parsedProgram,
      sourceFacts,
      diagnostics,
      projectRoot
    );
  } else if (pair.target.kind === "vue") {
    validateVueSurface(pair, parsedProgram, sourceFacts, diagnostics);
  } else {
    validateHtmlSurface(parsedProgram, diagnostics);
  }
  const requirements = await validateImplementationUses({
    diagnostics,
    pair,
    parsedProgram,
    projectRoot,
    sourceFacts
  });
  validateProgramUses(parsedProgram, requirements, diagnostics);
  if (diagnostics.length > 0) {
    throw new ProgSyncError(
      "PAIR_SURFACE_MISMATCH",
      "Program and managed implementation do not have the same public structural surface.",
      { diagnostics }
    );
  }
  return { parsedProgram, sourceFacts };
}

export {
  validatePairConformance
};
