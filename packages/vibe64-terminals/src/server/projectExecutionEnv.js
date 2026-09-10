import { stableHash } from "@local/vibe64-execution/server";

function normalizeExecutionEnvRecord(env = {}) {
  if (!env || typeof env !== "object" || Array.isArray(env)) {
    return {};
  }
  return Object.fromEntries(Object.entries(env).map(([key, value]) => [
    String(key || "").trim(),
    String(value ?? "")
  ]).filter(([key]) => Boolean(key)));
}

function executionEnvFingerprint(env = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeExecutionEnvRecord(env))
    .sort(([left], [right]) => left.localeCompare(right))));
}

async function loadProjectExecutionEnvRecords({
  prepare = false,
  reusePrepared = false,
  includeResourceConfiguration = false,
  projectService = {},
  session = {},
  target = ""
} = {}) {
  const resolveEnvironment = prepare
    ? projectService.projectExecutionEnvironment
    : projectService.projectInspectionEnvironment;
  if (typeof resolveEnvironment !== "function") {
    return {
      runtimeConfigEnv: {},
      ...(includeResourceConfiguration ? { resourceConfigurationFingerprint: null } : {})
    };
  }
  const sessionId = String(session?.sessionId || session?.id || "").trim();
  const env = await resolveEnvironment.call(projectService, {
    ...(includeResourceConfiguration ? { includeResourceConfiguration: true } : {}),
    ...(reusePrepared ? { reusePrepared: true } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionId ? { session } : {}),
    target: String(target || "").trim()
  });
  return {
    runtimeConfigEnv: normalizeExecutionEnvRecord(includeResourceConfiguration ? env.environment : env),
    ...(includeResourceConfiguration ? { resourceConfigurationFingerprint: env.resourceConfigurationFingerprint ?? null } : {})
  };
}

function projectExecutionEnvFromRecords({
  runtimeConfigEnv = {}
} = {}) {
  return normalizeExecutionEnvRecord(runtimeConfigEnv);
}

async function loadProjectExecutionEnv(input = {}) {
  return projectExecutionEnvFromRecords(await loadProjectExecutionEnvRecords(input));
}

export {
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  normalizeExecutionEnvRecord,
  projectExecutionEnvFromRecords
};
