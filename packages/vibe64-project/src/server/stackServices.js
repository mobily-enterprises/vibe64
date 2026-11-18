import { toText } from "@jskit-ai/kernel/shared/support/normalize";
import { vibe64Error } from "@local/vibe64-core/server/core";
import { addGenesisStack, inspectGenesisEnvironment, inspectVibe64Deployment, listGenesisStackPieces } from "@local/vibe64-genesis/server";
import { DEPLOYMENT_SERVICE_ID, DEPLOYMENT_SERVICES_MAX } from "@local/vibe64-genesis/shared/deploymentServiceNames";
import { managesProjectResources, resourceKindIsDatabase } from "./resourceEnvironment.js";
import { runProjectSourceExclusive } from "./projectSourceMutationLock.js";

/** @typedef {import("./types.js").ProjectSelection} ProjectSelection */
/** @typedef {import("./types.js").ProjectSessionWork} ProjectSessionWork */
/** @typedef {import("./types.js").ProjectResourceEnvironment} ProjectResourceEnvironment */

// The resources Add a service offers, in the dialog's order, and the id the AI gives one the catalogue has no piece
// for. Another App Service (`service`) follows them.
const STACK_SERVICE_KINDS = Object.freeze(["postgresql", "mysql", "redis", "bucket"]);
const DEFAULT_RESOURCE_IDS = Object.freeze({ postgresql: "database", mysql: "database", redis: "redis", bucket: "files" });
const ANOTHER_SERVICE = "service";

/** A declaration's Env names: its preferred alternative's bindings, then each other alternative's. */
function environmentNames(declaration) {
  const alternatives = Array.isArray(declaration?.environmentAlternatives) ? declaration.environmentAlternatives : [];
  const preferred = alternatives.find((alternative) => alternative?.preferred === true) || alternatives[0];
  return {
    bindings: { ...(preferred?.bindings || {}) },
    alternatives: alternatives.filter((alternative) => alternative !== preferred).map(({ bindings }) => ({ ...bindings }))
  };
}

/**
 * The catalogue piece that adds a kind to this Stack: one that declares a resource of the kind, whose Requires are
 * all selected (or are the kind's own piece, which Genesis adds with it), and that nothing selected conflicts with.
 * The one that builds on the most selected components wins; a tie names no piece, and the AI declares the resource.
 * Public Vibe64 names no framework: the catalogue's Requires decide.
 */
function pieceForKind(kind, pieces, selected) {
  const candidates = pieces.filter((piece) => piece.resourceDeclarations.some((declaration) => declaration.kind === kind) &&
    piece.requires.every((id) => selected.has(id) || id === kind));
  const conflicting = (piece) => piece.conflicts.find((id) => selected.has(id)) ||
    pieces.find((other) => selected.has(other.id) && other.conflicts.includes(piece.id))?.id || "";
  const viable = candidates.filter((piece) => !conflicting(piece));
  const builtOn = (piece) => piece.requires.filter((id) => selected.has(id)).length;
  const best = Math.max(0, ...viable.map(builtOn));
  const top = viable.filter((piece) => builtOn(piece) === best);
  if (top.length === 1) return { piece: top[0], conflict: null };
  if (viable.length === 0 && candidates.length > 0) {
    return { piece: null, conflict: { piece: candidates[0].id, with: conflicting(candidates[0]) } };
  }
  return { piece: null, conflict: null };
}

function resourceChoice(kind, { declared, pieces, selected }) {
  const existing = declared.find(({ resource }) => resource.kind === kind);
  const database = resourceKindIsDatabase(kind) && declared.find(({ resource }) => resourceKindIsDatabase(resource.kind));
  const { piece: found, conflict } = pieceForKind(kind, pieces, selected);
  // A selected piece whose resource the project no longer declares: `stack add` adds nothing, so the AI declares it.
  const piece = found && !existing && selected.has(found.id) ? null : found;
  const declaration = existing?.resource || found?.resourceDeclarations.find((entry) => entry.kind === kind) || null;
  const resourceId = toText(declaration?.id) || DEFAULT_RESOURCE_IDS[kind];
  const taken = !existing && declared.find(({ resource }) => resource.id === resourceId);
  const refused = existing ? `Already added: ${existing.resource.id} (${kind})`
    : database ? `A project has one database: this one has ${database.resource.id} (${database.resource.kind})`
      : taken ? `genesis/stack.md already declares ${resourceId} as a ${taken.resource.kind} resource: rename it in \`## Resources\` first.`
        : conflict ? `Stack component ${conflict.piece} conflicts with ${conflict.with}, which this project selects.`
          : "";
  return {
    kind,
    piece: piece?.id || null,
    resourceId,
    ...environmentNames(declaration),
    present: Boolean(existing),
    needsAi: !refused && !piece,
    refused
  };
}

function serviceChoice(deployment) {
  const problem = deployment.error ? deployment.error.message
    : deployment.status === "blocked" ? toText(deployment.diagnostics?.[0]?.message) || "it is blocked." : "";
  const services = problem ? [] : (deployment.services || []).map(({ id, exposure }) => ({ id, exposure }));
  const refused = problem ? `The Deployment does not parse: ${problem}`
    : deployment.status !== "ready" ? "Describe how the app runs in genesis/stack.md's `## Deployment` first: a new service joins it."
      : services.length >= DEPLOYMENT_SERVICES_MAX ? `A Deployment has at most ${DEPLOYMENT_SERVICES_MAX} services.` : "";
  return {
    kind: ANOTHER_SERVICE,
    piece: null,
    resourceId: null,
    bindings: {},
    alternatives: [],
    present: false,
    needsAi: true,
    refused,
    services
  };
}

/**
 * Why another App Service can't be added as asked, or "": the service row's own refusal, a name the Deployment
 * grammar refuses or already has, or a reaching service it doesn't have.
 * @param {{ refused: string, services: Array<{ id: string }> }} choice the `service` row of the session's choices
 * @param {{ serviceId: string, reachedBy?: string }} request
 */
function serviceRefusal(choice, { serviceId, reachedBy }) {
  if (choice.refused) return choice.refused;
  if (!DEPLOYMENT_SERVICE_ID.test(serviceId)) {
    return "A service name is lowercase letters, digits and dashes, starting with a letter, up to 16 characters.";
  }
  const ids = choice.services.map(({ id }) => id);
  if (ids.includes(serviceId)) return `This Deployment already has a service named ${serviceId}.`;
  if (reachedBy && !ids.includes(reachedBy)) {
    return `This Deployment has no service ${reachedBy} to reach ${serviceId}: its services are ${ids.join(", ")}.`;
  }
  return "";
}

/**
 * Add a service: what a session's Stack can add (a database, Redis, a bucket or another App Service) and adding it,
 * through Genesis's own `stack add` with the catalogue piece the Stack's components call for. The AI task `add-service`
 * then connects the app to it, or declares it where the catalogue has no piece.
 * @param {object} dependencies
 * @param {ProjectSelection} dependencies.selection
 * @param {ProjectSessionWork} dependencies.sessionWork
 * @param {ProjectResourceEnvironment} dependencies.resourceEnvironmentProvider
 * @param {typeof addGenesisStack} [dependencies.addStack]
 * @param {typeof inspectGenesisEnvironment} [dependencies.inspectEnvironment]
 * @param {typeof inspectVibe64Deployment} [dependencies.inspectDeployment]
 * @param {typeof listGenesisStackPieces} [dependencies.listStackPieces]
 */
function createStackServices({
  selection,
  sessionWork,
  resourceEnvironmentProvider,
  addStack = addGenesisStack,
  inspectEnvironment = inspectGenesisEnvironment,
  inspectDeployment = inspectVibe64Deployment,
  listStackPieces = listGenesisStackPieces
}) {
  async function choicesFor(projectRoot) {
    // Only the declarations are read: the values stay the Env's.
    const [environment, pieces, deployment] = await Promise.all([
      inspectEnvironment({ projectRoot, environment: {} }),
      listStackPieces({ projectRoot }),
      inspectDeployment({ projectRoot, environment: {} }).catch((error) => ({ error }))
    ]);
    const stack = {
      declared: (environment.resources || []).filter(({ resource }) => resource && typeof resource === "object"),
      pieces,
      selected: new Set(environment.components || [])
    };
    return {
      stackHash: environment.stackHash,
      choices: [...STACK_SERVICE_KINDS.map((kind) => resourceChoice(kind, stack)), serviceChoice(deployment)]
    };
  }

  async function sessionSourceRoot(sessionId) {
    const source = await selection.sourceForInput({ sessionId });
    if (!source.sourceRoot) throw vibe64Error("This session has no available source.", "vibe64_stack_service_source_required");
    return source.sourceRoot;
  }

  /** @param {{ sessionId: string }} input */
  async function serviceChoices(input) {
    const sessionId = toText(input.sessionId);
    const { stackHash, choices } = await choicesFor(await sessionSourceRoot(sessionId));
    return { ok: true, sessionId, stackHash, managed: managesProjectResources(resourceEnvironmentProvider), choices };
  }

  /** The session's own work that writes its source: its agent's turn, an AI task or Workspace setup. */
  async function refuseWhileSessionWorks(sessionId) {
    const store = selection.sessionStore();
    const session = await store.readSession(sessionId);
    if (session.status !== "active") {
      throw vibe64Error("Open the session first: Add writes its genesis/stack.md.", "vibe64_stack_service_session_closed", { status: 409 });
    }
    if (session.agentRuns.some((run) => run.active)) {
      throw vibe64Error("The session's AI is working. Wait for its turn to finish first.", "vibe64_stack_service_session_busy", { status: 409 });
    }
    const task = (await store.listSessionConversations(sessionId)).find((conversation) => conversation?.task?.active);
    if (task) {
      throw vibe64Error(`${task.task.title} is still running. Wait for it to finish first.`, "vibe64_ai_task_active", { status: 409 });
    }
    if (session.workspaceSetup?.status === "running") {
      throw vibe64Error("Workspace setup is running. Wait for it to finish first.", "vibe64_workspace_setup_running");
    }
  }

  /**
   * @param {{ sessionId: string, kind: string, serviceId?: string, reachedBy?: string }} input
   */
  async function addService(input) {
    const sessionId = toText(input.sessionId);
    const kind = toText(input.kind);
    if (!STACK_SERVICE_KINDS.includes(kind) && kind !== ANOTHER_SERVICE) {
      const offered = [...STACK_SERVICE_KINDS, ANOTHER_SERVICE].join(", ");
      throw vibe64Error(`Add a service offers ${offered}; not ${kind || "nothing"}.`, "vibe64_stack_service_kind_unknown", { status: 400 });
    }
    // An unknown session is refused before its lock is taken.
    await selection.sessionStore().readSession(sessionId);
    return sessionWork.runSessionSourceWorkExclusive({ sessionId }, async () => {
      await refuseWhileSessionWorks(sessionId);
      const projectRoot = await sessionSourceRoot(sessionId);
      return runProjectSourceExclusive(selection.selectedProjectRuntimeRoot(), async () => {
        const { choices } = await choicesFor(projectRoot);
        const choice = choices.find((entry) => entry.kind === kind);
        if (kind === ANOTHER_SERVICE) {
          const serviceId = toText(input.serviceId);
          const reachedBy = toText(input.reachedBy);
          const refused = serviceRefusal(choice, { serviceId, reachedBy });
          if (refused) throw vibe64Error(refused, "vibe64_stack_service_refused", { status: 409 });
          const taskInput = { kind, serviceId, exposure: "internal", ...(reachedBy ? { reachedBy } : {}) };
          return { ok: true, added: null, needsAi: true, aiTask: { kind: "add-service", input: taskInput } };
        }
        if (choice.refused) throw vibe64Error(choice.refused, "vibe64_stack_service_refused", { status: 409 });
        const aiTask = { kind: "add-service", input: { kind, resourceId: choice.resourceId } };
        if (!choice.piece) return { ok: true, added: null, needsAi: true, aiTask };
        const result = await addStack({ projectRoot, pieces: [choice.piece] }).catch((error) => {
          // Genesis's refusal names its fix: an id the project declares with another kind.
          if (error?.code === "STACK_RESOURCE_CONFLICT") throw vibe64Error(error.message, "vibe64_stack_service_refused", { status: 409 });
          throw error;
        });
        const added = (result.addedResources || []).find((entry) => entry.kind === kind);
        // A piece already selected without its resource adds nothing: the AI declares it.
        if (!added) return { ok: true, added: null, needsAi: true, aiTask, changedFiles: result.changedFiles || [] };
        const after = await choicesFor(projectRoot);
        return {
          ok: true,
          added: { component: added.component, id: added.id, kind: added.kind, ...environmentNames(added) },
          needsAi: false,
          aiTask: { kind: "add-service", input: { kind, resourceId: added.id } },
          changedFiles: result.changedFiles || [],
          preparationPrompt: toText(result.prompt),
          stackHash: after.stackHash
        };
      }, { operation: "add-stack-service" });
    }, "add-stack-service", { waitMs: 10_000 });
  }

  return Object.freeze({
    addService,
    serviceChoices
  });
}

export { STACK_SERVICE_KINDS, createStackServices, serviceRefusal };
