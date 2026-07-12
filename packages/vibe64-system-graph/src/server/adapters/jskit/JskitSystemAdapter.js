import path from "node:path";

import {
  compileJskitSystemModel,
  JSKIT_SYSTEM_ADAPTER_VERSION,
  mergeScopedSystemModel
} from "./compileJskitSystemModel.js";
import {
  extractJskitFacts
} from "./extractJskitFacts.js";
import {
  defineSystemAdapter
} from "../systemAdapterContract.js";

function packageIdForEntity(model, entityId = "") {
  return model.entities.find((entity) => entity.id === entityId)?.metadata?.packageId || "";
}

function packageRoots(model) {
  const roots = [];
  for (const entity of model.entities || []) {
    if (entity.kind !== "subsystem" || !entity.metadata?.packageId || !entity.metadata?.descriptorPath) {
      continue;
    }
    roots.push({
      packageId: entity.metadata.packageId,
      root: path.posix.dirname(entity.metadata.descriptorPath)
    });
  }
  return roots.sort((left, right) => right.root.length - left.root.length || left.root.localeCompare(right.root));
}

function changedPathPackage(model, changedPath, roots) {
  const existingFile = (model.files || []).find((file) => file.path === changedPath);
  if (existingFile?.packageId) {
    return existingFile.packageId;
  }
  return roots.find((entry) => (
    changedPath === entry.root || changedPath.startsWith(`${entry.root}/`)
  ))?.packageId || "";
}

function expandReverseDependencies(model, initialScopes) {
  const scopes = new Set(initialScopes);
  let changed = true;
  while (changed) {
    changed = false;
    for (const relationship of model.relationships || []) {
      if (relationship.kind !== "depends_on") {
        continue;
      }
      const targetPackage = packageIdForEntity(model, relationship.to);
      const sourcePackage = packageIdForEntity(model, relationship.from);
      if (scopes.has(targetPackage) && sourcePackage && !scopes.has(sourcePackage)) {
        scopes.add(sourcePackage);
        changed = true;
      }
    }
  }
  return scopes;
}

function expandClientConsumers(model, initialScopes) {
  const scopes = new Set(initialScopes);
  for (const relationship of model.relationships || []) {
    if (relationship.kind !== "consumes" || !relationship.to) {
      continue;
    }
    const targetPackage = packageIdForEntity(model, relationship.to);
    if (!scopes.has(targetPackage)) {
      continue;
    }
    const sourcePackage = packageIdForEntity(model, relationship.from);
    if (!sourcePackage) {
      return null;
    }
    scopes.add(sourcePackage);
  }
  return scopes;
}

function fullPlan(reason) {
  return {
    mode: "full",
    reason,
    scopes: []
  };
}

function planJskitSystemUpdate({
  declarationsDigest = "",
  previousModel,
  snapshot
} = {}) {
  if (!previousModel) {
    return fullPlan("missing-document");
  }
  if (previousModel.adapter?.id !== "jskit" || previousModel.adapter?.version !== JSKIT_SYSTEM_ADAPTER_VERSION) {
    return fullPlan("adapter-changed");
  }
  if (previousModel.input?.declarationsDigest !== declarationsDigest) {
    return fullPlan("declarations-changed");
  }
  if (previousModel.input?.sourceHead !== snapshot.head) {
    return fullPlan("head-changed");
  }

  const roots = packageRoots(previousModel);
  const scopes = new Set();
  for (const changedPath of snapshot.changedPaths || []) {
    if ([".jskit/lock.json", "package.json"].includes(changedPath)) {
      return fullPlan("root-contract-changed");
    }
    const packageId = changedPathPackage(previousModel, changedPath, roots);
    if (!packageId) {
      return fullPlan("unowned-path-changed");
    }
    scopes.add(packageId);
  }
  if (scopes.size === 0) {
    return fullPlan("no-safe-delta");
  }

  const dependentScopes = expandReverseDependencies(previousModel, scopes);
  const consumerScopes = expandClientConsumers(previousModel, dependentScopes);
  if (!consumerScopes) {
    return fullPlan("unowned-consumer-affected");
  }
  const authoritativeScopes = expandReverseDependencies(previousModel, consumerScopes);
  return {
    mode: "incremental",
    reason: "package-scoped-delta",
    scopes: [...authoritativeScopes].sort()
  };
}

function createJskitSystemAdapter() {
  return defineSystemAdapter({
    id: "jskit",
    version: JSKIT_SYSTEM_ADAPTER_VERSION,
    analyze: async ({
      declarations = [],
      input = {},
      scopes = [],
      sourceRoot,
      updateMode = "full"
    } = {}) => {
      const facts = await extractJskitFacts({
        scopes,
        targetRoot: sourceRoot
      });
      return {
        model: compileJskitSystemModel(facts, {
          declarations,
          input,
          updateMode
        }),
        scope: {
          authoritativeIds: facts.scope.authoritativePackageIds,
          fullScanRequired: facts.scope.fullScanRequired,
          mode: facts.scope.mode,
          requestedIds: facts.scope.requestedPackageIds,
          unknownIds: facts.scope.unknownPackageIds
        }
      };
    },
    merge: mergeScopedSystemModel,
    planUpdate: planJskitSystemUpdate
  });
}

export {
  JSKIT_SYSTEM_ADAPTER_VERSION,
  createJskitSystemAdapter,
  planJskitSystemUpdate
};
