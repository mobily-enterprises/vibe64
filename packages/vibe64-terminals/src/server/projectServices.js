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
        closingSessions: new Set(),
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
    const sessionId = String(context.session?.sessionId || "").trim();
    return exclusive(project, async () => {
      if (project.status !== "open" || project.closingSessions.has(sessionId)) {
        throw new Error("Project or session is closing; its services cannot start.");
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
      if (!sessionId && declaration.services.some((service) => service.scope === "session")) {
        throw new Error("A session-owned service requires the exact session identity.");
      }
      for (const previous of project.services.values()) {
        const declared = declaration.services.find((service) => service.id === previous.id);
        const changedScope = declared && (declared.scope || "project") !== previous.scope;
        if (previous.sessionId && previous.sessionId !== sessionId && !changedScope) continue;
        const removed = !declared || changedScope;
        if (removed && (await inspectExecution(previous.executionId)).scopeEmpty !== true) {
          throw new Error(`Project service ${previous.id} was removed or changed scope. Close and reopen the project before starting it.`);
        }
      }
      for (const service of declaration.services) {
        const scoped = service.scope === "session";
        const key = scoped ? `${sessionId}:${service.id}` : service.id;
        const identity = stableHash(JSON.stringify(service));
        const previous = project.services.get(key);
        if (previous) {
          const state = await inspectExecution(previous.executionId);
          if (state.scopeEmpty !== true) {
            if (identity !== previous.identity) {
              throw new Error(`Project service ${service.id} changed. Close and reopen the project before starting it.`);
            }
            continue;
          }
        }
        if (project.status !== "open" || project.closingSessions.has(sessionId)) {
          throw new Error("Project or session is closing; its services cannot start.");
        }
        const runtime = vibe64RuntimePacks(service.runtimeRequirements);
        if (!runtime.available) throw new Error(runtime.disabledReason);
        const result = await runCommand({
          actor: "app",
          purpose: "source",
          mode: "detached",
          envPolicy: scoped ? "session" : "project",
          command: service.argv[0],
          args: service.argv.slice(1),
          cwd: path.resolve(source, service.workdir),
          allowedRoots: [source],
          baseEnv,
          project: { runtimeConfigEnv: context.projectEnvironment },
          ...(scoped ? { session: { ...context.session, sourcePath: source } } : {}),
          runtimes: runtime.runtimes,
          execution: {
            kind: "preview",
            lifecycle: "service",
            ownerId: project.ownerId,
            ...(scoped ? { sessionId } : {}),
            operationId: `project-service-${service.id}`,
            label: `Project service: ${service.id}`,
            projectSlug: currentProjectRequestContext()?.slug || ""
          }
        });
        if (!result.ok) {
          throw Object.assign(new Error(result.error || `Project service ${service.id} could not start.`), { code: result.code });
        }
        project.services.set(key, {
          id: service.id, scope: scoped ? "session" : "project", sessionId: scoped ? sessionId : "",
          identity, executionId: result.execution.id
        });
      }
    });
  }

  async function drain(project, reason, sessionId = "") {
    // A managed host's exact owner cleanup also finds an earlier server's
    // service after its original source session has been archived. Locally no
    // earlier server's service survives that server, so this one stops its own.
    const result = await stopOwned({ ownerId: project.ownerId, ...(sessionId ? { sessionId } : {}) }, { reason });
    if (result.scopeEmpty !== true) {
      throw new Error(result.error || "Project services could not be stopped.");
    }
    if (!result.supported) {
      const results = await Promise.allSettled([...project.services.values()]
        .filter((service) => !sessionId || service.sessionId === sessionId).map(async (service) => {
        const stopped = await stopExecution(service.executionId, { termTimeoutMs: 30_000 });
        if (stopped.scopeEmpty !== true) throw new Error(stopped.error || "Project service cleanup failed.");
      }));
      const failures = results.filter(({ status }) => status === "rejected").map(({ reason: error }) => error);
      if (failures.length) throw new AggregateError(failures, "Project services could not be stopped.");
    }
    for (const [key, service] of project.services) {
      if (!sessionId || service.sessionId === sessionId) project.services.delete(key);
    }
    if (!sessionId) project.closingSessions.clear();
    if (!sessionId && project.status === "closing") {
      project.status = "closed";
    }
  }

  async function close(context) {
    const project = projectState(context);
    beginClose(context);
    return exclusive(project, () => drain(project, "project-close"));
  }

  async function closeSession(context, sessionId) {
    sessionId = String(sessionId || "").trim();
    if (!sessionId) throw new Error("Session service cleanup requires an exact session identity.");
    const project = projectState(context);
    project.closingSessions.add(sessionId);
    return exclusive(project, async () => {
      await drain(project, "session-close", sessionId);
      project.closingSessions.delete(sessionId);
      return { ok: true };
    });
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
  function assertOpen(context) {
    if (projectState(context).status !== "open") {
      throw new Error("The destination project is closing or closed. Reopen it before sending.");
    }
  }
  return { ensure, beginClose, opened, close, closeSession, closeAll, assertOpen };
}

export { createProjectServices };
