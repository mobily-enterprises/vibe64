import { createSchema } from "@jskit-ai/kernel/shared/validators";
import {
  currentProjectRequestContext,
  resolveProjectRequestContext,
  runWithProjectRequestContext
} from "./projectRequestContext.js";
import { getStudioProjectContext, normalizeProjectSlug } from "./studioProjectContext.js";
import { isLocalStudioRequest } from "./localStudioRequest.js";
import { logOperationalEvent } from "./logging.js";
import { assertLearningModeAllowsProject } from "./learningMode.js";
import { assertTeamAiAllowsProject } from "./teamAiGate.js";
import { AppError } from "@jskit-ai/kernel/server/runtime";

/** @typedef {import("@jskit-ai/kernel/server/types").ActionCatalogue} ActionCatalogue */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionDefinition} ActionDefinition */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionPolicy} ActionPolicy */
/** @typedef {import("@jskit-ai/kernel/server/types").ActionPolicyExecution} ActionPolicyExecution */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeLogger} RuntimeLogger */
/** @typedef {import("./types.js").StudioProjectContext} StudioProjectContext */

function actionContextError(code, message, statusCode = 403) {
  return new AppError(statusCode, message, { code });
}

/**
 * The owner-only refusal keeps vibe64_owner_required, which composing hosts
 * branch on; this sentence has its own messageCode.
 */
function ownerRequiredError() {
  return new AppError(403, "Only the workspace owner can perform this operation.", {
    code: "vibe64_owner_required",
    messageCode: "vibe64_operation_owner_required"
  });
}

/**
 * Whether this person may run an owner-only operation (PROJECT_OWNER_OPERATION,
 * WORKSPACE_OWNER_OPERATION). A host that changes the same things outside an
 * operation applies this same check.
 * @param {object | null} user
 */
function isWorkspaceOwner(user) {
  return user?.role === "owner";
}

function actionProjectSlug(input, context) {
  const routeSlug = context.requestMeta?.request?.params?.slug;
  const requestedSlug = input.projectSlug;
  if (routeSlug && requestedSlug && routeSlug !== requestedSlug) {
    throw actionContextError("vibe64_action_project_mismatch", "The operation must target the project in its URL.");
  }
  return normalizeProjectSlug(routeSlug || requestedSlug || context.projectSlug || currentProjectRequestContext()?.slug);
}

function authenticatedVibe64User(context = {}) {
  if (context.vibe64Action) return context.vibe64Action.user;
  return context.requestMeta?.request?.vibe64User || currentProjectRequestContext()?.vibe64User || null;
}

/**
 * What a Vibe64 operation declares in its definition's `extensions.vibe64`:
 * whether it runs inside one project, whether only the workspace owner may run
 * it, and whether it may enter a project that is being deleted.
 * @typedef {object} Vibe64ActionScope
 * @property {boolean} projectScoped
 * @property {boolean} ownerRequired
 * @property {boolean} allowDeleting
 */

/** A project's operation, open to every member who can open the project. */
const PROJECT_OPERATION = Object.freeze({
  projectScoped: true,
  ownerRequired: false,
  allowDeleting: false
});
/** A project's operation that only the workspace owner may run. */
const PROJECT_OWNER_OPERATION = Object.freeze({
  projectScoped: true,
  ownerRequired: true,
  allowDeleting: false
});
/** An operation of the workspace rather than of one project. */
const WORKSPACE_OPERATION = Object.freeze({
  projectScoped: false,
  ownerRequired: false,
  allowDeleting: false
});
/** An operation of the workspace that only its owner may run. */
const WORKSPACE_OWNER_OPERATION = Object.freeze({
  projectScoped: false,
  ownerRequired: true,
  allowDeleting: false
});

/** The extensions of an action that is never offered to an assistant as a tool. */
const NOT_A_TOOL = Object.freeze({ assistant: Object.freeze({ exclude: true }) });

/** The identity fields only the Vibe64 action context supplies to an operation. */
const CONTEXT_IDENTITY_FIELDS = Object.freeze(["vibe64User"]);

/**
 * The input a Vibe64 operation is registered with: transport never supplies
 * the acting user, and a project's operation may name its project. An action
 * without the Vibe64 scope runs with its input as sent, so it may not declare
 * a field the context would otherwise strip and set.
 * @param {ActionDefinition} definition
 */
function vibe64ActionInput(definition) {
  const scope = definition.extensions?.vibe64;
  if (!scope) {
    // JSKIT registers every action with an input schema.
    const fields = definition.input.schema.getFieldDefinitions();
    const declared = CONTEXT_IDENTITY_FIELDS.filter((field) => Object.hasOwn(fields, field));
    if (declared.length) {
      throw new TypeError(
        `Action ${definition.id} declares ${declared.join(", ")} without extensions.vibe64; only the Vibe64 action context supplies it.`
      );
    }
    return definition.input;
  }
  const fields = { ...definition.input.schema.getFieldDefinitions() };
  delete fields.vibe64User;
  if (scope.projectScoped) {
    fields.projectSlug = { type: "string", noTrim: false, minLength: 1, required: false };
  }
  return Object.freeze({
    ...definition.input,
    schema: createSchema.createFactory([definition.input.schema])(fields)
  });
}

/**
 * Runs a Vibe64 operation. HTTP and automation use the same operation.
 * Transport input never supplies the acting user; project selection is
 * resolved before entering the service.
 * @param {ActionPolicyExecution} execution
 * @param {import("./localStudioRequest.js").LocalStudioRequestCheck} check
 */
async function executeVibe64Action({ definition, input, context, run }, { localhostCheckBypassed }) {
  const scope = definition.extensions.vibe64;
  if (!scope) return run(input, context);
  const { projectScoped, ownerRequired, allowDeleting } = scope;
  const user = authenticatedVibe64User(context);
  const request = context.requestMeta?.request;
  const localOwner = ownerRequired && projectScoped && !user && !context.vibe64Action && request &&
    getStudioProjectContext().projectCatalogEnabled === false &&
    isLocalStudioRequest(Object.assign(Object.create(request), { vibe64User: null }), { localhostCheckBypassed });
  if (ownerRequired && !isWorkspaceOwner(user) && !localOwner) {
    throw ownerRequiredError();
  }
  const operationInput = { ...input };
  delete operationInput.projectSlug;
  delete operationInput.vibe64User;
  const trustedInput = user ? { ...operationInput, vibe64User: user } : operationInput;
  if (!projectScoped) return run(trustedInput, context);

  const slug = actionProjectSlug(input, context);
  if (Object.hasOwn(definition.input.schema.getFieldDefinitions(), "projectSlug")) trustedInput.projectSlug = slug;
  const resolved = context.vibe64Action?.project;
  if (resolved && resolved.slug !== slug) {
    throw actionContextError("vibe64_action_authorized_project_mismatch", "The authorized project does not match this operation.");
  }
  // An action from a person's request stays that person's request (its
  // headers, through the prototype), so practice admission compares the
  // learner; only requestless internal work runs as the marker's learner.
  const projectRequest = Object.assign(request ? Object.create(request) : {}, { params: { slug }, vibe64User: user, allowDeleting });
  // Colleague opens only the projects of its turn's thread (Learn: the
  // practice project; Develop: never it), checked before resolving so it
  // can relay the exact reason. The request keeps that thread's mode for
  // the resolution below. A host contributor that resolved the project
  // already applied this through its authorizeProject, and the team AI
  // gate itself.
  if (context.colleague && !resolved) {
    await assertLearningModeAllowsProject({ actor: user, slug, request: projectRequest, thread: context.colleague.thread });
    await assertTeamAiAllowsProject({ actor: user });
  }
  const current = currentProjectRequestContext();
  const project = resolved || (current?.slug === slug ? current
    : await resolveProjectRequestContext({ request: projectRequest }));
  return runWithProjectRequestContext({ ...project, vibe64User: user }, () => run(trustedInput, context), {
    requestMeta: context.requestMeta
  });
}

/**
 * The one rule every Vibe64 operation runs under, supplied to JSKIT as the
 * `runtime.actions.policy` capability. Actions without `extensions.vibe64`
 * are registered and run as declared.
 * @param {import("./localStudioRequest.js").LocalStudioRequestCheck} check
 * @returns {ActionPolicy}
 */
function createVibe64ActionPolicy({ localhostCheckBypassed }) {
  /** @param {ActionPolicyExecution} execution */
  function execute(execution) {
    return executeVibe64Action(execution, { localhostCheckBypassed });
  }

  return Object.freeze({
    input: vibe64ActionInput,
    execute
  });
}

/**
 * Hosts supply authentication and project access through JSKIT's existing
 * context contributor. Both callers are re-authorized for every execution.
 * @param {ActionCatalogue} actions
 * @param {object} options
 * @param {StudioProjectContext} [options.projectContext]
 * @param {(request: { request: any, context: object }) => Promise<object | null> | object | null} options.resolveUser
 * @param {(request: object) => Promise<unknown> | unknown} options.authorizeProject
 * @param {"all" | "learning-only"} [options.admissionScope]
 * @param {RuntimeEnv} [options.env]
 * @param {RuntimeLogger} options.logger
 */
function registerVibe64ActionContext(actions, {
  projectContext,
  resolveUser,
  authorizeProject,
  admissionScope = "all",
  env = {},
  logger
} = {}) {
  if (!["all", "learning-only"].includes(admissionScope)) {
    throw new TypeError("Vibe64 action context admissionScope must be all or learning-only.");
  }
  if (typeof resolveUser !== "function" || typeof authorizeProject !== "function") {
    throw new TypeError("Vibe64 action context requires resolveUser() and authorizeProject().");
  }
  return actions.registerContextContributor({
    id: "vibe64.operation-context",
    async contribute({ definition, input, context }) {
      const scope = definition.extensions?.vibe64;
      if (!scope) return {};
      if (admissionScope === "learning-only" && !(scope.projectScoped === false && definition.id.startsWith("vibe64.training."))) {
        return {};
      }
      if (Object.hasOwn(context, "vibe64Action")) {
        throw actionContextError("vibe64_action_context_reserved", "Operation authority is resolved by the host.");
      }
      const diagnostic = definition.id === "vibe64.sessions.conversation.context.read" &&
        ["1", "true", "yes", "on"].includes(String(env.JSKIT_REALTIME_DEBUG || "").trim().toLowerCase());
      const started = diagnostic ? performance.now() : 0;
      const timings = {};
      let completed = false;
      const measure = async (phase, operation) => {
        if (!diagnostic) return operation();
        const phaseStarted = performance.now();
        try {
          return await operation();
        } finally {
          timings[phase] = (timings[phase] || 0) + performance.now() - phaseStarted;
        }
      };
      try {
        const user = await measure("user", () => resolveUser({ request: context.requestMeta?.request || null, context }));
        if (!user) throw actionContextError("vibe64_auth_required", "Log in to Vibe64.", 401);
        if (scope.ownerRequired && !isWorkspaceOwner(user)) {
          throw ownerRequiredError();
        }
        let project = null;
        if (scope.projectScoped) {
          const slug = actionProjectSlug(input, context);
          await measure("project-access", async () => {
            await authorizeProject({ slug, user, definition, input, context });
            // A person's own request or Colleague opens a project only once
            // team AI allows it; the project is resolved below without headers.
            if (context.requestMeta?.request?.headers || context.colleague) await assertTeamAiAllowsProject({ actor: user });
          });
          project = await measure("project-context", () => resolveProjectRequestContext({
            projectContext,
            request: { params: { slug }, vibe64User: user, allowDeleting: scope.allowDeleting === true }
          }));
        }
        completed = true;
        return {
          actor: { id: String(user.uid ?? user.username) },
          vibe64Action: Object.freeze({ user, project })
        };
      } finally {
        const durationMs = diagnostic ? performance.now() - started : 0;
        if (diagnostic && (!completed || durationMs >= 100)) {
          logOperationalEvent(
            logger,
            "warn",
            {
              event: "vibe64.conversation.browser_timing",
              phase: "authorization-detail",
              sessionId: input.sessionId,
              completed,
              durationMs,
              timings
            },
            "Browser conversation authorization stages."
          );
        }
      }
    }
  });
}

export {
  authenticatedVibe64User,
  CONTEXT_IDENTITY_FIELDS,
  NOT_A_TOOL,
  PROJECT_OPERATION,
  PROJECT_OWNER_OPERATION,
  createVibe64ActionPolicy,
  isWorkspaceOwner,
  registerVibe64ActionContext,
  WORKSPACE_OPERATION,
  WORKSPACE_OWNER_OPERATION
};
