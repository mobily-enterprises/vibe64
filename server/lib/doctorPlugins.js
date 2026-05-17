import {
  runDoctorStep
} from "./doctorStream.js";

function normalizeText(value = "") {
  return String(value || "").trim();
}

function areDoctorChecksReady(checks = []) {
  return checks.every((check) => check.required !== true || check.status === "pass");
}

function normalizePlugins(plugins = []) {
  const seenPluginIds = new Set();
  return plugins.flatMap((plugin) => {
    if (!plugin) {
      return [];
    }
    if (typeof plugin !== "object") {
      throw new Error("Doctor plugin must be an object.");
    }
    const id = normalizeText(plugin.id);
    if (!id) {
      throw new Error("Doctor plugin is missing an id.");
    }
    if (seenPluginIds.has(id)) {
      throw new Error(`Duplicate doctor plugin id: ${id}.`);
    }
    seenPluginIds.add(id);
    return [plugin];
  });
}

async function pluginChecks(plugin, context) {
  if (typeof plugin.checks !== "function") {
    return [];
  }
  const checks = await plugin.checks(context);
  if (!Array.isArray(checks)) {
    throw new Error(`Doctor plugin ${plugin.id} checks() must return an array.`);
  }
  return checks.filter(Boolean).map((check) => {
    const id = normalizeText(check.id);
    if (!id) {
      throw new Error(`Doctor plugin ${plugin.id} returned a check without an id.`);
    }
    if (typeof check.run !== "function") {
      throw new Error(`Doctor plugin ${plugin.id} check ${id} is missing run().`);
    }
    return {
      ...check,
      pluginId: plugin.id
    };
  });
}

async function listDoctorPluginChecks({
  context = {},
  plugins = []
} = {}) {
  const checks = [];
  const seenCheckIds = new Set();

  for (const plugin of normalizePlugins(plugins)) {
    for (const check of await pluginChecks(plugin, context)) {
      if (seenCheckIds.has(check.id)) {
        throw new Error(`Duplicate doctor check id: ${check.id}`);
      }
      seenCheckIds.add(check.id);
      checks.push(check);
    }
  }

  return checks;
}

async function runDoctorCheck({
  check,
  context = {},
  emit = null
}) {
  const run = async () => {
    const result = await check.run(context);
    if (!result || typeof result !== "object" || Array.isArray(result)) {
      throw new Error(`Doctor plugin ${check.pluginId || "(core)"} check ${check.id} must return a check result object.`);
    }
    if (!normalizeText(result.status)) {
      throw new Error(`Doctor plugin ${check.pluginId || "(core)"} check ${check.id} result is missing a status.`);
    }
    return check.pluginId
      ? {
          pluginId: check.pluginId,
          ...result
        }
      : result;
  };
  if (!emit) {
    return run();
  }
  return runDoctorStep({
    emit,
    id: check.id,
    label: check.label,
    run
  });
}

async function runDoctorPlugins({
  context = {},
  emit = null,
  plugins = []
} = {}) {
  const results = [];

  for (const check of await listDoctorPluginChecks({
    context,
    plugins
  })) {
    results.push(await runDoctorCheck({
      check,
      context,
      emit
    }));
  }

  return results;
}

async function firstPluginResult({
  context = {},
  methodName = "",
  plugins = []
} = {}) {
  for (const plugin of normalizePlugins(plugins)) {
    const method = plugin[methodName];
    if (typeof method !== "function") {
      continue;
    }
    const result = await method(context);
    if (result) {
      return result;
    }
  }
  return null;
}

async function startDoctorPluginTerminal({
  actionId = "",
  context = {},
  input = {},
  plugins = []
} = {}) {
  return firstPluginResult({
    context: {
      ...context,
      actionId,
      input
    },
    methodName: "startTerminal",
    plugins
  });
}

export {
  areDoctorChecksReady,
  listDoctorPluginChecks,
  runDoctorCheck,
  runDoctorPlugins,
  startDoctorPluginTerminal
};
