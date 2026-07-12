import path from "node:path";

import {
  encodeSystemKey
} from "./systemKeys.js";

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
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

function fileProjection(file = {}, subsystemId = "") {
  return {
    ...file,
    directory: path.posix.dirname(file.path) === "." ? "" : path.posix.dirname(file.path),
    key: encodeSystemKey(file.id),
    subsystemId
  };
}

function fileCityProjection(file = {}, {
  entitiesById = new Map(),
  importedByCount = 0,
  subsystem = null
} = {}) {
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
    subsystemTitle: subsystem?.title || ""
  };
}

function subsystemIdsByPackage(model = {}) {
  return new Map(
    (model.entities || [])
      .filter((entity) => entity.kind === "subsystem" && entity.metadata?.packageId)
      .map((entity) => [entity.metadata.packageId, entity.id])
  );
}

function systemOverview(model = {}) {
  const subsystemByPackage = subsystemIdsByPackage(model);
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
    const subsystemId = subsystemByPackage.get(file.packageId) || "";
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
      const subsystemId = subsystemByPackage.get(file.packageId) || "";
      return fileCityProjection(file, {
        entitiesById,
        importedByCount: importedByPath.get(file.path) || 0,
        subsystem: entitiesById.get(subsystemId) || null
      });
    }),
    fileMass: stableSort(fileMassBySubsystem.values(), (record) => record.subsystemId),
    input: model.input,
    lineStats: fileLineStats(model.files || []),
    provenance: model.provenance,
    relationships: stableSort(
      (model.relationships || []).filter((relationship) => relationship.kind !== "implemented_by"),
      (relationship) => relationship.id
    ).map(relationshipProjection)
  };
}

function entityDetails(model = {}, entityId = "") {
  const entity = (model.entities || []).find((candidate) => candidate.id === entityId);
  if (!entity) {
    return null;
  }
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
  const implementedFiles = (model.files || []).filter((file) => (
    (entity.kind === "subsystem" && entity.metadata?.packageId === file.packageId) ||
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
      .map((file) => fileProjection(file)),
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
  const subsystemByPackage = subsystemIdsByPackage(model);
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
  ).map((file) => fileProjection(file, subsystemByPackage.get(file.packageId) || ""));
  const selectedProjection = visibleFiles.find((file) => file.id === selected.id);
  return {
    directoryAncestry: directoryAncestry(selected.path),
    documentLineStats: fileLineStats(files),
    edges: stableSort(edges, (edge) => (
      `${edge.fromFileId}:${edge.toFileId}:${edge.line}:${edge.specifier}`
    )),
    entities: stableSort(
      (model.entities || []).filter((entity) => (
        entity.id === selectedProjection.subsystemId || selected.implementedEntityIds.includes(entity.id)
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
