import path from "node:path";
import { inspectVibe64ProjectServices } from "@local/vibe64-genesis/server";
import { currentProjectRequestContext } from "@local/vibe64-core/server/projectRequestContext";
import {
  inspectVibe64Service,
  runVibe64Command,
  stableHash,
  stopVibe64Execution,
  stopVibe64OwnedExecutions
} from "@local/vibe64-execution/server";
import { vibe64RuntimePacks } from "./vibe64OutputTargets.js";

function createProjectServices({
  inspect = inspectVibe64ProjectServices,
  runCommand = runVibe64Command,
  inspectExecution = inspectVibe64Service,
  stopExecution = stopVibe64Execution,
  stopOwned = stopVibe64OwnedExecutions
} = {}) {
  const projects = new Map();

  function projectState(context) {
    const ownerId = `project-services-${stableHash(path.resolve(context.projectContextRoot)).slice(0, 32)}`;
    if (!projects.has(ownerId)) {
      projects.set(ownerId, {
        ownerId,
        services: new Map(),
        status: "open",
        tail: Promise.resolve()
      });
    }
    return projects.get(ownerId);
  }

  function exclusive(project, operation) {
    const result = project.tail.then(operation);
    project.tail = result.catch(() => {});
    return result;
  }

  function beginClose(context) {
    const project = projectState(context);
    project.status = "closing";
  }

  function opened(context) {
    const project = projectState(context);
    if (project.status === "closing") {
      throw new Error("Project cleanup is unfinished. Wait for Close or retry the failed Close before reopening.");
    }
    project.status = "open";
  }

  async function ensure(context) {
    const project = projectState(context);
    return exclusive(project, async () => {
      if (project.status !== "open") {
        throw new Error("Project is closing; its services cannot start.");
      }
      const source = context.sessionSourceRoot;
      const baseEnv = await context.runtime.resolvePromptEnvironment();
      let declaration;
      try {
        declaration = await inspect({ projectRoot: source, environment: { ...baseEnv, ...context.projectEnvironment } });
      } catch (error) {
        if (error.code === "STACK_REQUIRED") return;
        throw error;
      }
      if (declaration.status === "blocked") {
        throw new Error(declaration.diagnostics.map(({ message }) => message).join(" "));
      }
      for (const [id, previous] of project.services) {
        const removed = !declaration.services.some((service) => service.id === id);
        if (removed && (await inspectExecution(previous.executionId)).scopeEmpty !== true) {
          throw new Error(`Project service ${id} was removed. Close and reopen the project before starting it.`);
        }
      }
      for (const service of declaration.services) {
        const identity = stableHash(JSON.stringify(service));
        const previous = project.services.get(service.id);
        if (previous) {
          const state = await inspectExecution(previous.executionId);
          if (state.scopeEmpty !== true) {
            if (identity !== previous.identity) {
              throw new Error(`Project service ${service.id} changed. Close and reopen the project before starting it.`);
            }
            continue;
          }
        }
        if (project.status !== "open") {
          throw new Error("Project is closing; its services cannot start.");
        }
        const runtime = vibe64RuntimePacks(service.runtimeRequirements);
        if (!runtime.available) throw new Error(runtime.disabledReason);
        const result = await runCommand({
          actor: "app",
          purpose: "source",
          mode: "detached",
          envPolicy: "project",
          command: service.argv[0],
          args: service.argv.slice(1),
          cwd: path.resolve(source, service.workdir),
          allowedRoots: [source],
          baseEnv,
          project: { runtimeConfigEnv: context.projectEnvironment },
          runtimes: runtime.runtimes,
          execution: {
            kind: "preview",
            lifecycle: "service",
            ownerId: project.ownerId,
            operationId: `project-service-${service.id}`,
            label: `Project service: ${service.id}`,
            projectSlug: currentProjectRequestContext()?.slug || ""
          }
        });
        if (!result.ok) {
          throw Object.assign(new Error(result.error || `Project service ${service.id} could not start.`), { code: result.code });
        }
        project.services.set(service.id, { identity, executionId: result.execution.id });
      }
    });
  }

  async function drain(project, reason) {
    // Exact owner cleanup also finds an earlier server's service after its
    // original source session has been archived.
    const result = await stopOwned({ ownerId: project.ownerId }, { reason });
    if (result.scopeEmpty !== true) {
      throw new Error(result.error || "Project services could not be stopped.");
    }
    if (!result.supported) {
      const results = await Promise.allSettled([...project.services.values()].map(async (service) => {
        const stopped = await stopExecution(service.executionId, { termTimeoutMs: 30_000 });
        if (stopped.scopeEmpty !== true) throw new Error(stopped.error || "Project service cleanup failed.");
      }));
      const failures = results.filter(({ status }) => status === "rejected").map(({ reason: error }) => error);
      if (failures.length) throw new AggregateError(failures, "Project services could not be stopped.");
    }
    project.services.clear();
    if (project.status === "closing") {
      project.status = "closed";
    }
  }

  async function close(context) {
    const project = projectState(context);
    beginClose(context);
    return exclusive(project, () => drain(project, "project-close"));
  }

  async function closeAll() {
    for (const project of projects.values()) {
      project.status = "closing";
    }
    const results = await Promise.allSettled([...projects.values()].map((project) =>
      exclusive(project, () => drain(project, "server-shutdown"))));
    const failures = results.filter(({ status }) => status === "rejected").map(({ reason }) => reason);
    if (failures.length) throw new AggregateError(failures, "Project service shutdown failed.");
  }
  return { ensure, beginClose, opened, close, closeAll };
}

export { createProjectServices };
