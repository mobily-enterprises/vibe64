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

function actionContextError(code, message, statusCode = 403) {
  return Object.assign(new Error(message), { code, statusCode });
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

function actionInput(input, projectScoped) {
  const fields = { ...input.schema.getFieldDefinitions() };
  delete fields.vibe64User;
  if (projectScoped) {
    fields.projectSlug = { type: "string", noTrim: false, minLength: 1, required: false };
  }
  return Object.freeze({
    ...input,
    schema: createSchema.createFactory([input.schema])(fields)
  });
}

// HTTP and automation use the same operation. Transport input never supplies
// the acting user; project selection is resolved before entering the service.
function withVibe64ActionContext(definition, { projectScoped = true, ownerRequired = false, allowDeleting = false } = {}) {
  const { execute } = definition;
  const forwardsProjectSlug = Object.hasOwn(definition.input.schema.getFieldDefinitions(), "projectSlug");
  return Object.freeze({
    ...definition,
    input: actionInput(definition.input, projectScoped),
    extensions: {
      ...definition.extensions,
      vibe64: { projectScoped, ownerRequired, allowDeleting }
    },
    async execute(input = {}, context = {}, deps) {
      const user = authenticatedVibe64User(context);
      const request = context.requestMeta?.request;
      const localOwner = ownerRequired && projectScoped && !user && !context.vibe64Action && request &&
        getStudioProjectContext().projectCatalogEnabled === false &&
        isLocalStudioRequest(Object.assign(Object.create(request), { vibe64User: null }));
      if (ownerRequired && user?.role !== "owner" && !localOwner) {
        throw actionContextError("vibe64_owner_required", "Only the workspace owner can perform this operation.");
      }
      const operationInput = { ...input };
      delete operationInput.projectSlug;
      delete operationInput.vibe64User;
      const trustedInput = user ? { ...operationInput, vibe64User: user } : operationInput;
      if (!projectScoped) return execute(trustedInput, context, deps);

      const slug = actionProjectSlug(input, context);
      if (forwardsProjectSlug) trustedInput.projectSlug = slug;
      const resolved = context.vibe64Action?.project;
      // Colleague acting for a learner opens only the projects of their mode
      // (Learn: their practice project; Develop: never it), so it can relay
      // the exact reason. A host contributor that resolved the project
      // already applied this through its authorizeProject.
      if (context.colleague && !resolved) await assertLearningModeAllowsProject({ actor: user, slug });
      if (resolved && resolved.slug !== slug) {
        throw actionContextError("vibe64_action_project_mismatch", "The authorized project does not match this operation.");
      }
      const current = currentProjectRequestContext();
      // An action from a person's request stays that person's request (its
      // headers, through the prototype), so practice admission compares the
      // learner; only requestless internal work runs as the marker's learner.
      const project = resolved || (current?.slug === slug ? current : await resolveProjectRequestContext({
        request: Object.assign(request ? Object.create(request) : {}, { params: { slug }, vibe64User: user, allowDeleting })
      }));
      return runWithProjectRequestContext({ ...project, vibe64User: user }, () => execute(trustedInput, context, deps), {
        requestMeta: context.requestMeta
      });
    }
  });
}

// Hosts supply authentication and project access through JSKIT's existing
// context contributor. Both callers are re-authorized for every execution.
function registerVibe64ActionContext(actions, { projectContext, resolveUser, authorizeProject,
  admissionScope = "all", env = {}, logger = null } = {}) {
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
        try { return await operation(); }
        finally { timings[phase] = (timings[phase] || 0) + performance.now() - phaseStarted; }
      };
      try {
        const user = await measure("user", () => resolveUser({ request: context.requestMeta?.request || null, context }));
        if (!user) throw actionContextError("vibe64_auth_required", "Log in to Vibe64.", 401);
        if (scope.ownerRequired && user.role !== "owner") {
          throw actionContextError("vibe64_owner_required", "Only the workspace owner can perform this operation.");
        }
        let project = null;
        if (scope.projectScoped) {
          const slug = actionProjectSlug(input, context);
          await measure("project-access", () => authorizeProject({ slug, user, definition, input, context }));
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
          logOperationalEvent(logger, "warn", { event: "vibe64.conversation.browser_timing",
            phase: "authorization-detail", sessionId: input.sessionId, completed, durationMs, timings },
          "Browser conversation authorization stages.");
        }
      }
    }
  });
}

export { authenticatedVibe64User, registerVibe64ActionContext, withVibe64ActionContext };
