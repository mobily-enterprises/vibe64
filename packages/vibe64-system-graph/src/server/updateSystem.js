import {
  defaultSystemAdapterRegistry
} from "./adapters/registry.js";
import { applySystemFindings } from "./findings.js";
import { systemDeclarationsDigest } from "./systemDocument.js";

function snapshotDelta(previousModel, nextModel) {
  const previousEntities = new Set((previousModel?.entities || []).map((entity) => entity.id));
  const nextEntities = new Set((nextModel.entities || []).map((entity) => entity.id));
  const previousFiles = new Map((previousModel?.files || []).map((file) => [file.id, file]));
  const nextFiles = new Map((nextModel.files || []).map((file) => [file.id, file]));
  return {
    addedEntityIds: [...nextEntities].filter((id) => !previousEntities.has(id)).slice(0, 500),
    removedEntityIds: [...previousEntities].filter((id) => !nextEntities.has(id)).slice(0, 500),
    changedFiles: [...nextFiles.values()]
      .filter((file) => {
        const previous = previousFiles.get(file.id);
        return previous && (previous.hash !== file.hash || previous.lines !== file.lines);
      })
      .map((file) => ({
        id: file.id,
        lines: file.lines,
        previousLines: previousFiles.get(file.id).lines
      }))
      .slice(0, 500)
  };
}

async function analyzeWithFallback({
  adapter,
  declarations,
  input,
  plan,
  sourceRoot
}) {
  let analysis = await adapter.analyze({
    declarations,
    input,
    scopes: plan.scopes,
    sourceRoot,
    updateMode: plan.mode
  });
  if (!analysis.scope.fullScanRequired || plan.scopes.length === 0) {
    return {
      analysis,
      fallbackReason: "",
      scopes: plan.scopes,
      updateMode: plan.mode
    };
  }
  analysis = await adapter.analyze({
    declarations,
    input,
    scopes: [],
    sourceRoot,
    updateMode: "full"
  });
  return {
    analysis,
    fallbackReason: "adapter-requested-full-scan",
    scopes: [],
    updateMode: "full"
  };
}

async function buildUpdatedSystemModel({
  adapterId,
  adapterRegistry = defaultSystemAdapterRegistry,
  declarations = [],
  previousModel = null,
  snapshot,
  sourceRoot
}) {
  const adapter = adapterRegistry.requireAdapter(adapterId);
  const declarationsDigest = systemDeclarationsDigest(declarations);
  const plan = adapter.planUpdate({
    declarationsDigest,
    previousModel,
    snapshot
  });
  const input = {
    sourceDigest: snapshot.digest,
    sourceHead: snapshot.head,
    declarationsDigest
  };
  const {
    analysis,
    fallbackReason,
    scopes,
    updateMode
  } = await analyzeWithFallback({
    adapter,
    declarations,
    input,
    plan,
    sourceRoot
  });
  const model = updateMode === "incremental" && previousModel
    ? adapter.merge(previousModel, analysis.model, scopes)
    : analysis.model;
  model.input = input;
  model.provenance = {
    ...(model.provenance || {}),
    updateMode,
    updateReason: plan.reason,
    fallbackReason,
    authoritativeScopeIds: analysis.scope.authoritativeIds
  };
  applySystemFindings(model);
  return {
    adapterId: adapter.id,
    delta: snapshotDelta(previousModel, model),
    fallbackReason,
    model,
    scopes,
    updateMode,
    updateReason: plan.reason
  };
}

export {
  buildUpdatedSystemModel,
  snapshotDelta
};
