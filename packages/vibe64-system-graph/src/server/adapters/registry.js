import {
  createJskitSystemAdapter
} from "./jskit/JskitSystemAdapter.js";
import {
  createGenericSystemAdapters
} from "./generic/GenericSystemAdapter.js";
import {
  assertSystemAdapterId
} from "./systemAdapterContract.js";

class UnsupportedSystemAdapterError extends Error {
  constructor(adapterId) {
    super(`System browsing is not supported for the ${adapterId} project adapter yet.`);
    this.code = "vibe64_system_adapter_unsupported";
    this.adapterId = adapterId;
  }
}

function createSystemAdapterRegistry({
  adapters = [createJskitSystemAdapter(), ...createGenericSystemAdapters()]
} = {}) {
  const adaptersById = new Map();
  for (const adapter of adapters) {
    const adapterId = assertSystemAdapterId(adapter?.id);
    if (adaptersById.has(adapterId)) {
      throw new TypeError(`Duplicate System adapter id: ${adapterId}.`);
    }
    adaptersById.set(adapterId, adapter);
  }

  function adapterFor(adapterId) {
    return adaptersById.get(String(adapterId || "").trim()) || null;
  }

  function requireAdapter(adapterId) {
    const normalizedId = assertSystemAdapterId(adapterId);
    const adapter = adapterFor(normalizedId);
    if (!adapter) {
      throw new UnsupportedSystemAdapterError(normalizedId);
    }
    return adapter;
  }

  return Object.freeze({
    adapterFor,
    availableAdapterIds: () => [...adaptersById.keys()].sort(),
    requireAdapter
  });
}

const defaultSystemAdapterRegistry = createSystemAdapterRegistry();

export {
  UnsupportedSystemAdapterError,
  createSystemAdapterRegistry,
  defaultSystemAdapterRegistry
};
