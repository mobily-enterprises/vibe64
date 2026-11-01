import { stableHash } from "@local/vibe64-execution/server";
import { executionEnvRecord as normalizeExecutionEnvRecord } from "./executionEnvRecord.js";

function executionEnvFingerprint(env = {}) {
  return stableHash(JSON.stringify(Object.entries(normalizeExecutionEnvRecord(env))
    .sort(([left], [right]) => left.localeCompare(right))));
}

async function loadProjectExecutionEnvRecords({
  prepare = false,
  reusePrepared = false,
  includeResourceConfiguration = false,
  project,
  session = {},
  target = ""
}) {
  const sessionId = String(session.sessionId || "").trim();
  const request = {
    ...(includeResourceConfiguration ? { includeResourceConfiguration: true } : {}),
    ...(reusePrepared ? { reusePrepared: true } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionId ? { session } : {}),
    target: String(target || "").trim()
  };
  const env = prepare
    ? await project.projectExecutionEnvironment(request)
    : await project.projectInspectionEnvironment(request);
  return {
    runtimeConfigEnv: normalizeExecutionEnvRecord(includeResourceConfiguration ? env.environment : env),
    ...(includeResourceConfiguration && Object.hasOwn(env, "resourcePreparation")
      ? { resourcePreparation: env.resourcePreparation } : {}),
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
