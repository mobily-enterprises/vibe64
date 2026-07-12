import { createHash } from "node:crypto";
import path from "node:path";

import {
  JSKIT_FACTS_SCHEMA
} from "./extractJskitFacts.js";

const JSKIT_SYSTEM_ADAPTER_VERSION = 2;
const JSKIT_FILE_CITY_CAMPUSES = Object.freeze([
  Object.freeze({
    description: "The main application source tree.",
    id: "application",
    remainder: false,
    roots: ["src"],
    title: "Application"
  }),
  Object.freeze({
    description: "The local JSKIT package ecosystem.",
    id: "packages",
    remainder: false,
    roots: ["packages"],
    title: "Packages"
  })
]);

function stableId(prefix, ...parts) {
  const value = parts.map((part) => String(part || "")).join("\u0000");
  return `${prefix}:${createHash("sha256").update(value).digest("hex").slice(0, 20)}`;
}

function stableSort(values = [], selector = (value) => value) {
  return [...values].sort((left, right) => String(selector(left)).localeCompare(String(selector(right))));
}

function normalizePath(value = "") {
  return String(value || "")
    .trim()
    .replace(/\\/gu, "/")
    .replace(/^\.\//u, "")
    .replace(/\/{2,}/gu, "/");
}

function normalizeRoutePath(value = "") {
  const normalized = String(value || "").trim().replace(/\/{2,}/gu, "/");
  if (!normalized) {
    return "";
  }
  const withRoot = normalized.startsWith("/") ? normalized : `/${normalized}`;
  return withRoot.replace(/\/$/u, "") || "/";
}

function humanize(value = "") {
  const normalized = String(value || "")
    .replace(/\.[^.]+$/u, "")
    .replace(/([a-z0-9])([A-Z])/gu, "$1 $2")
    .replace(/[-_./:]+/gu, " ")
    .trim();
  if (!normalized) {
    return "Unknown";
  }
  return normalized.charAt(0).toUpperCase() + normalized.slice(1);
}

function packageTitle(packageId = "") {
  return humanize(String(packageId || "").split("/").pop() || packageId);
}

function sourceSideSeeds(side = "") {
  if (side === "shared") {
    return ["client", "server"];
  }
  return side === "client" || side === "server" ? [side] : [];
}

function enrichExecutionSides(files = []) {
  const filesByPath = new Map(files.map((file) => [file.path, file]));
  const sidesByPath = new Map(files.map((file) => [file.path, new Set(sourceSideSeeds(file.executionSide))]));
  const queue = [];

  function seed(filePath, side) {
    const sides = sidesByPath.get(filePath);
    if (!sides || sides.has(side)) {
      return;
    }
    sides.add(side);
    queue.push({ filePath, side });
  }

  for (const file of files) {
    for (const side of sourceSideSeeds(file.executionSide)) {
      queue.push({
        filePath: file.path,
        side
      });
    }
    if (file.calls.some((call) => call.name === "vibe64SessionPath")) {
      seed(file.path, "client");
    }
    if (file.calls.some((call) => call.name === "actionRoute" || call.name === "serviceRoute") || file.routes.length > 0) {
      seed(file.path, "server");
    }
  }

  while (queue.length > 0) {
    const current = queue.shift();
    const file = filesByPath.get(current.filePath);
    for (const importRecord of file?.imports || []) {
      if (importRecord.targetFile) {
        seed(importRecord.targetFile, current.side);
      }
    }
  }

  for (const file of files) {
    const sides = sidesByPath.get(file.path) || new Set();
    file.executionSide = sides.has("client") && sides.has("server")
      ? "shared"
      : sides.has("client")
        ? "client"
        : sides.has("server")
          ? "server"
          : "unknown";
  }
}

function descriptorEvidence(packageEntry, evidence) {
  if (!packageEntry.descriptorPath) {
    return [];
  }
  const id = stableId("evidence", packageEntry.descriptorPath, "descriptor");
  evidence.set(id, {
    id,
    kind: "descriptor",
    path: packageEntry.descriptorPath,
    line: 1,
    column: 1
  });
  return [id];
}

function sourceEvidence(filePath, line, kind, evidence) {
  const id = stableId("evidence", filePath, line, kind);
  evidence.set(id, {
    id,
    kind,
    path: filePath,
    line: Math.max(1, Number(line) || 1),
    column: 1
  });
  return id;
}

function addEntity(entities, entity) {
  if (!entity.id || entities.has(entity.id)) {
    return entities.get(entity.id) || null;
  }
  const normalized = {
    origin: "derived",
    executionSide: "unknown",
    description: "",
    parentId: "",
    ...entity,
    metadata: {
      packageId: "",
      method: "",
      path: "",
      summary: "",
      sourcePath: "",
      sourceLine: 0,
      inputKnown: false,
      outputKnown: false,
      descriptorPath: "",
      executionSides: [],
      ...(entity.metadata || {})
    }
  };
  entities.set(normalized.id, normalized);
  return normalized;
}

function addRelationship(relationships, relationship) {
  if (!relationship.id || relationships.has(relationship.id)) {
    return relationships.get(relationship.id) || null;
  }
  const normalized = {
    origin: "derived",
    from: "",
    to: "",
    value: "",
    packageId: "",
    evidenceIds: [],
    ...relationship
  };
  relationships.set(normalized.id, normalized);
  return normalized;
}

function packageExecutionSides(packageEntry, files) {
  const sides = new Set();
  for (const provider of packageEntry.providers || []) {
    sides.add(provider.side);
  }
  for (const file of files) {
    if (file.packageId === packageEntry.packageId && file.executionSide !== "unknown") {
      sides.add(file.executionSide);
    }
  }
  if (sides.size === 0) {
    sides.add("unknown");
  }
  return ["client", "server", "shared", "external", "unknown"].filter((side) => sides.has(side));
}

function primaryExecutionSide(sides = []) {
  if (sides.includes("shared") || (sides.includes("client") && sides.includes("server"))) {
    return "shared";
  }
  return sides[0] || "unknown";
}

function compilePackages({ extraction, files, systemId, entities, relationships, evidence }) {
  const packagesById = new Map();
  for (const packageEntry of extraction.packages || []) {
    const executionSides = packageExecutionSides(packageEntry, files);
    const entity = addEntity(entities, {
      id: packageEntry.id,
      kind: "subsystem",
      title: packageTitle(packageEntry.packageId),
      description: packageEntry.description,
      executionSide: primaryExecutionSide(executionSides),
      parentId: systemId,
      metadata: {
        packageId: packageEntry.packageId,
        descriptorPath: packageEntry.descriptorPath,
        executionSides
      }
    });
    packagesById.set(packageEntry.packageId, {
      ...packageEntry,
      entityId: entity.id,
      executionSides
    });
    addRelationship(relationships, {
      id: stableId("relationship", "contains", systemId, entity.id),
      kind: "contains",
      from: systemId,
      to: entity.id,
      packageId: packageEntry.packageId,
      evidenceIds: descriptorEvidence(packageEntry, evidence)
    });
  }

  for (const packageEntry of packagesById.values()) {
    for (const dependencyId of packageEntry.dependsOn || []) {
      const dependency = packagesById.get(dependencyId);
      addRelationship(relationships, {
        id: `jskit:relationship:depends_on:${packageEntry.packageId}:${dependencyId}`,
        kind: "depends_on",
        from: packageEntry.entityId,
        to: dependency?.entityId || `jskit:external:package:${dependencyId}`,
        packageId: packageEntry.packageId,
        evidenceIds: descriptorEvidence(packageEntry, evidence)
      });
    }
    for (const provider of packageEntry.providers || []) {
      addEntity(entities, {
        id: provider.id,
        kind: "component",
        title: humanize(provider.exportName || path.posix.basename(provider.entrypoint)),
        parentId: packageEntry.entityId,
        executionSide: provider.side,
        metadata: {
          packageId: packageEntry.packageId,
          sourcePath: provider.entrypoint,
          sourceLine: 1
        }
      });
      addRelationship(relationships, {
        id: stableId("relationship", "contains", packageEntry.entityId, provider.id),
        kind: "contains",
        from: packageEntry.entityId,
        to: provider.id,
        packageId: packageEntry.packageId,
        evidenceIds: descriptorEvidence(packageEntry, evidence)
      });
    }
  }
  return packagesById;
}

function routeOptions(call = {}) {
  const value = call.arguments?.[2];
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function literalText(value) {
  return typeof value === "string" || typeof value === "number" || typeof value === "boolean"
    ? String(value)
    : "";
}

function wrapperRoutes(file) {
  const routes = [];
  for (const call of file.calls || []) {
    if (call.name !== "actionRoute" && call.name !== "serviceRoute") {
      continue;
    }
    const method = String(call.arguments?.[0] || "").toUpperCase();
    const routePath = normalizeRoutePath(call.arguments?.[1]);
    if (!method || !routePath) {
      continue;
    }
    const options = routeOptions(call);
    routes.push({
      line: call.line,
      method,
      path: routePath,
      summary: literalText(options.summary),
      inputKnown: Object.hasOwn(options, "body") || Object.hasOwn(options, "query"),
      outputKnown: Object.hasOwn(options, "response") || Object.hasOwn(options, "schema")
    });
  }
  for (const route of file.routes || []) {
    routes.push({
      ...route,
      summary: "",
      inputKnown: false,
      outputKnown: false
    });
  }
  return stableSort(routes, (route) => `${route.method}:${route.path}:${route.line}`);
}

function operationTitle(route) {
  if (route.summary) {
    return route.summary.replace(/[.]$/u, "");
  }
  const lastSegment = route.path.split("/").filter(Boolean).pop() || "operation";
  return humanize(lastSegment);
}

function compileOperations({ files, packagesById, entities, relationships, evidence, diagnostics }) {
  const operationsByContract = new Map();
  for (const file of files) {
    for (const route of wrapperRoutes(file)) {
      const packageEntry = packagesById.get(file.packageId);
      if (!packageEntry) {
        diagnostics.push({
          code: "route_without_package",
          message: "A route registration is outside a proven JSKIT package boundary.",
          path: file.path,
          line: route.line
        });
        continue;
      }
      const interfaceId = `http:interface:app:${packageEntry.packageId}:vibe64`;
      addEntity(entities, {
        id: interfaceId,
        kind: "interface",
        title: `${packageTitle(packageEntry.packageId)} API`,
        parentId: packageEntry.entityId,
        executionSide: "server",
        metadata: {
          packageId: packageEntry.packageId,
          path: "/vibe64"
        }
      });
      addRelationship(relationships, {
        id: stableId("relationship", "contains", packageEntry.entityId, interfaceId),
        kind: "contains",
        from: packageEntry.entityId,
        to: interfaceId,
        packageId: packageEntry.packageId
      });

      const contract = `${route.method}:${route.path}`;
      const operationId = `http:operation:app:${route.method}:${route.path}`;
      const routeEvidenceId = sourceEvidence(file.path, route.line, "route", evidence);
      const existing = entities.get(operationId);
      if (!existing) {
        addEntity(entities, {
          id: operationId,
          kind: "operation",
          title: operationTitle(route),
          description: route.summary,
          parentId: interfaceId,
          executionSide: "server",
          metadata: {
            packageId: packageEntry.packageId,
            method: route.method,
            path: route.path,
            summary: route.summary,
            sourcePath: file.path,
            sourceLine: route.line,
            inputKnown: route.inputKnown,
            outputKnown: route.outputKnown
          }
        });
        addRelationship(relationships, {
          id: stableId("relationship", "contains", interfaceId, operationId),
          kind: "contains",
          from: interfaceId,
          to: operationId,
          packageId: packageEntry.packageId,
          evidenceIds: [routeEvidenceId]
        });
      } else if (existing.metadata.packageId !== packageEntry.packageId) {
        diagnostics.push({
          code: "duplicate_operation_contract",
          message: `${contract} is registered by more than one package.`,
          path: file.path,
          line: route.line
        });
      }

      const serverProviders = (packageEntry.providers || []).filter((provider) => provider.side === "server");
      if (serverProviders.length === 1) {
        addRelationship(relationships, {
          id: stableId("relationship", "handles", serverProviders[0].id, operationId, file.path, route.line),
          kind: "handles",
          from: serverProviders[0].id,
          to: operationId,
          packageId: packageEntry.packageId,
          evidenceIds: [routeEvidenceId]
        });
      }
      addRelationship(relationships, {
        id: stableId("relationship", "implemented_by", operationId, file.path, route.line),
        kind: "implemented_by",
        from: operationId,
        to: `file:${file.path}`,
        packageId: packageEntry.packageId,
        evidenceIds: [routeEvidenceId]
      });
      operationsByContract.set(contract, operationId);
    }
  }
  return operationsByContract;
}

function clientRequestMethod(call) {
  if ((call.contextCalls || []).includes("useCommand")) {
    return "POST";
  }
  if ((call.contextCalls || []).includes("useEndpointResource")) {
    return "GET";
  }
  return "";
}

function clientRequestPath(call) {
  const suffix = normalizeRoutePath(call.arguments?.[2]);
  return suffix ? `/sessions/:sessionId${suffix === "/" ? "" : suffix}` : "";
}

function compileConsumers({ files, packagesById, systemId, entities, relationships, evidence, operationsByContract }) {
  for (const file of files) {
    for (const call of file.calls || []) {
      if (call.name !== "vibe64SessionPath") {
        continue;
      }
      const requestPath = clientRequestPath(call);
      if (!requestPath) {
        continue;
      }
      const method = clientRequestMethod(call);
      const exactOperationId = method ? operationsByContract.get(`${method}:${requestPath}`) || "" : "";
      const pathMatches = !method
        ? [...operationsByContract.entries()].filter(([contract]) => contract.endsWith(`:${requestPath}`))
        : [];
      const operationId = exactOperationId || (pathMatches.length === 1 ? pathMatches[0][1] : "");
      const packageEntry = packagesById.get(file.packageId);
      const componentId = stableId("vibe64:component:client", file.path, call.ownerFunction || call.line);
      const title = humanize(call.ownerFunction || path.posix.basename(file.path));
      addEntity(entities, {
        id: componentId,
        kind: "component",
        title,
        description: `Uses ${method || "an internal"} ${requestPath}.`,
        parentId: packageEntry?.entityId || systemId,
        executionSide: "client",
        metadata: {
          packageId: file.packageId,
          sourcePath: file.path,
          sourceLine: call.line
        }
      });
      addRelationship(relationships, {
        id: stableId("relationship", "contains", packageEntry?.entityId || systemId, componentId),
        kind: "contains",
        from: packageEntry?.entityId || systemId,
        to: componentId,
        packageId: file.packageId
      });
      const evidenceId = sourceEvidence(file.path, call.line, "client-request", evidence);
      addRelationship(relationships, {
        id: stableId("relationship", "consumes", componentId, method, requestPath, call.line),
        kind: "consumes",
        from: componentId,
        to: operationId,
        value: `${method || "UNKNOWN"} ${requestPath}`,
        packageId: file.packageId,
        evidenceIds: [evidenceId]
      });
    }
  }
}

function compileDeclarations({ declarations, entities, relationships, systemId }) {
  for (const declaration of declarations) {
    if (declaration?.kind !== "subsystem" || !declaration.id) {
      continue;
    }
    const entity = addEntity(entities, {
      id: String(declaration.id),
      kind: "subsystem",
      origin: "declared",
      title: String(declaration.title || declaration.id),
      description: String(declaration.description || ""),
      parentId: String(declaration.parentId || systemId),
      executionSide: String(declaration.executionSide || "unknown"),
      metadata: {
        executionSides: [String(declaration.executionSide || "unknown")]
      }
    });
    addRelationship(relationships, {
      id: stableId("relationship", "contains", entity.parentId, entity.id),
      kind: "contains",
      origin: "declared",
      from: entity.parentId,
      to: entity.id
    });
  }
}

function compileFiles(extractionFiles = []) {
  return extractionFiles.map((file) => ({
    id: `file:${normalizePath(file.path)}`,
    path: normalizePath(file.path),
    hash: String(file.hash || ""),
    bytes: Number(file.bytes) || 0,
    lines: Number(file.lines) || 0,
    packageId: String(file.packageId || ""),
    executionSide: String(file.executionSide || "unknown"),
    imports: Array.isArray(file.imports) ? file.imports : [],
    calls: Array.isArray(file.calls) ? file.calls : [],
    routes: Array.isArray(file.routes) ? file.routes : [],
    implementedEntityIds: []
  }));
}

function attachImplementedEntities(files, relationships) {
  const filesById = new Map(files.map((file) => [file.id, file]));
  for (const relationship of relationships.values()) {
    if (relationship.kind !== "implemented_by") {
      continue;
    }
    const file = filesById.get(relationship.to);
    if (file && !file.implementedEntityIds.includes(relationship.from)) {
      file.implementedEntityIds.push(relationship.from);
    }
  }
  for (const file of files) {
    file.implementedEntityIds.sort((left, right) => left.localeCompare(right));
    delete file.calls;
    delete file.routes;
  }
}

function refreshCoverage(model) {
  model.coverage = {
    ...(model.coverage || {}),
    files: model.files.length,
    entities: model.entities.length,
    relationships: model.relationships.length,
    evidence: model.evidence.length,
    operations: model.entities.filter((entity) => entity.kind === "operation").length,
    consumers: model.relationships.filter((relationship) => relationship.kind === "consumes").length,
    packages: model.entities.filter((entity) => (
      entity.kind === "subsystem" && entity.metadata.packageId
    )).length,
    unresolved: model.diagnostics.length + model.relationships.filter((relationship) => (
      relationship.kind === "consumes" && !relationship.to
    )).length
  };
  return model;
}

function compileJskitSystemModel(extraction = {}, {
  declarations = [],
  input = {},
  updateMode = "full"
} = {}) {
  if (extraction.schema !== JSKIT_FACTS_SCHEMA) {
    throw new TypeError(`Unsupported JSKIT System extraction schema: ${extraction.schema || "missing"}.`);
  }
  const files = compileFiles(extraction.files || []);
  enrichExecutionSides(files);
  const entities = new Map();
  const relationships = new Map();
  const evidence = new Map();
  const diagnostics = [...(extraction.diagnostics || [])];
  for (const file of files) {
    for (const importRecord of file.imports) {
      sourceEvidence(file.path, importRecord.line, "import", evidence);
    }
  }
  const rootPackage = extraction.input?.rootPackage || {};
  const systemId = `jskit:system:${rootPackage.name || "application"}`;
  addEntity(entities, {
    id: systemId,
    kind: "system",
    title: humanize(rootPackage.name || "Application"),
    description: "Current active-session application structure.",
    executionSide: "shared",
    metadata: {
      executionSides: ["client", "server", "shared"]
    }
  });
  const packagesById = compilePackages({
    entities,
    evidence,
    extraction,
    files,
    relationships,
    systemId
  });
  const operationsByContract = compileOperations({
    diagnostics,
    entities,
    evidence,
    files,
    packagesById,
    relationships
  });
  compileConsumers({
    entities,
    evidence,
    files,
    operationsByContract,
    packagesById,
    relationships,
    systemId
  });
  compileDeclarations({
    declarations,
    entities,
    relationships,
    systemId
  });
  attachImplementedEntities(files, relationships);

  const model = {
    adapter: {
      fileCity: {
        campuses: JSKIT_FILE_CITY_CAMPUSES
      },
      id: "jskit",
      version: JSKIT_SYSTEM_ADAPTER_VERSION
    },
    input: {
      ...input,
      extractionDigest: String(extraction.input?.digest || "")
    },
    declarations,
    files: stableSort(files, (file) => file.id),
    entities: stableSort(entities.values(), (entity) => entity.id),
    relationships: stableSort(relationships.values(), (relationship) => relationship.id),
    evidence: stableSort(evidence.values(), (entry) => entry.id),
    findings: [],
    diagnostics: stableSort(diagnostics, (diagnostic) => `${diagnostic.path || ""}:${diagnostic.line || 0}:${diagnostic.code || ""}`),
    coverage: {},
    provenance: {
      compiler: "vibe64-system-graph-v1",
      extractionSchema: extraction.schema,
      updateMode,
      authoritativeScopeIds: extraction.scope?.authoritativePackageIds || []
    }
  };
  return refreshCoverage(model);
}

function mergeScopedSystemModel(previousModel = {}, scopedModel = {}, scopes = []) {
  const scopeSet = new Set(scopes.map(String));
  const replacedEntityIds = new Set(
    (previousModel.entities || [])
      .filter((entity) => entity.origin !== "declared" && scopeSet.has(entity.metadata?.packageId))
      .map((entity) => entity.id)
  );
  const nextScopedEntities = (scopedModel.entities || []).filter((entity) => (
    entity.kind === "system" || scopeSet.has(entity.metadata?.packageId)
  ));
  const entitiesById = new Map(
    (previousModel.entities || [])
      .filter((entity) => !replacedEntityIds.has(entity.id))
      .map((entity) => [entity.id, entity])
  );
  for (const entity of nextScopedEntities) {
    entitiesById.set(entity.id, entity);
  }

  const filesById = new Map(
    (previousModel.files || [])
      .filter((file) => !scopeSet.has(file.packageId))
      .map((file) => [file.id, file])
  );
  for (const file of scopedModel.files || []) {
    filesById.set(file.id, file);
  }

  const finalEntityIds = new Set(entitiesById.keys());
  const relationshipsById = new Map();
  for (const relationship of previousModel.relationships || []) {
    if (scopeSet.has(relationship.packageId)) {
      continue;
    }
    const fromAvailable = !relationship.from || finalEntityIds.has(relationship.from) || relationship.from.startsWith("file:");
    const toAvailable = !relationship.to || finalEntityIds.has(relationship.to) || relationship.to.startsWith("file:") || relationship.to.startsWith("jskit:external:");
    if (fromAvailable && toAvailable) {
      relationshipsById.set(relationship.id, { ...relationship });
    }
  }
  for (const relationship of scopedModel.relationships || []) {
    relationshipsById.set(relationship.id, { ...relationship });
  }

  const packageEntityById = new Map(
    [...entitiesById.values()]
      .filter((entity) => entity.kind === "subsystem" && entity.metadata?.packageId)
      .map((entity) => [entity.metadata.packageId, entity.id])
  );
  for (const relationship of relationshipsById.values()) {
    const externalPrefix = "jskit:external:package:";
    if (relationship.kind === "depends_on" && relationship.to.startsWith(externalPrefix)) {
      relationship.to = packageEntityById.get(relationship.to.slice(externalPrefix.length)) || relationship.to;
    }
  }

  const pathPackage = new Map();
  for (const file of [...(previousModel.files || []), ...(scopedModel.files || [])]) {
    pathPackage.set(file.path, file.packageId);
  }
  for (const entity of [...(previousModel.entities || []), ...(scopedModel.entities || [])]) {
    if (entity.metadata?.descriptorPath && entity.metadata?.packageId) {
      pathPackage.set(entity.metadata.descriptorPath, entity.metadata.packageId);
    }
  }
  const evidenceById = new Map(
    (previousModel.evidence || [])
      .filter((entry) => !scopeSet.has(pathPackage.get(entry.path)))
      .map((entry) => [entry.id, entry])
  );
  for (const entry of scopedModel.evidence || []) {
    evidenceById.set(entry.id, entry);
  }

  const diagnostics = [
    ...(previousModel.diagnostics || []).filter((diagnostic) => !scopeSet.has(pathPackage.get(diagnostic.path))),
    ...(scopedModel.diagnostics || [])
  ];
  const model = {
    ...previousModel,
    adapter: scopedModel.adapter,
    input: scopedModel.input,
    declarations: previousModel.declarations || [],
    files: stableSort(filesById.values(), (file) => file.id),
    entities: stableSort(entitiesById.values(), (entity) => entity.id),
    relationships: stableSort(relationshipsById.values(), (relationship) => relationship.id),
    evidence: stableSort(evidenceById.values(), (entry) => entry.id),
    findings: [],
    diagnostics: stableSort(diagnostics, (diagnostic) => `${diagnostic.path || ""}:${diagnostic.line || 0}:${diagnostic.code || ""}`),
    provenance: {
      ...(scopedModel.provenance || {}),
      updateMode: "incremental",
      authoritativeScopeIds: [...scopeSet].sort()
    }
  };
  return refreshCoverage(model);
}

export {
  JSKIT_FILE_CITY_CAMPUSES,
  JSKIT_SYSTEM_ADAPTER_VERSION,
  compileJskitSystemModel,
  humanize,
  mergeScopedSystemModel,
  normalizeRoutePath,
  stableId
};
