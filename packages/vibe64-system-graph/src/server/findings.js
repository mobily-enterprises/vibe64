import { createHash } from "node:crypto";

function findingId(rule, entityIds = [], evidenceIds = []) {
  const fingerprint = JSON.stringify({
    entities: [...entityIds].sort(),
    evidence: [...evidenceIds].sort(),
    rule
  });
  return `finding:${rule}:${createHash("sha256").update(fingerprint).digest("hex").slice(0, 20)}`;
}

function evidenceFingerprint(evidenceIds = []) {
  return createHash("sha256")
    .update([...evidenceIds].sort().join("\u0000"))
    .digest("hex");
}

function acceptedFinding(finding, declarations = []) {
  const fingerprint = evidenceFingerprint(finding.evidenceIds);
  return declarations.some((declaration) => (
    declaration?.kind === "finding-acceptance" &&
    declaration.rule === finding.rule &&
    declaration.evidenceFingerprint === fingerprint &&
    JSON.stringify([...(declaration.entityIds || [])].sort()) === JSON.stringify([...finding.entityIds].sort())
  ));
}

function createFinding({
  declarations = [],
  entityIds = [],
  evidenceIds = [],
  message,
  repair,
  rule,
  severity,
  title
}) {
  const finding = {
    id: findingId(rule, entityIds, evidenceIds),
    rule,
    severity,
    title,
    message,
    repair,
    entityIds: [...new Set(entityIds)].sort(),
    evidenceIds: [...new Set(evidenceIds)].sort(),
    status: "open"
  };
  if (acceptedFinding(finding, declarations)) {
    finding.status = "accepted";
  }
  return finding;
}

function subsystemCycles(model, declarations) {
  const subsystemIds = new Set(
    model.entities.filter((entity) => entity.kind === "subsystem").map((entity) => entity.id)
  );
  const edges = new Map([...subsystemIds].map((id) => [id, []]));
  const evidenceByEdge = new Map();
  for (const relationship of model.relationships) {
    if (
      relationship.kind !== "depends_on" ||
      !subsystemIds.has(relationship.from) ||
      !subsystemIds.has(relationship.to)
    ) {
      continue;
    }
    edges.get(relationship.from).push(relationship.to);
    evidenceByEdge.set(`${relationship.from}\u0000${relationship.to}`, relationship.evidenceIds || []);
  }

  let index = 0;
  const indices = new Map();
  const lowLinks = new Map();
  const stack = [];
  const onStack = new Set();
  const components = [];

  function visit(nodeId) {
    indices.set(nodeId, index);
    lowLinks.set(nodeId, index);
    index += 1;
    stack.push(nodeId);
    onStack.add(nodeId);

    for (const targetId of edges.get(nodeId) || []) {
      if (!indices.has(targetId)) {
        visit(targetId);
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId), lowLinks.get(targetId)));
      } else if (onStack.has(targetId)) {
        lowLinks.set(nodeId, Math.min(lowLinks.get(nodeId), indices.get(targetId)));
      }
    }

    if (lowLinks.get(nodeId) !== indices.get(nodeId)) {
      return;
    }
    const component = [];
    while (stack.length > 0) {
      const memberId = stack.pop();
      onStack.delete(memberId);
      component.push(memberId);
      if (memberId === nodeId) {
        break;
      }
    }
    components.push(component.sort());
  }

  for (const subsystemId of [...subsystemIds].sort()) {
    if (!indices.has(subsystemId)) {
      visit(subsystemId);
    }
  }

  const findings = [];
  for (const component of components) {
    const selfCycle = component.length === 1 && (edges.get(component[0]) || []).includes(component[0]);
    if (component.length < 2 && !selfCycle) {
      continue;
    }
    const evidenceIds = [];
    for (const from of component) {
      for (const to of edges.get(from) || []) {
        if (component.includes(to)) {
          evidenceIds.push(...(evidenceByEdge.get(`${from}\u0000${to}`) || []));
        }
      }
    }
    findings.push(createFinding({
      declarations,
      entityIds: component,
      evidenceIds,
      message: "These subsystems depend on one another in a closed loop, so their boundaries cannot change independently.",
      repair: "Choose one dependency direction and move the shared contract or behavior behind that boundary.",
      rule: "subsystem_dependency_cycle",
      severity: "high",
      title: "Subsystem dependency cycle"
    }));
  }
  return findings;
}

function undeclaredCrossPackageDependencies(model, declarations) {
  const declared = new Set(
    model.relationships
      .filter((relationship) => relationship.kind === "depends_on")
      .map((relationship) => `${relationship.from}\u0000${relationship.to}`)
  );
  const packageEntities = new Map(
    model.entities
      .filter((entity) => entity.kind === "subsystem" && entity.metadata.packageId)
      .map((entity) => [entity.metadata.packageId, entity.id])
  );
  const findings = [];
  for (const file of model.files) {
    const sourceEntityId = packageEntities.get(file.packageId);
    if (!sourceEntityId) {
      continue;
    }
    for (const importRecord of file.imports) {
      if (
        !["cross-package", "package-specifier"].includes(importRecord.classification) ||
        !importRecord.targetPackageId ||
        importRecord.targetPackageId === file.packageId
      ) {
        continue;
      }
      const targetEntityId = packageEntities.get(importRecord.targetPackageId);
      if (!targetEntityId || declared.has(`${sourceEntityId}\u0000${targetEntityId}`)) {
        continue;
      }
      const evidenceId = model.evidence.find((entry) => (
        entry.path === file.path && entry.line === importRecord.line
      ))?.id || "";
      findings.push(createFinding({
        declarations,
        entityIds: [sourceEntityId, targetEntityId],
        evidenceIds: evidenceId ? [evidenceId] : [],
        message: `${file.packageId} imports ${importRecord.targetPackageId} without declaring that subsystem dependency.`,
        repair: "Declare the package dependency or move the import behind an existing public contract.",
        rule: "undeclared_cross_package_dependency",
        severity: importRecord.classification === "cross-package" ? "high" : "medium",
        title: "Undeclared cross-package dependency"
      }));
    }
  }
  return findings;
}

function operationProviderFindings(model, declarations) {
  const providersByOperation = new Map();
  for (const relationship of model.relationships) {
    if (relationship.kind !== "handles") {
      continue;
    }
    const records = providersByOperation.get(relationship.to) || [];
    records.push(relationship);
    providersByOperation.set(relationship.to, records);
  }
  const findings = [];
  for (const operation of model.entities.filter((entity) => entity.kind === "operation")) {
    const providers = providersByOperation.get(operation.id) || [];
    if (providers.length === 1) {
      continue;
    }
    findings.push(createFinding({
      declarations,
      entityIds: [operation.id, ...providers.map((relationship) => relationship.from)],
      evidenceIds: providers.flatMap((relationship) => relationship.evidenceIds || []),
      message: providers.length === 0
        ? "This server operation has no identifiable provider behind its socket."
        : "More than one provider claims this server operation.",
      repair: providers.length === 0
        ? "Attach the operation to its owning provider or remove the unimplemented registration."
        : "Choose one owning provider or make the aggregation contract explicit.",
      rule: "operation_without_provider",
      severity: "high",
      title: providers.length === 0 ? "Operation without provider" : "Operation with conflicting providers"
    }));
  }
  return findings;
}

function unmatchedClientOperations(model, declarations) {
  return model.relationships
    .filter((relationship) => relationship.kind === "consumes" && !relationship.to)
    .map((relationship) => createFinding({
      declarations,
      entityIds: [relationship.from],
      evidenceIds: relationship.evidenceIds,
      message: `The client expects ${relationship.value}, but no matching server operation exists.`,
      repair: "Add the matching server operation or correct the client request contract.",
      rule: "client_operation_without_server_operation",
      severity: "high",
      title: "Client plug has no server socket"
    }));
}

function incompleteContracts(model, declarations) {
  const evidenceByEntity = new Map();
  for (const relationship of model.relationships) {
    if (relationship.kind === "implemented_by") {
      evidenceByEntity.set(relationship.from, relationship.evidenceIds || []);
    }
  }
  return model.entities
    .filter((entity) => (
      entity.kind === "operation" &&
      (!entity.metadata.summary || (!entity.metadata.inputKnown && !entity.metadata.outputKnown))
    ))
    .map((operation) => createFinding({
      declarations,
      entityIds: [operation.id],
      evidenceIds: evidenceByEntity.get(operation.id) || [],
      message: "This public operation does not yet expose enough summary and input/output evidence to explain its contract confidently.",
      repair: "Add a route summary and a deterministic validator or response schema where the implementation owns them.",
      rule: "incomplete_public_contract",
      severity: "medium",
      title: "Incomplete public contract"
    }));
}

function applySystemFindings(model = {}) {
  const declarations = Array.isArray(model.declarations) ? model.declarations : [];
  const findings = [
    ...subsystemCycles(model, declarations),
    ...undeclaredCrossPackageDependencies(model, declarations),
    ...operationProviderFindings(model, declarations),
    ...unmatchedClientOperations(model, declarations),
    ...incompleteContracts(model, declarations)
  ].sort((left, right) => left.id.localeCompare(right.id));
  model.findings = findings;
  model.coverage = {
    ...(model.coverage || {}),
    findings: findings.length,
    acceptedFindings: findings.filter((finding) => finding.status === "accepted").length
  };
  return model;
}

export {
  applySystemFindings,
  evidenceFingerprint,
  findingId
};
