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

function implementationClassMember(method) {
  return {
    memberKind: method.kind === "constructor"
      ? "constructor"
      : method.static
        ? "static"
        : "instance",
    name: method.kind === "get" || method.kind === "set"
      ? method.name
      : callableName(method.name)
  };
}

function describedParameterGroups(provided) {
  return (provided.parameters || []).map((parameter) => {
    if (/\bobject containing\b/iu.test(parameter.description)) {
      return {
        kind: "object",
        names: parameter.fields.map((field) => field.name).filter(Boolean)
      };
    }
    return {
      kind: "identifier",
      names: parameter.name ? [parameter.name] : []
    };
  });
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
  const groups = exported.parameterGroups || [];
  const describedGroups = describedParameterGroups(provided);
  const actualGroups = groups.map((group) => ({
    kind: group.kind,
    names: group.names || []
  }));
  if (JSON.stringify(describedGroups) === JSON.stringify(actualGroups)) {
    return;
  }
  diagnostics.push(
    `${name} must preserve its Program parameter grouping. ` +
    `Program arguments: ${parameterGroupText(describedGroups)}. ` +
    `Candidate arguments: ${parameterGroupText(actualGroups)}.`
  );
}

function regularExpressionText(value) {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
}

async function resolvedForwardExport(
  exported,
  sourceFacts,
  projectRoot,
  auxiliaryFactsByPath = new Map()
) {
  if (exported.kind !== "forward" || exported.imported === "*") {
    return exported;
  }
  const importedModule = (sourceFacts.imports || []).find((entry) => (
    entry.specifier === exported.from
  ));
  const auxiliaryFacts = auxiliaryFactsByPath.get(importedModule?.resolvedTarget);
  if (auxiliaryFacts) {
    const matching = (auxiliaryFacts.exports || []).find((candidate) => (
      candidate.name === exported.imported
    ));
    if (matching) {
      return {
        ...matching,
        name: exported.name
      };
    }
  }
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
            kind: candidate.memberKind === "constructor" ? "constructor" : "method",
            name: candidate.name.replace(/\(\)$/u, ""),
            parameters: [],
            private: false,
            static: candidate.memberKind === "static"
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
  projectRoot,
  auxiliaryFactsByPath
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
      projectRoot,
      auxiliaryFactsByPath
    );
    const name = expectedProvideName(exported);
    expected.set(name, exported);
    const provided = topLevel.find((candidate) => candidate.name === name);
    if (!provided) {
      diagnostics.push(`Implementation export ${exported.name} must be provided as ${name}.`);
      continue;
    }
    validateParameterGrouping(name, provided, exported, diagnostics);
    if (exported.kind !== "class") {
      continue;
    }
    const methods = parsedProgram.provides.filter((candidate) => candidate.owner === exported.name);
    for (const method of (exported.methods || []).filter((candidate) => !candidate.private)) {
      const {
        memberKind: expectedMemberKind,
        name: methodName
      } = implementationClassMember(method);
      const providedMethod = methods.find((candidate) => (
        candidate.name === methodName && candidate.memberKind === expectedMemberKind
      ));
      if (!providedMethod) {
        const wrongKind = methods.find((candidate) => candidate.name === methodName);
        diagnostics.push(wrongKind
          ? `Exported class ${exported.name}.${methodName} is ${expectedMemberKind} in the implementation but ${wrongKind.memberKind} in Program.`
          : `Exported class ${exported.name} must describe public ${expectedMemberKind} method ${methodName}.`);
        continue;
      }
      validateParameterGrouping(
        `${exported.name}.${methodName}`,
        providedMethod,
        method,
        diagnostics
      );
    }
    for (const providedMethod of methods) {
      const candidateMethod = (exported.methods || []).find((method) => {
        if (method.private) {
          return false;
        }
        const { memberKind, name: methodName } = implementationClassMember(method);
        return methodName === providedMethod.name && memberKind === providedMethod.memberKind;
      });
      const candidateWithSameName = (exported.methods || []).some((method) => (
        !method.private && implementationClassMember(method).name === providedMethod.name
      ));
      if (!candidateMethod && candidateWithSameName) {
        continue;
      }
      if (!candidateMethod && providedMethod.memberKind !== "constructor") {
        diagnostics.push(
          `Program provides ${exported.name}.${providedMethod.name} as a public ${providedMethod.memberKind} method, but the implementation does not.`
        );
      }
      if (!candidateMethod && providedMethod.memberKind === "constructor") {
        validateParameterGrouping(
          `${exported.name}.constructor()`,
          providedMethod,
          { parameterGroups: [] },
          diagnostics
        );
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
  auxiliaryRoot,
  diagnostics,
  factSets,
  ownedPaths,
  parsedProgram,
  projectRoot
}) {
  const requirements = (await Promise.all(factSets.map(({ facts, targetKind }) => (
    sourceFactUses(facts, {
      auxiliaryRoot,
      ownedPaths,
      projectRoot,
      targetKind
    })
  )))).flat();
  for (const required of requirements) {
    if (
      (required.provider.startsWith("@/") || required.provider.startsWith("asset:")) &&
      !parsedProgram.uses.some((use) => sameUse(use, required))
    ) {
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

function privateImportTarget({ auxiliaryRoot, importerPath, ownedPaths, primaryPath, specifier }) {
  const pathname = String(specifier || "").split(/[?#]/u)[0];
  if (!pathname.startsWith("./") && !pathname.startsWith("../")) {
    return null;
  }
  const base = path.posix.normalize(path.posix.join(
    path.posix.dirname(importerPath),
    pathname
  ));
  const candidates = path.posix.extname(base)
    ? [base]
    : [
      base,
      `${base}.js`,
      `${base}.mjs`,
      `${base}.vue`,
      `${base}.html`,
      `${base}/index.js`,
      `${base}/index.mjs`,
      `${base}/index.vue`
    ];
  const existing = candidates.find((candidate) => ownedPaths.has(candidate));
  if (existing) {
    return { exists: true, path: existing };
  }
  if (candidates.some((candidate) => (
    candidate === primaryPath || candidate.startsWith(auxiliaryRoot)
  ))) {
    return { exists: false, path: candidates[0] };
  }
  return null;
}

function validatePrivateJavaScriptLinks({
  auxiliaryRoot,
  diagnostics,
  factSets,
  ownedPaths,
  primaryPath
}) {
  const factsByPath = new Map(
    factSets
      .filter((entry) => entry.targetKind === "javascript")
      .map((entry) => [entry.path, entry.facts])
  );
  for (const { facts, path: implementationPath, targetKind } of factSets) {
    if (targetKind !== "javascript") {
      continue;
    }
    for (const importedModule of facts.imports || []) {
      const target = privateImportTarget({
        auxiliaryRoot,
        importerPath: implementationPath,
        ownedPaths,
        primaryPath,
        specifier: importedModule.specifier
      });
      if (!target) {
        continue;
      }
      if (!target.exists) {
        diagnostics.push(
          `Private import ${importedModule.specifier} in ${implementationPath} does not resolve to an owned file.`
        );
        continue;
      }
      const providerFacts = factsByPath.get(target.path);
      if (!providerFacts) {
        continue;
      }
      const exportedNames = new Set(
        (providerFacts.exports || []).map((exported) => exported.name)
      );
      const hasForwardAll = exportedNames.has("*");
      for (const imported of importedModule.names || []) {
        if (
          imported.typeOnly ||
          imported.imported === "*" ||
          exportedNames.has(imported.imported) ||
          (imported.imported === "default" && exportedNames.has("module.exports")) ||
          hasForwardAll
        ) {
          continue;
        }
        diagnostics.push(
          `Private import ${imported.imported} in ${implementationPath} is not exported by ${target.path}.`
        );
      }
    }
  }
  if (!factsByPath.has(primaryPath)) {
    diagnostics.push(`Primary JavaScript implementation ${primaryPath} could not be linked.`);
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
  auxiliaryImplementations = [],
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
  const auxiliaryRoot = pair.implementationPath.replace(/\.[^/.]+$/u, "/");
  const auxiliaryFactSets = [];
  for (const auxiliary of auxiliaryImplementations) {
    const extension = path.posix.extname(auxiliary.relativePath);
    const targetKind = extension === ".vue"
      ? "vue"
      : extension === ".html"
        ? "html"
        : extension === ".js" || extension === ".mjs"
          ? "javascript"
          : null;
    if (!targetKind) {
      continue;
    }
    auxiliaryFactSets.push({
      facts: await extractSourceFacts({
        implementationPath: auxiliary.relativePath,
        projectRoot,
        source: auxiliary.state?.source ?? auxiliary.source,
        targetKind
      }),
      path: auxiliary.relativePath,
      targetKind
    });
  }
  const auxiliaryFactsByPath = new Map(
    auxiliaryFactSets.map((entry) => [entry.path, entry.facts])
  );
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
      projectRoot,
      auxiliaryFactsByPath
    );
    const ownedPaths = new Set([
      pair.implementationPath,
      ...auxiliaryImplementations.map((entry) => entry.relativePath)
    ]);
    validatePrivateJavaScriptLinks({
      auxiliaryRoot,
      diagnostics,
      factSets: [
        {
          facts: sourceFacts,
          path: pair.implementationPath,
          targetKind: pair.target.kind
        },
        ...auxiliaryFactSets
      ],
      ownedPaths,
      primaryPath: pair.implementationPath
    });
  } else if (pair.target.kind === "vue") {
    validateVueSurface(pair, parsedProgram, sourceFacts, diagnostics);
  } else {
    validateHtmlSurface(parsedProgram, diagnostics);
  }
  const requirements = await validateImplementationUses({
    auxiliaryRoot,
    diagnostics,
    factSets: [
      { facts: sourceFacts, targetKind: pair.target.kind },
      ...auxiliaryFactSets
    ],
    ownedPaths: [
      pair.implementationPath,
      ...auxiliaryImplementations.map((entry) => entry.relativePath)
    ],
    parsedProgram,
    projectRoot
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
