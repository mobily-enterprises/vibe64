import { createHash } from "node:crypto";
import path from "node:path";

import {
  JSKIT_FACTS_SCHEMA
} from "./extractJskitFacts.js";
import {
  assertExclusiveSubsystemOwnership,
  mergeSubsystemAnchors,
  mergeSubsystemCapabilities,
  normalizeSubsystemCapability,
  normalizeSubsystemDefinition
} from "../../../shared/subsystemContract.js";
import {
  normalizeSystemConnection
} from "../../../shared/systemConnectionContract.js";

const JSKIT_SYSTEM_ADAPTER_VERSION = 3;
const JSKIT_FILE_CITY_CAMPUSES = Object.freeze([
  Object.freeze({
    description: "The client-side application source tree.",
    executionSide: "client",
    id: "application",
    remainder: false,
    roots: ["src"],
    title: "Application (client side)"
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
    if (file.path.startsWith("src/")) {
      seed(file.path, "client");
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
      anchors: [],
      capabilities: [],
      meaningOrigin: "derived",
      status: "current",
      authoredBy: "adapter",
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

function semanticMetadata(definition, defaultOrigin = "derived") {
  const normalized = normalizeSubsystemDefinition(definition, { defaultOrigin });
  return {
    anchors: normalized.anchors,
    capabilities: normalized.capabilities,
    meaningOrigin: normalized.meaningOrigin,
    status: normalized.status,
    authoredBy: normalized.authoredBy
  };
}

function packageSubsystemCapabilities(packageEntry, evidenceIds = []) {
  const descriptorPath = packageEntry.descriptorPath || "";
  return [
    ...(packageEntry.capabilities?.provides || []).map((capability) => ({
      id: `jskit:capability:provides:${packageEntry.packageId}:${capability}`,
      kind: "feature",
      direction: "provides",
      title: humanize(capability),
      value: capability,
      origin: "derived",
      sourcePath: descriptorPath,
      evidenceIds
    })),
    ...(packageEntry.capabilities?.requires || []).map((capability) => ({
      id: `jskit:capability:requires:${packageEntry.packageId}:${capability}`,
      kind: "feature",
      direction: "requires",
      title: humanize(capability),
      value: capability,
      origin: "derived",
      sourcePath: descriptorPath,
      evidenceIds
    })),
    ...(packageEntry.providers || []).map((provider) => ({
      id: `jskit:capability:provider:${provider.id}`,
      kind: "provider",
      direction: "provides",
      title: humanize(provider.exportName || path.posix.basename(provider.entrypoint)),
      value: provider.entrypoint,
      description: `${provider.side} runtime provider`,
      origin: "derived",
      sourcePath: provider.entrypoint,
      evidenceIds
    })),
    ...["client", "server"].flatMap((side) => (
      (packageEntry.containerTokens?.[side] || []).map((token) => ({
        id: `jskit:capability:container-token:${packageEntry.packageId}:${side}:${token}`,
        kind: "container-token",
        direction: "provides",
        title: humanize(token),
        value: token,
        description: `${side} container token declared by JSKIT metadata`,
        origin: "derived",
        sourcePath: packageEntry.descriptorPath,
        evidenceIds
      }))
    ))
  ];
}

function addSubsystemCapability(entities, subsystemId, capability) {
  const subsystem = entities.get(subsystemId);
  if (!subsystem || subsystem.kind !== "subsystem") {
    return;
  }
  const normalized = normalizeSubsystemCapability(capability, { defaultOrigin: "derived" });
  subsystem.metadata.capabilities = mergeSubsystemCapabilities(
    subsystem.metadata.capabilities || [],
    [normalized]
  );
}

function compilePackages({ extraction, files, systemId, entities, relationships, evidence }) {
  const packagesById = new Map();
  for (const packageEntry of extraction.packages || []) {
    const executionSides = packageExecutionSides(packageEntry, files);
    const packageEvidenceIds = descriptorEvidence(packageEntry, evidence);
    const packageRoot = normalizePath(
      packageEntry.relativeDir || path.posix.dirname(packageEntry.descriptorPath)
    );
    const semantics = semanticMetadata({
      id: packageEntry.id,
      title: packageTitle(packageEntry.packageId),
      description: packageEntry.description,
      packageId: packageEntry.packageId,
      executionSide: primaryExecutionSide(executionSides),
      origin: "derived",
      anchors: [{
        kind: "directory",
        path: packageRoot,
        relation: "owns",
        origin: "derived",
        evidenceIds: packageEvidenceIds
      }],
      capabilities: packageSubsystemCapabilities(packageEntry, packageEvidenceIds)
    });
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
        executionSides,
        ...semantics
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
      evidenceIds: packageEvidenceIds
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
      addSubsystemCapability(entities, packageEntry.entityId, {
        id: `jskit:capability:api-operation:${operationId}`,
        kind: "api-operation",
        direction: "provides",
        title: operationTitle(route),
        value: `${route.method} ${route.path}`,
        description: route.summary,
        origin: "derived",
        sourcePath: file.path,
        evidenceIds: [routeEvidenceId]
      });

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

function pageRoutePath(filePath = "") {
  const relativePath = normalizePath(filePath)
    .replace(/^src\/pages\//u, "")
    .replace(/\.[^.]+$/u, "");
  const segments = relativePath.split("/").filter(Boolean);
  if (segments.at(-1) === "index") {
    segments.pop();
  }
  const routeSegments = segments.map((segment) => {
    const catchAll = segment.match(/^\[\.\.\.([^\]]+)\]$/u);
    if (catchAll) {
      return `*${catchAll[1]}`;
    }
    const optional = segment.match(/^\[\[([^\]]+)\]\]$/u);
    if (optional) {
      return `:${optional[1]}?`;
    }
    const dynamic = segment.match(/^\[([^\]]+)\]$/u);
    return dynamic ? `:${dynamic[1]}` : segment;
  });
  return `/${routeSegments.join("/")}`;
}

function compilePageSubsystem({ files, systemId, entities, relationships, evidence }) {
  const pageFiles = files.filter((file) => (
    file.path.startsWith("src/pages/") && /\.(?:js|jsx|ts|tsx|vue)$/u.test(file.path)
  ));
  if (pageFiles.length === 0) {
    return null;
  }
  const subsystemId = "jskit:subsystem:directory:src/pages";
  const evidenceIdByPagePath = new Map();
  const capabilities = pageFiles.map((file) => {
    const routePath = pageRoutePath(file.path);
    const evidenceId = sourceEvidence(file.path, 1, "web-page", evidence);
    evidenceIdByPagePath.set(file.path, evidenceId);
    return {
      id: `jskit:capability:web-page:${routePath}`,
      kind: "web-page",
      direction: "provides",
      title: routePath,
      value: routePath,
      description: "Client-side file route",
      origin: "derived",
      sourcePath: file.path,
      evidenceIds: [evidenceId]
    };
  });
  const semantics = semanticMetadata({
    id: subsystemId,
    title: "Web site app",
    description: "Owns the client-side web pages and URLs generated from src/pages.",
    executionSide: "client",
    origin: "derived",
    anchors: [{
      kind: "directory",
      path: "src/pages",
      relation: "owns",
      origin: "derived",
      evidenceIds: capabilities.flatMap((capability) => capability.evidenceIds)
    }],
    capabilities
  });
  addEntity(entities, {
    id: subsystemId,
    kind: "subsystem",
    title: "Web site app",
    description: "Owns the client-side web pages and URLs generated from src/pages.",
    executionSide: "client",
    parentId: systemId,
    metadata: {
      path: "src/pages",
      sourcePath: "src/pages",
      executionSides: ["client"],
      ...semantics
    }
  });
  addRelationship(relationships, {
    id: stableId("relationship", "contains", systemId, subsystemId),
    kind: "contains",
    from: systemId,
    to: subsystemId,
    evidenceIds: capabilities.flatMap((capability) => capability.evidenceIds)
  });
  for (const file of pageFiles) {
    const evidenceId = evidenceIdByPagePath.get(file.path) || "";
    addRelationship(relationships, {
      id: stableId("relationship", "implemented_by", subsystemId, file.path),
      kind: "implemented_by",
      from: subsystemId,
      to: `file:${file.path}`,
      evidenceIds: evidenceId ? [evidenceId] : []
    });
  }
  return subsystemId;
}

function compileDeclarations({ declarations, entities, relationships, systemId }) {
  const normalizedDeclarations = (declarations || [])
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
    if (existing && existing.kind !== "subsystem") {
      throw new TypeError(`Subsystem declaration ${normalized.id} conflicts with an existing ${existing.kind} entity.`);
    }
    if (existing) {
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
      existing.metadata.meaningOrigin = normalized.meaningOrigin;
      existing.metadata.status = normalized.status;
      existing.metadata.authoredBy = normalized.authoredBy;
      continue;
    }

    addEntity(entities, {
      id: normalized.id,
      kind: "subsystem",
      origin: normalized.origin,
      title: normalized.title,
      description: normalized.description,
      parentId: normalized.parentId || systemId,
      executionSide: normalized.executionSide,
      metadata: {
        packageId: normalized.packageId,
        executionSides: [normalized.executionSide],
        anchors: normalized.anchors,
        capabilities: normalized.capabilities,
        meaningOrigin: normalized.meaningOrigin,
        status: normalized.status,
        authoredBy: normalized.authoredBy
      }
    });
  }

  for (const { normalized } of normalizedDeclarations) {
    const entity = entities.get(normalized.id);
    if (!entity || entity.parentId === entity.id || !entities.has(entity.parentId)) {
      throw new TypeError(`Subsystem ${normalized.id} has an invalid parent: ${entity?.parentId || "(missing)"}.`);
    }
    addRelationship(relationships, {
      id: stableId("relationship", "contains", entity.parentId, entity.id),
      kind: "contains",
      origin: normalized.origin,
      from: entity.parentId,
      to: entity.id
    });
  }

  assertExclusiveSubsystemOwnership(
    [...entities.values()]
      .filter((entity) => entity.kind === "subsystem")
      .map((entity) => ({ id: entity.id, anchors: entity.metadata.anchors || [] }))
  );
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
    imports: Array.isArray(file.imports)
      ? file.imports.map((record) => ({
          ...record,
          symbols: [...new Set((record.symbols || []).map(String).filter(Boolean))].sort()
        }))
      : [],
    tokenBindings: Array.isArray(file.tokenBindings) ? file.tokenBindings : [],
    calls: Array.isArray(file.calls) ? file.calls : [],
    routes: Array.isArray(file.routes) ? file.routes : [],
    implementedEntityIds: []
  }));
}

function packageSubsystemId(packageId = "") {
  return packageId ? `jskit:subsystem:package:${packageId}` : "";
}

function connectionEndpoint({ filePath = "", packageId = "", externalId = "" } = {}) {
  return {
    subsystemId: packageSubsystemId(packageId),
    fileId: filePath ? `file:${normalizePath(filePath)}` : "",
    externalId
  };
}

function compileSystemConnections({ extraction, files, evidence }) {
  const connections = new Map();
  for (const file of files) {
    const source = connectionEndpoint({
      filePath: file.path,
      packageId: file.packageId
    });
    for (const importRecord of file.imports || []) {
      const target = importRecord.classification === "external-package" && importRecord.targetPackageId
        ? connectionEndpoint({ externalId: `package:${importRecord.targetPackageId}` })
        : importRecord.targetFile || importRecord.targetPackageId
          ? connectionEndpoint({
            filePath: importRecord.targetFile,
            packageId: importRecord.targetPackageId
          })
          : connectionEndpoint({ externalId: `unresolved:${importRecord.specifier}` });
      const connection = normalizeSystemConnection({
        id: stableId("connection", "import", file.path, importRecord.line, importRecord.specifier),
        kind: "import",
        source,
        target,
        reference: importRecord.specifier,
        symbols: importRecord.symbols || [],
        evidenceIds: [sourceEvidence(file.path, importRecord.line, "import", evidence)],
        line: importRecord.line
      });
      connections.set(connection.id, connection);
    }
    for (const binding of file.tokenBindings || []) {
      if (binding.direction !== "consumes") {
        continue;
      }
      const connection = normalizeSystemConnection({
        id: stableId("connection", "injection", file.path, binding.line, binding.token, binding.mechanism),
        kind: "injection",
        source,
        target: connectionEndpoint({
          filePath: binding.targetFile,
          packageId: binding.targetPackageId,
          externalId: binding.targetExternalId
        }),
        reference: binding.token,
        evidenceIds: [sourceEvidence(file.path, binding.line, "injection", evidence)],
        line: binding.line
      });
      connections.set(connection.id, connection);
    }
  }
  const declarationRelationships = new Map(
    (extraction.relationships || [])
      .filter((relationship) => relationship.kind === "depends_on")
      .map((relationship) => [`${relationship.from}\u0000${relationship.to}`, relationship])
  );
  const localPackageIds = new Set((extraction.packages || []).map((entry) => entry.packageId));
  for (const packageEntry of extraction.packages || []) {
    for (const dependencyId of packageEntry.dependsOn || []) {
      const possibleTargets = new Set([
        packageSubsystemId(dependencyId),
        `jskit:external:package:${dependencyId}`
      ]);
      if ([...declarationRelationships.values()].some((relationship) => (
        relationship.from === packageEntry.id && possibleTargets.has(relationship.to)
      ))) {
        continue;
      }
      const targetId = localPackageIds.has(dependencyId)
        ? packageSubsystemId(dependencyId)
        : `jskit:external:package:${dependencyId}`;
      const relationship = {
        kind: "depends_on",
        from: packageEntry.id,
        to: targetId
      };
      const key = `${relationship.from}\u0000${relationship.to}`;
      if (!declarationRelationships.has(key)) {
        declarationRelationships.set(key, relationship);
      }
    }
  }
  for (const relationship of declarationRelationships.values()) {
    if (relationship.kind !== "depends_on") {
      continue;
    }
    const packageId = String(relationship.from || "").replace(/^jskit:subsystem:package:/u, "");
    const packageEntry = (extraction.packages || []).find((entry) => entry.packageId === packageId);
    const externalPrefix = "jskit:external:package:";
    const target = relationship.to.startsWith(externalPrefix)
      ? connectionEndpoint({ externalId: `package:${relationship.to.slice(externalPrefix.length)}` })
      : { subsystemId: relationship.to };
    const connection = normalizeSystemConnection({
      id: stableId("connection", "declaration", relationship.from, relationship.to),
      kind: "declaration",
      source: { subsystemId: relationship.from },
      target,
      reference: relationship.to.startsWith(externalPrefix)
        ? relationship.to.slice(externalPrefix.length)
        : relationship.to.replace(/^jskit:subsystem:package:/u, ""),
      evidenceIds: packageEntry ? descriptorEvidence(packageEntry, evidence) : [],
      line: 1
    });
    connections.set(connection.id, connection);
  }
  return stableSort(connections.values(), (connection) => connection.id);
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
    delete file.tokenBindings;
  }
}

function refreshCoverage(model) {
  model.coverage = {
    ...(model.coverage || {}),
    files: model.files.length,
    entities: model.entities.length,
    relationships: model.relationships.length,
    connections: model.connections?.length || 0,
    evidence: model.evidence.length,
    operations: model.entities.filter((entity) => entity.kind === "operation").length,
    consumers: model.relationships.filter((relationship) => relationship.kind === "consumes").length,
    packages: model.entities.filter((entity) => (
      entity.kind === "subsystem" && entity.metadata.packageId
    )).length,
    subsystems: model.entities.filter((entity) => entity.kind === "subsystem").length,
    subsystemCapabilities: model.entities
      .filter((entity) => entity.kind === "subsystem")
      .reduce((total, entity) => total + (entity.metadata.capabilities || []).length, 0),
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
  compilePageSubsystem({
    entities,
    evidence,
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
  const connections = compileSystemConnections({
    extraction,
    files,
    evidence
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
    connections,
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
  const connectionsById = new Map(
    (previousModel.connections || [])
      .filter((connection) => {
        const sourceFile = String(connection.source?.fileId || "").replace(/^file:/u, "");
        const sourcePackage = pathPackage.get(sourceFile);
        const sourceSubsystemPackage = String(connection.source?.subsystemId || "")
          .replace(/^jskit:subsystem:package:/u, "");
        return !scopeSet.has(sourcePackage || sourceSubsystemPackage);
      })
      .map((connection) => [connection.id, connection])
  );
  for (const connection of scopedModel.connections || []) {
    connectionsById.set(connection.id, connection);
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
    connections: stableSort(connectionsById.values(), (connection) => connection.id),
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
