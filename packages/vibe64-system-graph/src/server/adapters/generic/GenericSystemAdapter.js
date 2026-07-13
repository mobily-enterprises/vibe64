import {
  mergeSubsystemAnchors,
  mergeSubsystemCapabilities,
  normalizeSubsystemDefinition
} from "../../../shared/subsystemContract.js";
import {
  defineSystemAdapter
} from "../systemAdapterContract.js";
import {
  activeFileCityCampuses,
  buildSemanticFileCity
} from "../semanticFileCity.js";
import {
  genericSystemAdapterProfiles
} from "./profiles.js";
import {
  scanSourceTree
} from "./sourceScanner.js";

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function relationshipId(adapterId, kind, from, to) {
  return `${adapterId}:relationship:${kind}:${from}:${to}`;
}

function addContainsRelationship(relationships, adapterId, from, to, origin = "derived") {
  const id = relationshipId(adapterId, "contains", from, to);
  relationships.set(id, {
    evidenceIds: [],
    from,
    id,
    kind: "contains",
    origin,
    to
  });
}

function campusSubsystem(profile, campus, systemId) {
  const id = `${profile.adapterId}:subsystem:campus:${campus.id}`;
  const executionSide = campus.executionSide || "unknown";
  return {
    description: campus.description || "",
    executionSide,
    id,
    kind: "subsystem",
    metadata: {
      anchors: campus.roots.map((root) => ({
        evidenceIds: [],
        kind: "directory",
        origin: "derived",
        path: root,
        relation: "owns"
      })),
      authoredBy: "adapter",
      capabilities: [],
      executionSides: [executionSide],
      meaningOrigin: "derived",
      status: "current"
    },
    origin: "derived",
    parentId: systemId,
    title: campus.title
  };
}

function applyDeclaredSubsystems({
  adapterId,
  declarations = [],
  entities,
  relationships,
  systemId
} = {}) {
  const normalizedDeclarations = declarations
    .filter((declaration) => declaration?.kind === "subsystem" && declaration.id)
    .map((declaration) => {
      const authoredByCodex = String(declaration.authoredBy || "").toLowerCase() === "codex";
      const origin = declaration.origin === "inferred" || authoredByCodex ? "inferred" : "declared";
      return {
        declaration,
        normalized: normalizeSubsystemDefinition({
          ...declaration,
          origin,
          meaningOrigin: declaration.meaningOrigin || origin,
          parentId: declaration.parentId || systemId
        }, {
          defaultOrigin: origin,
          requireAnchors: !entities.has(String(declaration.id))
        })
      };
    });

  for (const { declaration, normalized } of normalizedDeclarations) {
    const existing = entities.get(normalized.id);
    if (existing?.kind === "subsystem") {
      if (Object.hasOwn(declaration, "title")) {
        existing.title = normalized.title;
      }
      if (Object.hasOwn(declaration, "description")) {
        existing.description = normalized.description;
      }
      if (Object.hasOwn(declaration, "executionSide")) {
        existing.executionSide = normalized.executionSide;
        existing.metadata.executionSides = [normalized.executionSide];
      }
      existing.metadata.anchors = mergeSubsystemAnchors(
        existing.metadata.anchors || [],
        normalized.anchors
      );
      existing.metadata.capabilities = mergeSubsystemCapabilities(
        existing.metadata.capabilities || [],
        normalized.capabilities
      );
      existing.metadata.authoredBy = normalized.authoredBy;
      existing.metadata.meaningOrigin = normalized.meaningOrigin;
      existing.metadata.status = normalized.status;
      continue;
    }
    entities.set(normalized.id, {
      description: normalized.description,
      executionSide: normalized.executionSide,
      id: normalized.id,
      kind: "subsystem",
      metadata: {
        anchors: normalized.anchors,
        authoredBy: normalized.authoredBy,
        capabilities: normalized.capabilities,
        executionSides: [normalized.executionSide],
        meaningOrigin: normalized.meaningOrigin,
        packageId: normalized.packageId,
        status: normalized.status
      },
      origin: normalized.origin,
      parentId: normalized.parentId || systemId,
      title: normalized.title
    });
  }

  for (const { normalized } of normalizedDeclarations) {
    const entity = entities.get(normalized.id);
    if (!entity || entity.parentId === entity.id || !entities.has(entity.parentId)) {
      throw new TypeError(`Subsystem ${normalized.id} has an invalid parent: ${entity?.parentId || "(missing)"}.`);
    }
    addContainsRelationship(
      relationships,
      adapterId,
      entity.parentId,
      entity.id,
      normalized.origin
    );
  }
}

function modelCoverage(model = {}) {
  return {
    acceptedFindings: 0,
    connections: model.connections.length,
    consumers: 0,
    entities: model.entities.length,
    evidence: model.evidence.length,
    files: model.files.length,
    findings: 0,
    operations: 0,
    packages: 0,
    relationships: model.relationships.length,
    subsystemCapabilities: model.entities
      .filter((entity) => entity.kind === "subsystem")
      .reduce((total, entity) => total + (entity.metadata.capabilities || []).length, 0),
    subsystems: model.entities.filter((entity) => entity.kind === "subsystem").length,
    unresolved: model.diagnostics.length
  };
}

async function compileGenericSystemModel(profile, {
  declarations = [],
  input = {},
  sourceRoot
} = {}) {
  const scan = await scanSourceTree(sourceRoot, profile);
  const campuses = activeFileCityCampuses(profile.campuses, scan.files);
  const systemId = `${profile.adapterId}:system:application`;
  const entities = new Map();
  const relationships = new Map();
  entities.set(systemId, {
    description: `Current active-session ${profile.label} application structure.`,
    executionSide: "shared",
    id: systemId,
    kind: "system",
    metadata: {
      executionSides: ["client", "server", "shared", "unknown"]
    },
    origin: "derived",
    parentId: "",
    title: profile.label
  });
  for (const campus of campuses) {
    const subsystem = campusSubsystem(profile, campus, systemId);
    entities.set(subsystem.id, subsystem);
    addContainsRelationship(relationships, profile.adapterId, systemId, subsystem.id);
  }
  applyDeclaredSubsystems({
    adapterId: profile.adapterId,
    declarations,
    entities,
    relationships,
    systemId
  });

  const model = {
    adapter: {
      fileCity: buildSemanticFileCity({
        adapterId: profile.adapterId,
        campuses,
        files: scan.files
      }),
      id: profile.adapterId,
      version: profile.version
    },
    connections: [],
    coverage: {},
    declarations,
    diagnostics: scan.diagnostics,
    entities: stableSort(entities.values(), (entity) => entity.id),
    evidence: [],
    files: scan.files,
    findings: [],
    input,
    provenance: {
      analysisLevel: "conventional-topology",
      authoritativeScopeIds: [profile.adapterId],
      compiler: "vibe64-system-conventional-source-v1",
      extractionSchema: "vibe64.system.conventional-source.v1",
      updateMode: "full"
    },
    relationships: stableSort(relationships.values(), (relationship) => relationship.id)
  };
  model.coverage = modelCoverage(model);
  return model;
}

function genericPlan(profile, {
  declarationsDigest = "",
  previousModel,
  snapshot
} = {}) {
  if (!previousModel) {
    return { mode: "full", reason: "missing-document", scopes: [] };
  }
  if (previousModel.adapter?.id !== profile.adapterId || previousModel.adapter?.version !== profile.version) {
    return { mode: "full", reason: "adapter-changed", scopes: [] };
  }
  if (previousModel.input?.declarationsDigest !== declarationsDigest) {
    return { mode: "full", reason: "declarations-changed", scopes: [] };
  }
  return {
    mode: "full",
    reason: previousModel.input?.sourceDigest === snapshot?.digest ? "manual-refresh" : "source-changed",
    scopes: []
  };
}

function createGenericSystemAdapter(profile) {
  return defineSystemAdapter({
    id: profile.adapterId,
    version: profile.version,
    analyze: async ({ declarations = [], input = {}, sourceRoot } = {}) => ({
      model: await compileGenericSystemModel(profile, {
        declarations,
        input,
        sourceRoot
      }),
      scope: {
        authoritativeIds: [profile.adapterId],
        fullScanRequired: false,
        mode: "full",
        requestedIds: [],
        unknownIds: []
      }
    }),
    merge: (_previousModel, scopedModel) => scopedModel,
    planUpdate: (context) => genericPlan(profile, context)
  });
}

function createGenericSystemAdapters() {
  return genericSystemAdapterProfiles().map(createGenericSystemAdapter);
}

export {
  compileGenericSystemModel,
  createGenericSystemAdapter,
  createGenericSystemAdapters,
  genericPlan
};
