import {
  assertExclusiveSubsystemOwnership,
  normalizeSubsystemDefinition
} from "../../shared/subsystemContract.js";
import {
  FILE_CITY_PLACEMENT_ROLES,
  isSafeFileCityPath,
  normalizeFileCityPath
} from "../../shared/fileCityContract.js";

const SYSTEM_ADAPTER_ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_-]{0,127}$/u;

function assertSystemAdapterId(value) {
  const id = String(value || "").trim();
  if (!SYSTEM_ADAPTER_ID_PATTERN.test(id)) {
    throw new TypeError(`Invalid System adapter id: ${id || "(empty)"}.`);
  }
  return id;
}

function assertSystemAdapterPlan(plan = {}) {
  const mode = String(plan.mode || "");
  if (mode !== "full" && mode !== "incremental") {
    throw new TypeError(`System adapter returned an invalid update mode: ${mode || "(empty)"}.`);
  }
  if (!Array.isArray(plan.scopes)) {
    throw new TypeError("System adapter update plan scopes must be an array.");
  }
  return {
    mode,
    reason: String(plan.reason || "adapter-plan"),
    scopes: [...new Set(plan.scopes.map(String).filter(Boolean))].sort()
  };
}

function assertFileCityIdentifier(value, label) {
  const id = String(value || "").trim();
  if (!id || id.length > 4_096) {
    throw new TypeError(`${label} requires a stable id.`);
  }
  return id;
}

function assertFileCityRelativePath(value, label) {
  const normalized = normalizeFileCityPath(value);
  if (!isSafeFileCityPath(normalized)) {
    throw new TypeError(`${label} has an invalid source path: ${value || "(empty)"}.`);
  }
  return normalized;
}

function assertFileCityCampuses(adapter = {}) {
  if (adapter.fileCity == null) {
    return;
  }
  const campuses = adapter.fileCity?.campuses;
  if (!Array.isArray(campuses)) {
    throw new TypeError("System adapter fileCity.campuses must be an array.");
  }
  if (campuses.length > 32) {
    throw new TypeError("System adapter fileCity.campuses exceeds the 32-campus limit.");
  }
  const ids = new Set();
  const roots = new Set();
  for (const campus of campuses) {
    const id = assertSystemAdapterId(campus?.id);
    if (ids.has(id)) {
      throw new TypeError(`System adapter returned duplicate file campus id: ${id}.`);
    }
    ids.add(id);
    if (!String(campus?.title || "").trim()) {
      throw new TypeError(`System adapter file campus ${id} requires a title.`);
    }
    if (!Array.isArray(campus?.roots) || campus.roots.length === 0) {
      throw new TypeError(`System adapter file campus ${id} requires at least one source root.`);
    }
    for (const value of campus.roots) {
      const root = String(value || "").trim().replace(/^\.\//u, "").replace(/\/+$/u, "");
      if (!root || root.startsWith("/") || root.split("/").includes("..")) {
        throw new TypeError(`System adapter file campus ${id} has an invalid source root: ${value || "(empty)"}.`);
      }
      if (roots.has(root)) {
        throw new TypeError(`System adapter file campus source root is claimed more than once: ${root}.`);
      }
      roots.add(root);
    }
  }
}

function assertFileCityTopology(adapter = {}, files = []) {
  if (adapter.fileCity == null) {
    return;
  }
  const groups = adapter.fileCity.groups ?? [];
  const placements = adapter.fileCity.placements ?? [];
  if (!Array.isArray(groups)) {
    throw new TypeError("System adapter fileCity.groups must be an array when present.");
  }
  if (!Array.isArray(placements)) {
    throw new TypeError("System adapter fileCity.placements must be an array when present.");
  }
  if (groups.length > 20_000) {
    throw new TypeError("System adapter fileCity.groups exceeds the 20,000-group limit.");
  }
  if (placements.length > 100_000) {
    throw new TypeError("System adapter fileCity.placements exceeds the 100,000-placement limit.");
  }

  const groupsById = new Map();
  const groupIdByPath = new Map();
  for (const group of groups) {
    const id = assertFileCityIdentifier(group?.id, "System adapter File City group");
    if (groupsById.has(id)) {
      throw new TypeError(`System adapter returned duplicate File City group id: ${id}.`);
    }
    const groupPath = assertFileCityRelativePath(
      group?.path,
      `System adapter File City group ${id}`
    );
    if (groupIdByPath.has(groupPath)) {
      throw new TypeError(
        `System adapter File City groups ${groupIdByPath.get(groupPath)} and ${id} share ${groupPath}.`
      );
    }
    if (!String(group?.title || "").trim()) {
      throw new TypeError(`System adapter File City group ${id} requires a title.`);
    }
    groupsById.set(id, group);
    groupIdByPath.set(groupPath, id);
  }

  for (const [id, group] of groupsById) {
    const parentId = String(group?.parentId || "").trim();
    if (parentId && (!groupsById.has(parentId) || parentId === id)) {
      throw new TypeError(`System adapter File City group ${id} has an invalid parent: ${parentId}.`);
    }
    const visited = new Set([id]);
    let ancestorId = parentId;
    while (ancestorId) {
      if (visited.has(ancestorId)) {
        throw new TypeError(`System adapter File City group ${id} has cyclic ancestry.`);
      }
      visited.add(ancestorId);
      ancestorId = String(groupsById.get(ancestorId)?.parentId || "").trim();
    }
  }

  const knownFileIds = new Set(files.map((file) => String(file?.id || "")).filter(Boolean));
  const placedFileIds = new Set();
  for (const placement of placements) {
    const fileId = assertFileCityIdentifier(
      placement?.fileId,
      "System adapter File City placement"
    );
    if (placedFileIds.has(fileId)) {
      throw new TypeError(`System adapter returned more than one File City placement for ${fileId}.`);
    }
    if (!knownFileIds.has(fileId)) {
      throw new TypeError(`System adapter File City placement references an unknown file: ${fileId}.`);
    }
    const groupId = assertFileCityIdentifier(
      placement?.groupId,
      `System adapter File City placement ${fileId}`
    );
    const group = groupsById.get(groupId);
    if (!group) {
      throw new TypeError(`System adapter File City placement ${fileId} references unknown group ${groupId}.`);
    }
    const role = String(placement?.role || "");
    if (!FILE_CITY_PLACEMENT_ROLES.includes(role)) {
      throw new TypeError(`System adapter File City placement ${fileId} has invalid role ${role || "(empty)"}.`);
    }
    const visualParentPath = assertFileCityRelativePath(
      placement?.visualParentPath,
      `System adapter File City placement ${fileId}`
    );
    if (visualParentPath !== normalizeFileCityPath(group.path)) {
      throw new TypeError(
        `System adapter File City placement ${fileId} must use its group's path as visualParentPath.`
      );
    }
    placedFileIds.add(fileId);
  }
}

function assertNormalizedSystemModel(model = {}, adapterId = "") {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new TypeError("System adapter must return a normalized model object.");
  }
  if (model.adapter?.id !== adapterId) {
    throw new TypeError(`System adapter ${adapterId} returned model adapter ${model.adapter?.id || "(missing)"}.`);
  }
  for (const tableName of ["files", "entities", "relationships", "evidence", "diagnostics"]) {
    if (!Array.isArray(model[tableName])) {
      throw new TypeError(`System adapter model ${tableName} must be an array.`);
    }
  }
  assertFileCityCampuses(model.adapter);
  assertFileCityTopology(model.adapter, model.files);
  const subsystemDefinitions = model.entities
    .filter((entity) => entity.kind === "subsystem")
    .map((entity) => normalizeSubsystemDefinition({
      id: entity.id,
      title: entity.title,
      description: entity.description,
      parentId: entity.parentId,
      packageId: entity.metadata?.packageId,
      executionSide: entity.executionSide,
      origin: entity.origin === "inferred" || entity.origin === "declared" ? entity.origin : "derived",
      meaningOrigin: entity.metadata?.meaningOrigin,
      status: entity.metadata?.status,
      authoredBy: entity.metadata?.authoredBy,
      anchors: entity.metadata?.anchors,
      capabilities: entity.metadata?.capabilities
    }));
  assertExclusiveSubsystemOwnership(subsystemDefinitions);
  return model;
}

function defineSystemAdapter({
  analyze,
  id,
  merge,
  planUpdate,
  version = 1
} = {}) {
  const adapterId = assertSystemAdapterId(id);
  if (typeof analyze !== "function" || typeof merge !== "function" || typeof planUpdate !== "function") {
    throw new TypeError(`System adapter ${adapterId} must provide analyze, merge, and planUpdate functions.`);
  }
  const adapterVersion = Math.max(1, Number(version) || 1);
  return Object.freeze({
    id: adapterId,
    version: adapterVersion,
    async analyze(context = {}) {
      const result = await analyze(context);
      const scope = result?.scope || {};
      if (!Array.isArray(scope.authoritativeIds)) {
        throw new TypeError(`System adapter ${adapterId} result must declare authoritative scope ids.`);
      }
      return {
        ...result,
        model: assertNormalizedSystemModel(result?.model, adapterId),
        scope: {
          authoritativeIds: [...new Set(scope.authoritativeIds.map(String).filter(Boolean))].sort(),
          fullScanRequired: scope.fullScanRequired === true,
          mode: scope.mode === "partial" ? "partial" : "full",
          requestedIds: [...new Set((scope.requestedIds || []).map(String).filter(Boolean))].sort(),
          unknownIds: [...new Set((scope.unknownIds || []).map(String).filter(Boolean))].sort()
        }
      };
    },
    merge(previousModel, scopedModel, scopes) {
      return assertNormalizedSystemModel(
        merge(previousModel, scopedModel, scopes),
        adapterId
      );
    },
    planUpdate(context = {}) {
      return assertSystemAdapterPlan(planUpdate(context));
    }
  });
}

export {
  assertNormalizedSystemModel,
  assertSystemAdapterId,
  defineSystemAdapter
};
