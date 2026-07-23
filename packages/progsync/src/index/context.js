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
import { readWorkingFile, workingGitPaths } from "./git.js";
import { manifestBoundaryForTarget } from "./manifest.js";
import {
  absoluteProjectPath,
  auxiliaryRootForImplementationPath,
  isSupportedImplementationPath,
  slashPath,
  targetForImplementationPath
} from "./paths.js";
import { ProgSyncError } from "./errors.js";
import { snapshotSummary } from "./state.js";
import { extractSourceFacts } from "./structural.js";
import { promptFingerprint } from "./prompts.js";
import { codexRunnerProfile } from "./codexRunner.js";

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
      (entry.kind === "class" && `class-${symbolAnchor(entry.name)}` === wantedAnchor) ||
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
    const nestedUses = [
      ...(targetFile ? [] : providerProgram.uses),
      ...(provided.typeReferences || []).map((dependency) => ({
        provider: `@/types.md#${symbolAnchor(dependency.name)}`,
        source: dependency.source,
        symbol: dependency.name
      }))
    ];
    if (current.depth < 8) {
      for (const dependency of nestedUses) {
        queue.push({ depth: current.depth + 1, use: dependency });
      }
    } else if (nestedUses.length > 0) {
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
  auxiliaryRoot = null,
  ownedPaths = [],
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
    if (
      importedModule.realizationOnly ||
      frameworkRealizationImport(importedModule, targetKind) ||
      (auxiliaryRoot && importedModule.resolvedTarget?.startsWith(auxiliaryRoot)) ||
      ownedPaths.includes(importedModule.resolvedTarget)
    ) {
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

function sourceConsumerIsTest(relativePath) {
  return /(?:^|\/)(?:test|tests)(?:\/|$)|\.(?:test|spec)\.[^.]+$/u.test(relativePath);
}

function sourceModuleOwner(relativePath, allPaths) {
  let directory = path.posix.dirname(relativePath);
  while (directory && directory !== ".") {
    const parent = path.posix.dirname(directory);
    const base = path.posix.basename(directory);
    const owner = [".js", ".mjs", ".vue", ".html"]
      .map((extension) => path.posix.join(parent, `${base}${extension}`))
      .find((candidate) => allPaths.has(candidate));
    if (owner) {
      return owner;
    }
    directory = parent;
  }
  return relativePath;
}

function importedExportNames(importedModule, sourceExports) {
  const names = new Set();
  let ambiguous = false;
  for (const imported of importedModule.names || []) {
    if (imported.imported !== "*") {
      names.add(imported.imported);
      continue;
    }
    if (imported.members?.length > 0) {
      for (const member of imported.members) {
        names.add(member);
      }
      continue;
    }
    if (importedModule.reexport) {
      for (const exported of sourceExports) {
        names.add(exported.name);
      }
      continue;
    }
    if ((imported.used || imported.called) && sourceExports.length === 1) {
      names.add(sourceExports[0].name);
      continue;
    }
    if (imported.used || imported.called) {
      ambiguous = true;
    }
  }
  return { ambiguous, names: [...names] };
}

async function sourceSurfaceEvidence({ mode, pair, sourceFacts }) {
  const needed = [
    "CREATE_PROGRAM",
    "IMPLEMENTATION_TO_PROGRAM",
    "RECONCILE_BOTH"
  ].includes(mode);
  if (!needed || !sourceFacts) {
    return null;
  }
  const allPaths = new Set(await workingGitPaths(pair.projectRoot));
  const auxiliaryRoot = auxiliaryRootForImplementationPath(pair.implementationPath);
  const evidenceByName = new Map((sourceFacts.exports || []).map((exported) => [
    exported.name,
    {
      externallyInvoked: false,
      kind: exported.kind,
      name: exported.name,
      productionConsumers: new Set(),
      testConsumers: new Set()
    }
  ]));
  const diagnostics = [];
  const consumers = [...allPaths]
    .filter((relativePath) => (
      relativePath !== pair.implementationPath &&
      !relativePath.startsWith(auxiliaryRoot) &&
      isSupportedImplementationPath(relativePath)
    ))
    .sort((left, right) => left.localeCompare(right));

  for (const consumerPath of consumers) {
    let consumerFacts;
    try {
      const state = await readWorkingFile(pair.projectRoot, consumerPath);
      consumerFacts = await extractSourceFacts({
        implementationPath: consumerPath,
        projectRoot: pair.projectRoot,
        source: state.source,
        targetKind: targetForImplementationPath(consumerPath).kind
      });
    } catch (error) {
      diagnostics.push({
        code: "SOURCE_CONSUMER_EVIDENCE_INCOMPLETE",
        consumerPath,
        message: `Could not inspect possible source consumer ${consumerPath}: ${error?.message || error}`
      });
      continue;
    }
    for (const diagnostic of consumerFacts.diagnostics || []) {
      diagnostics.push({
        ...diagnostic,
        code: "SOURCE_CONSUMER_EVIDENCE_INCOMPLETE",
        consumerPath,
        message: `${consumerPath}: ${diagnostic.message}`
      });
    }
    const imports = (consumerFacts.imports || []).filter((entry) => (
      slashPath(entry.resolvedTarget || "") === pair.implementationPath
    ));
    for (const importedModule of imports) {
      const imported = importedExportNames(importedModule, sourceFacts.exports || []);
      if (imported.ambiguous) {
        diagnostics.push({
          code: "AMBIGUOUS_SOURCE_CONSUMER",
          consumerPath,
          message: `${consumerPath} consumes ${pair.implementationPath} through an unresolved namespace; exported-symbol eligibility cannot be guessed.`
        });
      }
      for (const name of imported.names) {
        const evidence = evidenceByName.get(name);
        if (!evidence) {
          diagnostics.push({
            code: "UNRESOLVED_SOURCE_EXPORT_CONSUMER",
            consumerPath,
            message: `${consumerPath} imports ${name} from ${pair.implementationPath}, but that export is not mechanically visible.`
          });
          continue;
        }
        const owner = sourceModuleOwner(consumerPath, allPaths);
        (sourceConsumerIsTest(consumerPath)
          ? evidence.testConsumers
          : evidence.productionConsumers).add(owner);
      }
    }
  }

  const manifestBoundary = await manifestBoundaryForTarget(
    pair.projectRoot,
    pair.implementationPath
  );
  const intrinsicBoundary = Boolean(
    sourceFacts.entrypoint ||
    ["vue", "html"].includes(pair.target.kind) ||
    path.posix.basename(pair.implementationPath) === "package.descriptor.mjs"
  );
  for (const evidence of evidenceByName.values()) {
    evidence.externallyInvoked = intrinsicBoundary || manifestBoundary.externallyInvoked;
  }
  return {
    complete: diagnostics.length === 0,
    diagnostics,
    entrypoint: sourceFacts.entrypoint || null,
    exports: [...evidenceByName.values()].map((entry) => ({
      ...entry,
      productionConsumers: [...entry.productionConsumers].sort(),
      testConsumers: [...entry.testConsumers].sort()
    })),
    targetBoundary: {
      externallyInvoked: intrinsicBoundary || manifestBoundary.externallyInvoked,
      manifestPath: manifestBoundary.manifestPath,
      matchedTarget: manifestBoundary.matchedTarget,
      reason: intrinsicBoundary
        ? sourceFacts.entrypoint
          ? "executable entrypoint"
          : pair.target.kind === "vue"
            ? "component"
            : pair.target.kind === "html"
              ? "document"
              : "package descriptor"
        : manifestBoundary.matchedTarget
          ? "package manifest"
          : null
    }
  };
}

function capsuleProgram(parsedProgram) {
  if (!parsedProgram) {
    return null;
  }
  const { source: _source, ...withoutDuplicateSource } = parsedProgram;
  return withoutDuplicateSource;
}

function contextHash({
  packageContext,
  pair,
  resolution,
  runnerProfile,
  sourceSurface,
  translatorFingerprint
}) {
  return `sha256:${crypto.createHash("sha256").update(stableJson({
    packageContext,
    resolution,
    runnerProfile,
    sourceSurface,
    target: {
      auxiliaryRoot: auxiliaryRootForImplementationPath(pair.implementationPath),
      implementationPath: pair.implementationPath,
      targetKind: pair.target.kind,
      translatorFingerprint
    },
    version: 3
  })).digest("hex")}`;
}

async function readPackageContext(projectRoot, implementationPath) {
  try {
    const packageInfo = await manifestBoundaryForTarget(projectRoot, implementationPath);
    if (!packageInfo.manifest) {
      return null;
    }
    const { manifest } = packageInfo;
    return {
      directory: packageInfo.directory,
      manifestPath: packageInfo.manifestPath,
      name: manifest.name || null,
      type: manifest.type || null,
      bin: manifest.bin || null,
      dependencies: manifest.dependencies || {},
      devDependencies: manifest.devDependencies || {},
      exports: manifest.exports || null,
      main: manifest.main || null,
      module: manifest.module || null
    };
  } catch (error) {
    if (error instanceof SyntaxError) {
      throw new ProgSyncError(
        "INVALID_PACKAGE_CONTEXT",
        "The nearest package.json is not valid JSON.",
        { parserMessage: error.message }
      );
    }
    throw error;
  }
}

async function buildContextCapsule({ mode, pair, snapshot }) {
  const allowedPaths = allowedPathsForMode(mode, pair);
  const allowedPathPrefixes = allowedPathPrefixesForMode(mode, pair);
  const auxiliaryRoot = auxiliaryRootForImplementationPath(pair.implementationPath);
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
    readPackageContext(pair.projectRoot, pair.implementationPath),
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
    auxiliaryRoot,
    ownedPaths: [
      pair.implementationPath,
      ...(snapshot.A1 || []).map((entry) => entry.relativePath)
    ],
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
  const runnerProfile = codexRunnerProfile();
  const sourceSurface = await sourceSurfaceEvidence({
    mode,
    pair,
    sourceFacts
  });

  return {
    capsuleVersion: 4,
    contextHash: contextHash({
      packageContext,
      pair,
      resolution,
      runnerProfile,
      sourceSurface,
      translatorFingerprint
    }),
    mode,
    target: {
      allowedPathPrefixes,
      programPath: pair.programPath,
      implementationPath: pair.implementationPath,
      auxiliaryRoot,
      targetKind: pair.target.kind,
      allowedPaths
    },
    baseline: snapshotSummary(snapshot),
    previous: {
      program: snapshot.P0.exists ? snapshot.P0.source : null,
      implementation: snapshot.I0.exists ? snapshot.I0.source : null,
      auxiliaryImplementations: (snapshot.A0 || []).map((entry) => ({
        path: entry.relativePath,
        source: entry.state.source,
        mode: entry.state.mode
      }))
    },
    current: {
      program: snapshot.P1.exists ? snapshot.P1.source : null,
      implementation: snapshot.I1.exists ? snapshot.I1.source : null,
      auxiliaryImplementations: (snapshot.A1 || []).map((entry) => ({
        path: entry.relativePath,
        source: entry.state.source,
        mode: entry.state.mode
      }))
    },
    parsedProgram: capsuleProgram(parsedProgram),
    sourceFacts,
    sourceSurfaceEvidence: sourceSurface,
    resolvedReferences: resolution.references,
    resolutionDiagnostics: resolution.diagnostics,
    retainedPackageContext: packageContext,
    runnerProfile,
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

function allowedPathPrefixesForMode(mode, pair) {
  if (
    mode === "CREATE_IMPLEMENTATION" ||
    mode === "PROGRAM_TO_IMPLEMENTATION" ||
    mode === "RECONCILE_BOTH"
  ) {
    return [auxiliaryRootForImplementationPath(pair.implementationPath)];
  }
  return [];
}

export {
  allowedPathsForMode,
  allowedPathPrefixesForMode,
  buildContextCapsule,
  extractSourceFacts,
  resolveProgramReferences,
  sourceFactUses
};
