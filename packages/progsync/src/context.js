import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  assertValidProgram,
  parseProgram,
  stableJson,
  symbolAnchor
} from "./program.js";
import { SHARED_TYPES_PATH } from "./constants.js";
import { readWorkingFile } from "./git.js";
import {
  absoluteProjectPath,
  slashPath
} from "./paths.js";
import { ProgSyncError } from "./errors.js";
import { snapshotSummary } from "./state.js";
import { extractSourceFacts } from "./structural.js";
import { promptFingerprint } from "./prompts.js";

function splitProvider(provider) {
  const match = String(provider || "").match(/^@\/([^#]+)(?:#(.+))?$/u);
  if (!match) {
    return null;
  }
  return {
    anchor: match[2] || "",
    programPath: `program/${match[1]}`
  };
}

function targetImportSpecifier(consumerPath, providerPath) {
  let relative = path.posix.relative(
    path.posix.dirname(slashPath(consumerPath)),
    slashPath(providerPath)
  );
  if (!relative.startsWith(".")) {
    relative = `./${relative}`;
  }
  return relative;
}

async function resolveProgramReferences({
  implementationPath,
  parsedProgram,
  projectRoot
}) {
  const references = [];
  const diagnostics = [];
  const visited = new Set();
  const queue = [
    ...parsedProgram.uses,
    ...(parsedProgram.typeReferences || []).map((reference) => ({
      provider: `@/types.md#${symbolAnchor(reference.name)}`,
      source: reference.source,
      symbol: reference.name
    }))
  ].map((use) => ({ depth: 0, use }));

  while (queue.length > 0 && visited.size < 128) {
    const current = queue.shift();
    const { use } = current;
    const key = `${use.provider}|${use.symbol}`;
    if (visited.has(key)) {
      continue;
    }
    visited.add(key);
    if (use.provider.startsWith("asset:")) {
      const identity = use.provider.slice("asset:".length);
      if (identity.startsWith("url:") || /^[a-z][a-z0-9+.-]*:/iu.test(identity)) {
        references.push({
          symbol: use.symbol,
          provider: use.provider,
          kind: "asset"
        });
        continue;
      }
      try {
        const content = await fs.readFile(absoluteProjectPath(projectRoot, identity));
        const textual = /\.(?:css|csv|html|json|md|svg|text|txt|xml|ya?ml)$/iu.test(identity);
        references.push({
          symbol: use.symbol,
          provider: use.provider,
          kind: "asset",
          contentHash: `sha256:${crypto.createHash("sha256").update(content).digest("hex")}`,
          ...(textual && content.byteLength <= 512 * 1024
            ? { content: content.toString("utf8") }
            : {}),
          targetFile: identity
        });
      } catch (error) {
        if (error?.code === "ENOENT") {
          diagnostics.push({
            code: "MISSING_RETAINED_INPUT",
            message: `${use.symbol} references missing retained input ${identity}.`
          });
          continue;
        }
        throw error;
      }
      continue;
    }
    const internal = splitProvider(use.provider);
    if (!internal) {
      references.push({
        symbol: use.symbol,
        provider: use.provider,
        kind: use.provider.startsWith("asset:") ? "asset" : "external"
      });
      continue;
    }
    let providerSource;
    try {
      providerSource = await fs.readFile(
        absoluteProjectPath(projectRoot, internal.programPath),
        "utf8"
      );
    } catch (error) {
      if (error?.code === "ENOENT") {
        diagnostics.push({
          code: "MISSING_PROGRAM_PROVIDER",
          message: `${use.symbol} references missing provider ${internal.programPath}.`
        });
        continue;
      }
      throw error;
    }
    const providerProgram = parseProgram(providerSource, {
      programPath: internal.programPath
    });
    if (!providerProgram.valid) {
      diagnostics.push({
        code: "INVALID_PROGRAM_PROVIDER",
        diagnostics: providerProgram.diagnostics,
        message: `${internal.programPath} is not a valid Program provider.`
      });
      continue;
    }
    const wantedAnchor = symbolAnchor(internal.anchor || use.symbol);
    const provided = providerProgram.provides.find((entry) => (
      symbolAnchor(entry.owner ? `${entry.owner}.${entry.name}` : entry.name) === wantedAnchor ||
      symbolAnchor(entry.name) === wantedAnchor
    ));
    if (!provided) {
      diagnostics.push({
        code: "MISSING_PROVIDED_SYMBOL",
        message: `${use.provider} does not provide ${use.symbol}.`
      });
      continue;
    }
    let targetFile = null;
    let targetImport = null;
    try {
      targetFile = internal.programPath === "program/types.md"
        ? null
        : internal.programPath.replace(/^program\//u, "").replace(/\.md$/u, "");
      if (targetFile && /\.(?:js|mjs|vue|html)$/u.test(targetFile)) {
        targetImport = targetImportSpecifier(implementationPath, targetFile);
      } else {
        targetFile = null;
      }
    } catch {
      targetFile = null;
    }
    references.push({
      symbol: use.symbol,
      provider: use.provider,
      kind: provided.kind,
      description: provided.description,
      programPath: internal.programPath,
      targetFile,
      targetImport
    });
    if (current.depth < 8) {
      for (const dependency of providerProgram.uses) {
        queue.push({ depth: current.depth + 1, use: dependency });
      }
    } else if (providerProgram.uses.length > 0) {
      diagnostics.push({
        code: "REFERENCE_CLOSURE_DEPTH_LIMIT",
        message: `Program reference closure stopped at ${internal.programPath}; its dependencies were not silently omitted.`
      });
    }
  }

  if (queue.length > 0) {
    diagnostics.push({
      code: "REFERENCE_CLOSURE_LIMIT",
      message: "Program reference closure exceeded the prototype limit of 128 definitions."
    });
  }
  return {
    diagnostics,
    references
  };
}

function frameworkRealizationImport(importedModule, targetKind) {
  return targetKind === "vue" && (
    importedModule.specifier === "vue" ||
    importedModule.specifier.startsWith("@vue/")
  );
}

async function sourceProviderProgram(importedModule, projectRoot) {
  if (!importedModule.programProvider) {
    return null;
  }
  try {
    const source = await fs.readFile(
      absoluteProjectPath(projectRoot, importedModule.programProvider),
      "utf8"
    );
    return parseProgram(source, { programPath: importedModule.programProvider });
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function providerSymbolForImport(importedName, providerProgram) {
  const requested = importedName.imported;
  if (!providerProgram?.valid) {
    return requested;
  }
  const topLevel = providerProgram.provides.filter((provided) => !provided.owner);
  const exact = topLevel.find((provided) => (
    symbolAnchor(provided.name) === symbolAnchor(requested)
  ));
  if (exact) {
    return exact.name;
  }
  if (requested === "default" && topLevel.length === 1) {
    return topLevel[0].name;
  }
  return requested;
}

async function sourceFactUses(sourceFacts, {
  projectRoot,
  targetKind = "javascript"
} = {}) {
  const uses = [];
  for (const resource of sourceFacts.htmlResources || []) {
    uses.push({
      provider: resource.provider,
      source: { line: null },
      symbol: resource.symbol
    });
  }
  for (const importedModule of sourceFacts.imports || []) {
    if (importedModule.realizationOnly || frameworkRealizationImport(importedModule, targetKind)) {
      continue;
    }
    const providerProgram = await sourceProviderProgram(importedModule, projectRoot);
    const providerPrefix = importedModule.programProvider
      ? `@/${importedModule.programProvider.replace(/^program\//u, "")}`
      : importedModule.resolvedTarget
        ? `asset:${importedModule.resolvedTarget}`
        : `package:npm/${importedModule.specifier}`;
    const relevantNames = (importedModule.names || []).filter((importedName) => (
      importedName.used || importedName.called || importedModule.reexport
    ));
    if (relevantNames.length === 0 && (importedModule.sideEffect || importedModule.dynamic)) {
      const onlyProvided = providerProgram?.valid &&
        providerProgram.provides.filter((provided) => !provided.owner).length === 1
        ? providerProgram.provides.find((provided) => !provided.owner)
        : null;
      const providedName = onlyProvided?.name || "module";
      uses.push({
        provider: providerPrefix.startsWith("asset:")
          ? providerPrefix
          : `${providerPrefix}#${symbolAnchor(providedName)}`,
        source: { line: null },
        symbol: providedName
      });
    }
    for (const importedName of relevantNames) {
      const names = importedName.imported === "*"
        ? importedName.members?.length > 0
          ? importedName.members
          : importedModule.reexport && providerProgram?.valid
            ? providerProgram.provides
              .filter((provided) => !provided.owner)
              .map((provided) => provided.name)
            : [importedName.imported]
        : [importedName.imported];
      for (const name of names.filter(Boolean)) {
        const providedName = providerSymbolForImport(
          { ...importedName, imported: name },
          providerProgram
        );
        const visibleName = importedName.imported === "*"
          ? name
          : importedName.local || name;
        uses.push({
          provider: providerPrefix.startsWith("asset:")
            ? providerPrefix
            : `${providerPrefix}#${symbolAnchor(providedName)}`,
          source: { line: null },
          symbol: `${visibleName}${importedName.called ? "()" : ""}`
        });
      }
    }
  }
  for (const ambient of sourceFacts.ambientUses || []) {
    const operation = ambient.member || ambient.base;
    uses.push({
      provider: `platform:${ambient.base}#${symbolAnchor(operation)}`,
      source: { line: null },
      symbol: `${ambient.base}${ambient.member ? `.${ambient.member}` : ""}${ambient.called ? "()" : ""}`
    });
  }
  return uses;
}

function mergeResolutionResults(...results) {
  const diagnostics = [];
  const references = [];
  const seenDiagnostics = new Set();
  const seenReferences = new Set();
  for (const result of results) {
    for (const diagnostic of result.diagnostics || []) {
      const key = `${diagnostic.code}|${diagnostic.message}`;
      if (!seenDiagnostics.has(key)) {
        seenDiagnostics.add(key);
        diagnostics.push(diagnostic);
      }
    }
    for (const reference of result.references || []) {
      const key = `${reference.provider}|${reference.symbol}`;
      if (!seenReferences.has(key)) {
        seenReferences.add(key);
        references.push(reference);
      }
    }
  }
  return { diagnostics, references };
}

function capsuleProgram(parsedProgram) {
  if (!parsedProgram) {
    return null;
  }
  const { source: _source, ...withoutDuplicateSource } = parsedProgram;
  return withoutDuplicateSource;
}

function contextHash({ packageContext, pair, resolution, translatorFingerprint }) {
  return `sha256:${crypto.createHash("sha256").update(stableJson({
    packageContext,
    resolution,
    target: {
      implementationPath: pair.implementationPath,
      targetKind: pair.target.kind,
      translatorFingerprint
    },
    version: 1
  })).digest("hex")}`;
}

async function readRootPackageContext(projectRoot) {
  try {
    const source = await fs.readFile(absoluteProjectPath(projectRoot, "package.json"), "utf8");
    const manifest = JSON.parse(source);
    return {
      name: manifest.name || null,
      type: manifest.type || null,
      dependencies: manifest.dependencies || {},
      devDependencies: manifest.devDependencies || {}
    };
  } catch (error) {
    if (error?.code === "ENOENT") {
      return null;
    }
    if (error instanceof SyntaxError) {
      throw new ProgSyncError(
        "INVALID_PACKAGE_CONTEXT",
        "The project package.json is not valid JSON.",
        { parserMessage: error.message }
      );
    }
    throw error;
  }
}

async function buildContextCapsule({ mode, pair, snapshot }) {
  const allowedPaths = allowedPathsForMode(mode, pair);
  const sharedTypesAreWritable = allowedPaths.includes(SHARED_TYPES_PATH);
  const parsedProgram = snapshot.P1.exists
    ? parseProgram(snapshot.P1.source, { programPath: pair.programPath })
    : null;
  const [
    sourceFacts,
    programReferences,
    packageContext,
    translatorFingerprint,
    sharedTypes
  ] = await Promise.all([
    extractSourceFacts({
      implementationPath: pair.implementationPath,
      projectRoot: pair.projectRoot,
      source: snapshot.I1.source,
      targetKind: pair.target.kind
    }),
    parsedProgram
      ? resolveProgramReferences({
        implementationPath: pair.implementationPath,
        parsedProgram,
        projectRoot: pair.projectRoot
      })
      : Promise.resolve({ diagnostics: [], references: [] }),
    readRootPackageContext(pair.projectRoot),
    promptFingerprint(pair.target),
    sharedTypesAreWritable
      ? readWorkingFile(pair.projectRoot, SHARED_TYPES_PATH)
      : Promise.resolve({
        exists: false,
        mode: null,
        permissions: null,
        source: null
      })
  ]);
  if (sharedTypes.exists) {
    assertValidProgram(sharedTypes.source, { programPath: SHARED_TYPES_PATH });
  }
  const sourceUses = await sourceFactUses(sourceFacts, {
    projectRoot: pair.projectRoot,
    targetKind: pair.target.kind
  });
  const sourceReferences = sourceUses.length > 0
    ? await resolveProgramReferences({
      implementationPath: pair.implementationPath,
      parsedProgram: { uses: sourceUses },
      projectRoot: pair.projectRoot
    })
    : { diagnostics: [], references: [] };
  const resolution = mergeResolutionResults(
    programReferences,
    sourceReferences,
    {
      diagnostics: sourceFacts.diagnostics || [],
      references: []
    }
  );

  return {
    capsuleVersion: 2,
    contextHash: contextHash({
      packageContext,
      pair,
      resolution,
      translatorFingerprint
    }),
    mode,
    target: {
      programPath: pair.programPath,
      implementationPath: pair.implementationPath,
      targetKind: pair.target.kind,
      allowedPaths
    },
    baseline: snapshotSummary(snapshot),
    previous: {
      program: snapshot.P0.exists ? snapshot.P0.source : null,
      implementation: snapshot.I0.exists ? snapshot.I0.source : null
    },
    current: {
      program: snapshot.P1.exists ? snapshot.P1.source : null,
      implementation: snapshot.I1.exists ? snapshot.I1.source : null
    },
    parsedProgram: capsuleProgram(parsedProgram),
    sourceFacts,
    resolvedReferences: resolution.references,
    resolutionDiagnostics: resolution.diagnostics,
    retainedPackageContext: packageContext,
    sharedTypes: {
      ...sharedTypes,
      editable: sharedTypesAreWritable,
      path: SHARED_TYPES_PATH
    },
    translatorFingerprint
  };
}

function allowedPathsForMode(mode, pair) {
  if (mode === "CREATE_PROGRAM" || mode === "IMPLEMENTATION_TO_PROGRAM") {
    return [pair.programPath, SHARED_TYPES_PATH];
  }
  if (mode === "CREATE_IMPLEMENTATION" || mode === "PROGRAM_TO_IMPLEMENTATION") {
    return [pair.implementationPath];
  }
  if (mode === "RECONCILE_BOTH") {
    return [pair.programPath, pair.implementationPath, SHARED_TYPES_PATH];
  }
  return [];
}

export {
  allowedPathsForMode,
  buildContextCapsule,
  extractSourceFacts,
  resolveProgramReferences,
  sourceFactUses
};
