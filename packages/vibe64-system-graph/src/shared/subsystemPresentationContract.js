const SUBSYSTEM_DEPTH_DECLARATION_KIND = "subsystem-depth";
const SUBSYSTEM_DEPTH_MAX = 4;

function normalizeSubsystemDepth(value = 0) {
  const depth = Number(value);
  if (!Number.isInteger(depth) || depth < 0 || depth > SUBSYSTEM_DEPTH_MAX) {
    throw new TypeError(`Subsystem depth must be an integer from 0 to ${SUBSYSTEM_DEPTH_MAX}.`);
  }
  return depth;
}

function subsystemDepthDeclaration(subsystemId = "", depth = 0) {
  const normalizedSubsystemId = String(subsystemId || "").trim();
  if (!normalizedSubsystemId) {
    throw new TypeError("Subsystem depth requires a subsystem id.");
  }
  return {
    depth: normalizeSubsystemDepth(depth),
    kind: SUBSYSTEM_DEPTH_DECLARATION_KIND,
    subsystemId: normalizedSubsystemId
  };
}

function subsystemDepthsFromDeclarations(declarations = []) {
  const depths = new Map();
  for (const declaration of declarations || []) {
    if (declaration?.kind !== SUBSYSTEM_DEPTH_DECLARATION_KIND) {
      continue;
    }
    const normalized = subsystemDepthDeclaration(declaration.subsystemId, declaration.depth);
    depths.set(normalized.subsystemId, normalized.depth);
  }
  return depths;
}

export {
  normalizeSubsystemDepth,
  SUBSYSTEM_DEPTH_DECLARATION_KIND,
  SUBSYSTEM_DEPTH_MAX,
  subsystemDepthDeclaration,
  subsystemDepthsFromDeclarations
};
