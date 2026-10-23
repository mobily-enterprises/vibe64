export {
  useVibe64DatabaseTools
} from "./composables/useVibe64DatabaseTools.js";

async function loadVibe64DatabaseWorkspace() {
  const module = await import("./components/Vibe64DatabaseWorkspace.vue");
  return module.default;
}

async function loadLocalDatabaseServer() {
  const module = await import("./components/LocalDatabaseServer.vue");
  return module.default;
}

export {
  loadLocalDatabaseServer,
  loadVibe64DatabaseWorkspace
};
