import { createHash } from "node:crypto";
import { workspaceSetupStateFromMetadata } from "@local/vibe64-runtime/server/workspaceSetupState";
import { normalizeRuntimeConfigRecord, runtimeConfigRecordsForScope } from "@local/vibe64-core/server/runtimeConfig";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { materializeProjectEnvironmentFiles, projectEnvironmentFilesAreCurrent } from "./projectEnvironmentFiles.js";
import {
  applicationDatabaseToolEnvironment,
  localDatabaseServerDeclarations,
  managesProjectResources,
  resourceKindIsDatabase,
  satisfiedAlternative
} from "./resourceEnvironment.js";
import { envScope } from "./projectEnvironment.js";

/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectSessionWork} ProjectSessionWork */
/** @typedef {import("./types.js").ProjectResourceEnvironment} ProjectResourceEnvironment */
/** @typedef {import("./types.js").ProjectEnvironment} ProjectEnvironment */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */

function projectEnvironmentResult(resolved, input, userRecords) {
  if (input.includeResourceConfiguration !== true) return resolved.projectEnvironment;
  const values = [];
  const userByKey = new Map(runtimeConfigRecordsForScope(
    [...(resolved.savedRecords || []), ...userRecords],
    envScope(input),
    { target: input.target }
  ).map((record) => [record.key, record]));
  for (const [key, value] of Object.entries(resolved.projectEnvironment)) {
    // Managed resource addresses/credentials vary by session, not app size.
    if (Object.hasOwn(resolved.platformEnvironment || {}, key)) continue;
    const record = userByKey.get(key) || normalizeRuntimeConfigRecord({ key, value });
    if (!record.secret) values.push([key, value]);
  }
  const resources = resolved.resources.map(({ component, resource }) => [
    component, resource.id, resource.kind,
    Object.entries(satisfiedAlternative(resource, resolved.effectiveEnvironment)?.bindings || {}).sort(),
    Object.entries(resource.optionalBindings || {}).sort()
  ]).sort((left, right) => JSON.stringify(left).localeCompare(JSON.stringify(right)));
  return {
    environment: resolved.projectEnvironment,
    ...(Object.hasOwn(resolved, "resourcePreparation") ? { resourcePreparation: resolved.resourcePreparation } : {}),
    resourceConfigurationFingerprint: resolved.environmentInspectionFailed ? null : createHash("sha256")
      .update(JSON.stringify({ values: values.sort(([left], [right]) => left.localeCompare(right)), resources }))
      .digest("hex")
  };
}

/**
 * The environment a session's processes get: preparing and materializing it, its
 * status, the person's own database servers, a session's database tools, and
 * releasing a session's managed resources.
 * @param {object} dependencies
 * @param {ProjectEnvironment} dependencies.environment
 * @param {RuntimeLogger} dependencies.logger
 * @param {ProjectResourceEnvironment} dependencies.resourceEnvironmentProvider
 * @param {ProjectSelection} dependencies.selection
 * @param {ProjectSessionWork} dependencies.sessionWork
 */
function createProjectSessionEnvironment({
  environment,
  logger,
  resourceEnvironmentProvider,
  selection,
  sessionWork
}) {
  const sessionEnvironment = Object.freeze({
    async projectExecutionEnvironment(input = {}) {
      if (input.reusePrepared === true) {
        // A failed read is not evidence of readiness. The ordinary preparation
        // path below remains responsible for provisioning and its diagnostics.
        const records = await environment.userEnvRecords();
        const resolved = await environment.resolvedProjectEnvironment(input, records).catch((error) => {
          logger.warn({ error }, "Reading the prepared project environment failed; it is prepared again.");
          return null;
        });
        if (resolved?.resourcesPrepared && await projectEnvironmentFilesAreCurrent({
          environment: resolved.projectEnvironment,
          files: resolved.environmentFiles,
          sourceRoot: resolved.source.sourceRoot
        })) {
          return projectEnvironmentResult(resolved, input, records);
        }
      }
      return sessionWork.runSessionSourceWorkExclusive(input, async () => {
        const records = await environment.userEnvRecords();
        const resolved = await environment.resolvedProjectEnvironment(
          input,
          records,
          { provisionResources: true }
        );
        await materializeProjectEnvironmentFiles({
          environment: resolved.projectEnvironment,
          files: resolved.environmentFiles,
          sourceRoot: resolved.source.sourceRoot
        });
        return projectEnvironmentResult(resolved, input, records);
        // Background workspace setup can arrive while the request that started it
        // is still releasing this lock; wait for it instead of failing setup.
      }, "prepare-project-environment", { waitMs: 10_000 });
    },

    async projectInspectionEnvironment(input = {}) {
      const records = await environment.userEnvRecords();
      const resolved = await environment.resolvedProjectEnvironment(input, records);
      return projectEnvironmentResult(resolved, input, records);
    },

    async projectEnvironmentStatus(input = {}) {
      const resolved = await environment.resolvedProjectEnvironment(input, await environment.userEnvRecords());
      const resources = resolved.resources.map(({ resource }) => ({
        id: resource.id,
        kind: resource.kind,
        // Only the values processes really get count: an exported shell
        // variable never reaches Workspace setup, so it cannot make this ready.
        configured: Boolean(satisfiedAlternative(resource, resolved.projectEnvironment))
      }));
      return {
        ...(Object.hasOwn(resolved, "resourcePreparation") ? { resourcePreparation: resolved.resourcePreparation } : {}),
        status: resolved.environmentInspectionFailed ? "unavailable"
          : !resolved.resourcesPrepared ? "not-prepared"
              : resources.some(({ configured }) => !configured) ? "missing-configuration"
                : "ready",
        keys: Object.keys(resolved.projectEnvironment).sort(),
        resources,
        ...(resolved.warning
          ? { diagnostic: "Project environment declarations could not be read. Correct their configuration and retry." }
          : {})
      };
    },

    /**
     * The MySQL/MariaDB or PostgreSQL servers this project's Stack declares
     * and the person runs themselves: the exact Env names, the values that
     * apply now (Env over Stack defaults; never the shell), and the endpoint
     * the connection check uses. Secrets leave only as "set or not". A host
     * that supplies its own databases answers `managed` with nothing to do.
     */
    async localDatabaseServers(input = {}) {
      if (managesProjectResources(resourceEnvironmentProvider)) return { managed: true, databases: [] };
      const resolved = await environment.resolvedProjectEnvironment(input, await environment.userEnvRecords());
      return {
        managed: false,
        databases: localDatabaseServerDeclarations(resolved.resources, {
          environment: resolved.projectEnvironment
        })
      };
    },

    async sessionDatabaseEnvironment(input = {}) {
      const resolve = async () =>
        environment.resolvedProjectEnvironment(input, await environment.userEnvRecords(), { provisionResources: false });
      const notPrepared = (resolved) => !resolved.resourcesPrepared && !resolved.databaseToolEnvironment &&
        resolved.resources.some(({ resource }) => resourceKindIsDatabase(resource.kind));
      let resolved = await resolve();
      if (notPrepared(resolved) && resolved.source.sessionId) {
        // A host stops a managed database service nothing uses, and a restart
        // forgets what it prepared. Workspace setup's own rule restores a
        // session prepared with these exact resources, as Preview does.
        const setup = workspaceSetupStateFromMetadata((await selection.sessionForInput(input, resolved.source.sessionId))?.metadata);
        if (setup.status === "succeeded" && setup.resourceIdentity &&
            setup.resourceIdentity === resolved.resourcePreparation?.identity) {
          await sessionEnvironment.projectExecutionEnvironment({ ...input, reusePrepared: true });
          resolved = await resolve();
        }
      }
      if (notPrepared(resolved)) {
        throw vibe64Error(
          "Database not prepared. Let the assistant finish, then choose Prepare workspace in the session chat, or Retry on its failed preparation. Vibe64 prepares the managed database and credentials; the application runs its declared migrations.",
          "vibe64_session_database_not_prepared"
        );
      }
      const databaseToolEnvironment = resolved.databaseToolEnvironment ||
        applicationDatabaseToolEnvironment(resolved.resources, resolved.projectEnvironment, resolved.source.sourceRoot);
      return {
        ...(await selection.currentDevelopmentDatabaseConfiguration()),
        databaseToolEnvironment,
        source: resolved.source
      };
    },

    async releaseSessionResources(input = {}) {
      const sessionId = String(input.sessionId || "").trim();
      // readable-check: allow method-probe - optional operation: a host that keeps no session resources has nothing to release
      if (!sessionId || typeof resourceEnvironmentProvider.removeSessionResources !== "function") {
        return { ok: true };
      }
      const source = await selection.sourceForInput({
        session: input.session,
        sessionId
      });
      return resourceEnvironmentProvider.removeSessionResources({
        ...(await selection.currentDevelopmentDatabaseConfiguration()),
        projectRuntimeRoot: selection.selectedProjectRuntimeRoot(),
        projectContextRoot: selection.selectedTargetRoot(),
        sessionId,
        serviceDataRoot: selection.serviceDataRoot(),
        sourceRoot: source.sourceRoot
      });
    }
  });
  return sessionEnvironment;
}

export {
  createProjectSessionEnvironment
};
