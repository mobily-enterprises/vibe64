import { createSchema } from "@jskit-ai/kernel/shared/validators";
import {
  currentProjectRequestContext,
  resolveProjectRequestContext,
  runWithProjectRequestContext
} from "./projectRequestContext.js";
import { getStudioProjectContext, normalizeProjectSlug } from "./studioProjectContext.js";
import { isLocalStudioRequest } from "./localStudioRequest.js";
import { logOperationalEvent } from "./logging.js";

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

function actionLearningAttemptId(input, context) {
  const routeAttempt = context.requestMeta?.request?.params?.learningAttemptId;
  const requestedAttempt = input.learningAttemptId;
  if (routeAttempt && requestedAttempt && routeAttempt !== requestedAttempt) {
    throw actionContextError("vibe64_learning_attempt_mismatch", "The operation must target the learning attempt in its URL.");
  }
  const attemptId = routeAttempt || requestedAttempt;
  if (attemptId && (typeof attemptId !== "string" ||
      !/^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/u.test(attemptId))) {
    throw actionContextError("vibe64_learning_attempt_invalid", "Use the exact saved learning attempt identity.", 400);
  }
  // Colleague's context project is the page the person is viewing, not a
  // selection; an explicit route or input project still conflicts.
  if (attemptId && (context.requestMeta?.request?.params?.slug || input.projectSlug || context.projectSlug && !context.colleague)) {
    throw actionContextError("vibe64_learning_project_mismatch", "A learning operation cannot also select a working project.");
  }
  return attemptId;
}

function authenticatedVibe64User(context = {}) {
  if (context.vibe64Action) return context.vibe64Action.user;
  return context.requestMeta?.request?.vibe64User || currentProjectRequestContext()?.vibe64User || null;
}

function actionInput(input, projectScoped, learningAccess) {
  const fields = { ...input.schema.getFieldDefinitions() };
  delete fields.vibe64User;
  if (projectScoped) {
    fields.projectSlug = { type: "string", noTrim: false, minLength: 1, required: false };
  }
  if (learningAccess) {
    fields.learningAttemptId = { type: "string", required: false, noTrim: true,
      pattern: "^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$" };
  }
  return Object.freeze({
    ...input,
    schema: createSchema.createFactory([input.schema])(fields)
  });
}

// HTTP and automation use the same operation. Transport input never supplies
// the acting user; project selection is resolved before entering the service.
function withVibe64ActionContext(definition, { projectScoped = true, ownerRequired = false, allowDeleting = false, learningAccess = false } = {}) {
  if (learningAccess && !["observe", "control", "write", "create"].includes(learningAccess)) {
    throw new TypeError("Learning operations require an explicit observation, control, write or creation scope.");
  }
  const { execute } = definition;
  const forwardsProjectSlug = Object.hasOwn(definition.input.schema.getFieldDefinitions(), "projectSlug");
  return Object.freeze({
    ...definition,
    input: actionInput(definition.input, projectScoped, learningAccess),
    extensions: {
      ...definition.extensions,
      vibe64: { projectScoped, ownerRequired, allowDeleting, ...(learningAccess ? { learningAccess } : {}) }
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
      delete operationInput.learningAttemptId;
      const trustedInput = user ? { ...operationInput, vibe64User: user } : operationInput;
      const learningAttemptId = actionLearningAttemptId(input, context);
      if (learningAttemptId) {
        const learning = context.vibe64Action?.learning;
        if (!learningAccess || !learning || learning.learningScope.attemptId !== learningAttemptId) {
          throw actionContextError("vibe64_learning_authority_required", "Authorize this learner’s exact saved attempt before continuing.");
        }
        return runWithProjectRequestContext({ ...learning, vibe64User: user }, () => execute(trustedInput, context, deps));
      }
      if (!projectScoped) return execute(trustedInput, context, deps);

      const slug = actionProjectSlug(input, context);
      if (forwardsProjectSlug) trustedInput.projectSlug = slug;
      const resolved = context.vibe64Action?.project;
      if (resolved && resolved.slug !== slug) {
        throw actionContextError("vibe64_action_project_mismatch", "The authorized project does not match this operation.");
      }
      const current = currentProjectRequestContext();
      const project = resolved || (current?.slug === slug ? current : await resolveProjectRequestContext({
        request: { params: { slug }, vibe64User: user, allowDeleting }
      }));
      return runWithProjectRequestContext({ ...project, vibe64User: user }, () => execute(trustedInput, context, deps), {
        requestMeta: context.requestMeta
      });
    }
  });
}

// Hosts supply authentication and project access through JSKIT's existing
// context contributor. Both callers are re-authorized for every execution.
function registerVibe64ActionContext(actions, { projectContext, resolveUser, authorizeProject, resolveLearningContext,
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
      if (admissionScope === "learning-only" &&
          !(scope.projectScoped === false && definition.id.startsWith("vibe64.training.") ||
            scope.learningAccess && (input.learningAttemptId || context.requestMeta?.request?.params?.learningAttemptId))) {
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
        let learning = null;
        const learningAttemptId = actionLearningAttemptId(input, context);
        if (learningAttemptId) {
          if (!scope.learningAccess || typeof resolveLearningContext !== "function") {
            throw actionContextError("vibe64_learning_unavailable", "This operation cannot access learning sessions.");
          }
          learning = await measure("saved-attempt", () => resolveLearningContext({ actor: user,
            attemptId: learningAttemptId, sessionId: input.sessionId, access: scope.learningAccess,
            ...(diagnostic ? { onContextTiming(phase, durationMs) {
              if (phase === "scope-selection" &&
                  Number.isFinite(durationMs) && durationMs >= 0) {
                const key = `saved-attempt.${phase}`;
                timings[key] = (timings[key] || 0) + durationMs;
              }
            } } : {}) }));
          if (!learning?.learningScope || learning.learningScope.attemptId !== learningAttemptId ||
              learning.learningScope.learnerId !== String(user.uid ?? user.username)) {
            throw actionContextError("vibe64_learning_scope_mismatch", "The authorized learning context does not match this person and attempt.");
          }
          // Only a source-less lesson has a learning context; a practice
          // project's sessions are ordinary project sessions (Learning v2).
          if (learning.learningScope.noExercise !== true || learning.slug || learning.targetRoot || learning.sourceRoot ||
              learning.projectSessionSourceRoot) {
            throw actionContextError("vibe64_learning_scope_mismatch", "The authorized learning context does not match this person and attempt.");
          }
        } else if (scope.projectScoped) {
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
          vibe64Action: Object.freeze({ user, project, ...(learning ? { learning } : {}) })
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
