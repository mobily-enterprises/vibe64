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

function assertNormalizedSystemModel(model = {}, adapterId = "") {
  if (!model || typeof model !== "object" || Array.isArray(model)) {
    throw new TypeError("System adapter must return a normalized model object.");
  }
  if (model.adapter?.id !== adapterId) {
    throw new TypeError(`System adapter ${adapterId} returned model adapter ${model.adapter?.id || "(missing)"}.`);
  }
  assertFileCityCampuses(model.adapter);
  for (const tableName of ["files", "entities", "relationships", "evidence", "diagnostics"]) {
    if (!Array.isArray(model[tableName])) {
      throw new TypeError(`System adapter model ${tableName} must be an array.`);
    }
  }
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
