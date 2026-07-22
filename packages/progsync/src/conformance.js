import fs from "node:fs/promises";
import path from "node:path";

import { sourceFactUses } from "./context.js";
import { ProgSyncError } from "./errors.js";
import { assertValidProgram, parseProgram, symbolAnchor } from "./program.js";
import { absoluteProjectPath, slashPath } from "./paths.js";
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

function regularExpressionText(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

function validateOperationTiming({ async, description, name }, diagnostics) {
  const describedAsynchronous = /^The asynchronous (?:function|method)\b/u.test(description);
  if (Boolean(async) !== describedAsynchronous) {
    diagnostics.push(
      `${name} must be described as ${async ? "asynchronous" : "synchronous"}.`
    );
  }
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
      async: /^The asynchronous (?:function|method)\b/u.test(provided.description),
      kind: provided.kind === "function" || provided.kind === "class"
        ? provided.kind
        : "value",
      methods: provided.kind === "class"
        ? provider.provides
          .filter((candidate) => candidate.owner === provided.name)
          .map((candidate) => ({
            async: /^The asynchronous method\b/u.test(candidate.description),
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
    for (const parameter of exactParameters(provided.description, exported.parameters)) {
      diagnostics.push(`${name} must name parameter \`${parameter}\` in its signature.`);
    }
    if (exported.kind === "function") {
      validateOperationTiming({
        async: exported.async,
        description: provided.description,
        name
      }, diagnostics);
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
      for (const parameter of exactParameters(providedMethod.description, method.parameters)) {
        diagnostics.push(`${exported.name}.${methodName} must name parameter \`${parameter}\`.`);
      }
      validateOperationTiming({
        async: method.async,
        description: providedMethod.description,
        name: `${exported.name}.${methodName}`
      }, diagnostics);
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
}

function providerTarget(provider) {
  const match = String(provider || "").match(/^@\/([^#]+\.md)#/u);
  if (!match || match[1] === "types.md" || !match[1].includes("/")) {
    return null;
  }
  return match[1].replace(/\.md$/u, "");
}

function programUseIsRealized(use, sourceFacts) {
  if (use.provider.startsWith("asset:") || use.provider.startsWith("platform:")) {
    return true;
  }
  if (use.provider.startsWith("@/types.md#")) {
    return true;
  }
  const target = providerTarget(use.provider);
  if (target) {
    return (sourceFacts.imports || []).some((entry) => (
      slashPath(entry.resolvedTarget) === slashPath(target)
    ));
  }
  if (use.provider.startsWith("@/")) {
    return true;
  }
  if (use.provider.startsWith("package:")) {
    const specifier = use.provider.slice("package:npm/".length).split("#")[0];
    return (sourceFacts.imports || []).some((entry) => entry.specifier === specifier);
  }
  return false;
}

function validateProgramUses(parsedProgram, sourceFacts, diagnostics) {
  for (const use of parsedProgram.uses) {
    if (!programUseIsRealized(use, sourceFacts)) {
      diagnostics.push(`${use.symbol} from ${use.provider} has no implementation import or binding.`);
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
  const diagnostics = sameFileCallDiagnostics(parsedProgram);
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
  await validateImplementationUses({
    diagnostics,
    pair,
    parsedProgram,
    projectRoot,
    sourceFacts
  });
  validateProgramUses(parsedProgram, sourceFacts, diagnostics);
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
