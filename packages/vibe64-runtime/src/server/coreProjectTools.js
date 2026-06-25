import {
  deepFreeze
} from "@local/vibe64-core/server/deepFreeze";
import {
  createProjectToolRegistry,
  registerProjectToolContributorModules
} from "./projectToolRegistry.js";

const coreProjectToolModule = deepFreeze({
  id: "core",
  tools: []
});

const coreProjectToolModules = deepFreeze([
  coreProjectToolModule
]);

function registerCoreProjectToolModules(registry) {
  return registerProjectToolContributorModules(registry, {
    toolModules: coreProjectToolModules
  });
}

function createCoreProjectToolRegistry({
  toolModules = []
} = {}) {
  const registry = createProjectToolRegistry();
  registerCoreProjectToolModules(registry);
  return registerProjectToolContributorModules(registry, {
    toolModules
  });
}

export {
  coreProjectToolModule,
  coreProjectToolModules,
  createCoreProjectToolRegistry,
  registerCoreProjectToolModules
};
