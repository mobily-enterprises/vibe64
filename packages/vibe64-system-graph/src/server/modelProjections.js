import path from "node:path";

import {
  encodeSystemKey
} from "./systemKeys.js";
import {
  subsystemAnchorMatchesFile,
  subsystemAnchorSpecificity,
  subsystemOriginPriority
} from "../shared/subsystemContract.js";

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function subsystemDefinitions(model = {}) {
  return stableSort(
    (model.entities || []).filter((entity) => entity.kind === "subsystem"),
    (entity) => entity.id
  ).map((entity) => {
    const metadata = entity.metadata || {};
    const fallbackPackageRoot = metadata.descriptorPath
      ? path.posix.dirname(metadata.descriptorPath)
      : "";
    const anchors = metadata.anchors?.length
      ? metadata.anchors
      : fallbackPackageRoot && fallbackPackageRoot !== "."
        ? [{
            kind: "directory",
            path: fallbackPackageRoot,
            relation: "owns",
            origin: entity.origin || "derived",
            evidenceIds: []
          }]
        : [];
    return {
      authoredBy: metadata.authoredBy || (entity.origin === "inferred" ? "codex" : entity.origin === "declared" ? "user" : "adapter"),
      anchors: stableSort(anchors, (anchor) => `${anchor.path}:${anchor.relation}:${anchor.kind}`),
      capabilities: stableSort(metadata.capabilities || [], (capability) => capability.id),
      description: entity.description || "",
      executionSide: entity.executionSide || "unknown",
      id: entity.id,
      key: encodeSystemKey(entity.id),
      meaningOrigin: metadata.meaningOrigin || entity.origin || "derived",
      origin: entity.origin || "derived",
      packageId: metadata.packageId || "",
      parentId: entity.parentId || "",
      status: metadata.status || (entity.origin === "inferred" ? "proposed" : entity.origin === "declared" ? "accepted" : "current"),
      title: entity.title || entity.id
    };
  });
}

function subsystemAssignments(files = [], definitions = []) {
  const assignments = new Map();
  const metrics = new Map(definitions.map((definition) => [definition.id, {
    files: 0,
    lines: 0,
    matchedAnchors: new Set()
  }]));

  for (const file of files) {
    const matches = [];
    for (const definition of definitions) {
      for (const anchor of definition.anchors) {
        if (!subsystemAnchorMatchesFile(anchor, file.path)) {
          continue;
        }
        matches.push({ anchor, definition });
        const metric = metrics.get(definition.id);
        metric.matchedAnchors.add(`${anchor.kind}:${anchor.path}:${anchor.relation}`);
      }
    }
    const subsystemIds = [...new Set(matches.map((match) => match.definition.id))].sort();
    for (const subsystemId of subsystemIds) {
      const metric = metrics.get(subsystemId);
      metric.files += 1;
      metric.lines += Math.max(0, Number(file.lines) || 0);
    }
    const owners = matches
      .filter((match) => match.anchor.relation === "owns")
      .sort((left, right) => (
        subsystemAnchorSpecificity(right.anchor) - subsystemAnchorSpecificity(left.anchor) ||
        subsystemOriginPriority(right.anchor.origin) - subsystemOriginPriority(left.anchor.origin) ||
        left.definition.id.localeCompare(right.definition.id)
      ));
    const primary = owners[0] || null;
    const conflictingOwnerIds = primary
      ? owners
          .filter((owner) => (
            owner.definition.id !== primary.definition.id &&
            subsystemAnchorSpecificity(owner.anchor) === subsystemAnchorSpecificity(primary.anchor) &&
            subsystemOriginPriority(owner.anchor.origin) === subsystemOriginPriority(primary.anchor.origin)
          ))
          .map((owner) => owner.definition.id)
      : [];
    assignments.set(file.id, {
      conflictingOwnerIds,
      primarySubsystem: primary?.definition || null,
      primaryAnchor: primary?.anchor || null,
      subsystemIds
    });
  }
  return { assignments, metrics };
}

function subsystemDependencyGraph(model = {}, definitions = [], assignments = new Map()) {
  const definitionsById = new Map(definitions.map((definition) => [definition.id, definition]));
  const packageSubsystems = new Map();
  for (const definition of definitions) {
    if (!definition.packageId) {
      continue;
    }
    const existing = packageSubsystems.get(definition.packageId);
    if (!existing || (definition.origin === "derived" && existing.origin !== "derived")) {
      packageSubsystems.set(definition.packageId, definition);
    }
  }
  const filesByPath = new Map((model.files || []).map((file) => [file.path, file]));
  const edges = new Map();
  const externalDependencies = new Map();

  function edgeRecord(fromSubsystemId, toSubsystemId) {
    const key = `${fromSubsystemId}\u0000${toSubsystemId}`;
    if (!edges.has(key)) {
      edges.set(key, {
        classifications: new Set(),
        declared: false,
        fileConnections: new Map(),
        fromSubsystemId,
        importCount: 0,
        sourceFileIds: new Set(),
        toSubsystemId
      });
    }
    return edges.get(key);
  }

  function externalRecord(subsystemId, packageId, kind = "package") {
    const key = `${subsystemId}\u0000${packageId}`;
    if (!externalDependencies.has(key)) {
      externalDependencies.set(key, {
        importCount: 0,
        kind,
        packageId,
        sourceFileIds: new Set(),
        subsystemId
      });
    }
    return externalDependencies.get(key);
  }

  for (const file of model.files || []) {
    const fromSubsystemId = assignments.get(file.id)?.primarySubsystem?.id || "";
    if (!fromSubsystemId) {
      continue;
    }
    for (const importRecord of file.imports || []) {
      const targetFile = importRecord.targetFile ? filesByPath.get(importRecord.targetFile) : null;
      const toSubsystemId = (
        targetFile ? assignments.get(targetFile.id)?.primarySubsystem?.id : ""
      ) || packageSubsystems.get(importRecord.targetPackageId)?.id || "";
      if (toSubsystemId && toSubsystemId !== fromSubsystemId) {
        const edge = edgeRecord(fromSubsystemId, toSubsystemId);
        edge.importCount += 1;
        edge.sourceFileIds.add(file.id);
        edge.classifications.add(importRecord.classification);
        if (targetFile) {
          const connectionKey = `${file.id}\u0000${targetFile.id}`;
          const connection = edge.fileConnections.get(connectionKey) || {
            fromFileId: file.id,
            importCount: 0,
            toFileId: targetFile.id
          };
          connection.importCount += 1;
          edge.fileConnections.set(connectionKey, connection);
        }
        continue;
      }
      if (importRecord.classification !== "external-package" || !importRecord.targetPackageId) {
        continue;
      }
      if (importRecord.targetPackageId.startsWith("node:")) {
        continue;
      }
      const external = externalRecord(fromSubsystemId, importRecord.targetPackageId);
      external.importCount += 1;
      external.sourceFileIds.add(file.id);
    }
  }

  for (const relationship of model.relationships || []) {
    if (relationship.kind !== "depends_on" || !definitionsById.has(relationship.from)) {
      continue;
    }
    if (definitionsById.has(relationship.to) && relationship.to !== relationship.from) {
      edgeRecord(relationship.from, relationship.to).declared = true;
      continue;
    }
  }

  const dependenciesBySubsystem = new Map(definitions.map((definition) => [definition.id, {
    external: [],
    incoming: [],
    outgoing: []
  }]));
  for (const edge of edges.values()) {
    const from = definitionsById.get(edge.fromSubsystemId);
    const to = definitionsById.get(edge.toSubsystemId);
    if (!from || !to) {
      continue;
    }
    const summary = {
      classifications: [...edge.classifications].sort(),
      declared: edge.declared,
      fileCount: edge.sourceFileIds.size,
      fileConnections: stableSort(edge.fileConnections.values(), (connection) => (
        `${connection.fromFileId}:${connection.toFileId}`
      )),
      importCount: edge.importCount,
      sourceFileIds: [...edge.sourceFileIds].sort()
    };
    dependenciesBySubsystem.get(from.id).outgoing.push({
      ...summary,
      subsystemId: to.id,
      title: to.title
    });
    dependenciesBySubsystem.get(to.id).incoming.push({
      ...summary,
      subsystemId: from.id,
      title: from.title
    });
  }
  for (const external of externalDependencies.values()) {
    if (!dependenciesBySubsystem.has(external.subsystemId)) {
      continue;
    }
    dependenciesBySubsystem.get(external.subsystemId).external.push({
      fileCount: external.sourceFileIds.size,
      importCount: external.importCount,
      kind: external.kind,
      packageId: external.packageId,
      sourceFileIds: [...external.sourceFileIds].sort(),
      title: external.packageId
    });
  }
  for (const dependencies of dependenciesBySubsystem.values()) {
    dependencies.outgoing = stableSort(dependencies.outgoing, (dependency) => dependency.title);
    dependencies.incoming = stableSort(dependencies.incoming, (dependency) => dependency.title);
    dependencies.external = stableSort(dependencies.external, (dependency) => `${dependency.kind}:${dependency.title}`);
  }
  return dependenciesBySubsystem;
}

function entityProjection(entity = {}) {
  return {
    ...entity,
    key: encodeSystemKey(entity.id)
  };
}

function relationshipProjection(relationship = {}) {
  return {
    ...relationship,
    fromKey: relationship.from ? encodeSystemKey(relationship.from) : "",
    toKey: relationship.to ? encodeSystemKey(relationship.to) : ""
  };
}

function fileProjection(file = {}, assignment = {}) {
  const primarySubsystem = assignment.primarySubsystem || null;
  return {
    ...file,
    directory: path.posix.dirname(file.path) === "." ? "" : path.posix.dirname(file.path),
    key: encodeSystemKey(file.id),
    ownershipConflictIds: assignment.conflictingOwnerIds || [],
    ownershipOrigin: assignment.primaryAnchor?.origin || "",
    subsystemId: primarySubsystem?.id || "",
    subsystemIds: assignment.subsystemIds || [],
    subsystemTitle: primarySubsystem?.title || ""
  };
}

function fileCityProjection(file = {}, {
  entitiesById = new Map(),
  importedByCount = 0,
  assignment = {}
} = {}) {
  const subsystem = assignment.primarySubsystem || null;
  const roles = (file.implementedEntityIds || [])
    .map((entityId) => entitiesById.get(entityId))
    .filter(Boolean)
    .map((entity) => ({
      description: entity.description,
      key: encodeSystemKey(entity.id),
      kind: entity.kind,
      title: entity.title
    }));
  return {
    bytes: Math.max(0, Number(file.bytes) || 0),
    directory: path.posix.dirname(file.path) === "." ? "" : path.posix.dirname(file.path),
    executionSide: file.executionSide,
    id: file.id,
    importCount: (file.imports || []).length,
    importedByCount: Math.max(0, Number(importedByCount) || 0),
    key: encodeSystemKey(file.id),
    lines: Math.max(0, Number(file.lines) || 0),
    packageId: file.packageId,
    path: file.path,
    purpose: roles.find((role) => role.description)?.description || subsystem?.description || "",
    roles,
    subsystemDescription: subsystem?.description || "",
    subsystemId: subsystem?.id || "",
    subsystemIds: assignment.subsystemIds || [],
    ownershipConflictIds: assignment.conflictingOwnerIds || [],
    ownershipOrigin: assignment.primaryAnchor?.origin || "",
    subsystemTitle: subsystem?.title || ""
  };
}

function systemOverview(model = {}) {
  const definitions = subsystemDefinitions(model);
  const { assignments, metrics } = subsystemAssignments(model.files || [], definitions);
  const dependenciesBySubsystem = subsystemDependencyGraph(model, definitions, assignments);
  const entitiesById = new Map((model.entities || []).map((entity) => [entity.id, entity]));
  const importedByPath = new Map();
  for (const file of model.files || []) {
    for (const importRecord of file.imports || []) {
      if (!importRecord.targetFile) {
        continue;
      }
      importedByPath.set(importRecord.targetFile, (importedByPath.get(importRecord.targetFile) || 0) + 1);
    }
  }
  const fileMassBySubsystem = new Map();
  for (const file of model.files || []) {
    const subsystemId = assignments.get(file.id)?.primarySubsystem?.id || "";
    if (!subsystemId) {
      continue;
    }
    const current = fileMassBySubsystem.get(subsystemId) || {
      bytes: 0,
      files: 0,
      lines: 0,
      subsystemId
    };
    current.bytes += file.bytes;
    current.files += 1;
    current.lines += file.lines;
    fileMassBySubsystem.set(subsystemId, current);
  }
  return {
    adapter: model.adapter,
    coverage: model.coverage,
    diagnostics: model.diagnostics,
    entities: stableSort(model.entities || [], (entity) => entity.id).map(entityProjection),
    files: stableSort(model.files || [], (file) => file.path).map((file) => {
      return fileCityProjection(file, {
        assignment: assignments.get(file.id),
        entitiesById,
        importedByCount: importedByPath.get(file.path) || 0
      });
    }),
    fileMass: stableSort(fileMassBySubsystem.values(), (record) => record.subsystemId),
    input: model.input,
    lineStats: fileLineStats(model.files || []),
    provenance: model.provenance,
    relationships: stableSort(
      (model.relationships || []).filter((relationship) => relationship.kind !== "implemented_by"),
      (relationship) => relationship.id
    ).map(relationshipProjection),
    subsystems: definitions.map((definition) => {
      const metric = metrics.get(definition.id) || { files: 0, lines: 0, matchedAnchors: new Set() };
      return {
        ...definition,
        dependencies: dependenciesBySubsystem.get(definition.id),
        fileCount: metric.files,
        lines: metric.lines,
        unmatchedAnchorCount: Math.max(0, definition.anchors.length - metric.matchedAnchors.size)
      };
    })
  };
}

function entityDetails(model = {}, entityId = "") {
  const entity = (model.entities || []).find((candidate) => candidate.id === entityId);
  if (!entity) {
    return null;
  }
  const { assignments } = subsystemAssignments(model.files || [], subsystemDefinitions(model));
  const relationships = (model.relationships || []).filter((relationship) => (
    relationship.from === entityId || relationship.to === entityId
  ));
  const childIds = new Set(
    (model.entities || [])
      .filter((candidate) => candidate.parentId === entityId)
      .map((candidate) => candidate.id)
  );
  const descendantIds = new Set([entityId]);
  let descendantsChanged = true;
  while (descendantsChanged) {
    descendantsChanged = false;
    for (const candidate of model.entities || []) {
      if (candidate.parentId && descendantIds.has(candidate.parentId) && !descendantIds.has(candidate.id)) {
        descendantIds.add(candidate.id);
        descendantsChanged = true;
      }
    }
  }
  const entityAnchors = entity.kind === "subsystem" ? entity.metadata?.anchors || [] : [];
  const implementedFiles = (model.files || []).filter((file) => (
    (entity.kind === "subsystem" && entity.metadata?.packageId === file.packageId) ||
    entityAnchors.some((anchor) => subsystemAnchorMatchesFile(anchor, file.path)) ||
    (file.implementedEntityIds || []).some((implementedId) => descendantIds.has(implementedId)) ||
    entity.metadata?.sourcePath === file.path
  ));
  return {
    children: stableSort(
      (model.entities || []).filter((candidate) => childIds.has(candidate.id)),
      (candidate) => candidate.id
    ).map(entityProjection),
    entity: entityProjection(entity),
    files: [...implementedFiles]
      .sort((left, right) => (
        (Number(right.lines) || 0) - (Number(left.lines) || 0) || left.path.localeCompare(right.path)
      ))
      .map((file) => fileProjection(file, assignments.get(file.id))),
    findings: stableSort(
      (model.findings || []).filter((finding) => finding.entityIds.includes(entityId)),
      (finding) => finding.id
    ),
    relationships: stableSort(relationships, (relationship) => relationship.id).map(relationshipProjection)
  };
}

function entityEvidence(model = {}, entityId = "") {
  const details = entityDetails(model, entityId);
  if (!details) {
    return null;
  }
  const relationshipEvidenceIds = new Set(
    details.relationships.flatMap((relationship) => relationship.evidenceIds || [])
  );
  const evidence = (model.evidence || []).filter((entry) => relationshipEvidenceIds.has(entry.id));
  const filesByPath = new Map((model.files || []).map((file) => [file.path, file]));
  return {
    entity: details.entity,
    evidence: stableSort(evidence, (entry) => entry.id).map((entry) => ({
      ...entry,
      fileKey: filesByPath.has(entry.path) ? encodeSystemKey(filesByPath.get(entry.path).id) : ""
    })),
    files: details.files,
    relationships: details.relationships
  };
}

function directoryAncestry(filePath = "") {
  const segments = path.posix.dirname(filePath).split("/").filter((segment) => segment && segment !== ".");
  return segments.map((segment, index) => ({
    name: segment,
    path: segments.slice(0, index + 1).join("/")
  }));
}

function fileLineStats(files = []) {
  const lines = files.map((file) => Math.max(0, Number(file.lines) || 0));
  return {
    files: files.length,
    largest: Math.max(0, ...lines),
    smallest: lines.length > 0 ? Math.min(...lines) : 0,
    total: lines.reduce((sum, value) => sum + value, 0)
  };
}

function fileConstellation(model = {}, fileId = "") {
  const files = model.files || [];
  const selected = files.find((file) => file.id === fileId);
  if (!selected) {
    return null;
  }
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const definitions = subsystemDefinitions(model);
  const { assignments } = subsystemAssignments(files, definitions);
  const neighborIds = new Set([selected.id]);
  const edges = [];

  for (const importRecord of selected.imports || []) {
    const target = filesByPath.get(importRecord.targetFile);
    if (target) {
      neighborIds.add(target.id);
    }
    edges.push({
      classification: importRecord.classification,
      fromFileId: selected.id,
      kind: importRecord.kind,
      line: importRecord.line,
      specifier: importRecord.specifier,
      targetPackageId: importRecord.targetPackageId,
      toFileId: target?.id || ""
    });
  }
  for (const importer of files) {
    for (const importRecord of importer.imports || []) {
      if (importRecord.targetFile !== selected.path) {
        continue;
      }
      neighborIds.add(importer.id);
      edges.push({
        classification: importRecord.classification,
        fromFileId: importer.id,
        kind: importRecord.kind,
        line: importRecord.line,
        specifier: importRecord.specifier,
        targetPackageId: importRecord.targetPackageId,
        toFileId: selected.id
      });
    }
  }

  const visibleFiles = stableSort(
    files.filter((file) => neighborIds.has(file.id)),
    (file) => file.id
  ).map((file) => fileProjection(file, assignments.get(file.id)));
  const selectedProjection = visibleFiles.find((file) => file.id === selected.id);
  const selectedSubsystemIds = new Set(selectedProjection.subsystemIds || []);
  return {
    directoryAncestry: directoryAncestry(selected.path),
    documentLineStats: fileLineStats(files),
    edges: stableSort(edges, (edge) => (
      `${edge.fromFileId}:${edge.toFileId}:${edge.line}:${edge.specifier}`
    )),
    entities: stableSort(
      (model.entities || []).filter((entity) => (
        selectedSubsystemIds.has(entity.id) || selected.implementedEntityIds.includes(entity.id)
      )),
      (entity) => entity.id
    ).map(entityProjection),
    files: visibleFiles,
    selectedFile: selectedProjection
  };
}

export {
  entityDetails,
  entityEvidence,
  fileConstellation,
  systemOverview
};
