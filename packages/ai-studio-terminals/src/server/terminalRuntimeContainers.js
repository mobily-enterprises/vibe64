import {
  ensureRuntimeContainers,
  runtimeContainersTerminalEnv
} from "../../../../server/lib/aiStudio/runtimeContainers.js";

async function adapterRuntimeContainerContext({
  runtime = null,
  session = {},
  target = "",
  targetRoot = ""
} = {}) {
  if (typeof runtime?.adapter?.listRuntimeContainers !== "function") {
    return {
      context: null,
      descriptors: []
    };
  }
  const context = {
    config: runtime.projectConfig || {},
    runtime,
    session,
    target,
    targetRoot
  };
  const descriptors = await runtime.adapter.listRuntimeContainers(context);
  return {
    context,
    descriptors: Array.isArray(descriptors) ? descriptors : []
  };
}

async function adapterRuntimeContainersTerminalEnv({
  runtime = null,
  session = {},
  target = "",
  targetRoot = ""
} = {}) {
  const { context, descriptors } = await adapterRuntimeContainerContext({
    runtime,
    session,
    target,
    targetRoot
  });
  if (!context) {
    return {};
  }
  return runtimeContainersTerminalEnv(descriptors, {
    adapterId: runtime.adapter.id,
    context,
    targetRoot
  });
}

async function ensureAdapterRuntimeContainers({
  runtime = null,
  session = {},
  target = "",
  targetRoot = ""
} = {}) {
  const { context, descriptors } = await adapterRuntimeContainerContext({
    runtime,
    session,
    target,
    targetRoot
  });
  if (!context) {
    return [];
  }
  return ensureRuntimeContainers(descriptors, {
    adapterId: runtime.adapter.id,
    context,
    targetRoot
  });
}

export {
  adapterRuntimeContainerContext,
  adapterRuntimeContainersTerminalEnv,
  ensureAdapterRuntimeContainers
};
