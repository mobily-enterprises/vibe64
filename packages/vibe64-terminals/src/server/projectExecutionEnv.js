import { stableHash } from "@local/vibe64-execution/server";
import { executionEnvRecord } from "./executionEnvRecord.js";

function executionEnvFingerprint(env = {}) {
  return stableHash(JSON.stringify(Object.entries(executionEnvRecord(env))
    .sort(([left], [right]) => left.localeCompare(right))));
}

async function loadProjectExecutionEnvRecords({
  prepare = false,
  reusePrepared = false,
  includeResourceConfiguration = false,
  project = {},
  session = {},
  target = ""
} = {}) {
  const resolveEnvironment = prepare
    ? project.projectExecutionEnvironment
    : project.projectInspectionEnvironment;
  if (typeof resolveEnvironment !== "function") {
    return {
      runtimeConfigEnv: {},
      ...(includeResourceConfiguration ? { resourceConfigurationFingerprint: null } : {})
    };
  }
  const sessionId = String(session.sessionId || "").trim();
  const env = await resolveEnvironment.call(project, {
    ...(includeResourceConfiguration ? { includeResourceConfiguration: true } : {}),
    ...(reusePrepared ? { reusePrepared: true } : {}),
    ...(sessionId ? { sessionId } : {}),
    ...(sessionId ? { session } : {}),
    target: String(target || "").trim()
  });
  return {
    runtimeConfigEnv: executionEnvRecord(includeResourceConfiguration ? env.environment : env),
    ...(includeResourceConfiguration && Object.hasOwn(env, "resourcePreparation")
      ? { resourcePreparation: env.resourcePreparation } : {}),
    ...(includeResourceConfiguration ? { resourceConfigurationFingerprint: env.resourceConfigurationFingerprint ?? null } : {})
  };
}

function projectExecutionEnvFromRecords({
  runtimeConfigEnv = {}
} = {}) {
  return executionEnvRecord(runtimeConfigEnv);
}

async function loadProjectExecutionEnv(input = {}) {
  return projectExecutionEnvFromRecords(await loadProjectExecutionEnvRecords(input));
}

export {
  executionEnvFingerprint,
  loadProjectExecutionEnv,
  loadProjectExecutionEnvRecords,
  projectExecutionEnvFromRecords
};
