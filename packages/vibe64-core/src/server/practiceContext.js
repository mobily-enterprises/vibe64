import { AsyncLocalStorage } from "node:async_hooks";

// The request-scoped project context and its private practice grant. This is
// the lowest layer of project access: the Studio project context and the
// project request context both build on it, and it imports neither.
const projectContextStorage = new AsyncLocalStorage();
const practiceScopeKey = Symbol("Vibe64 server practice scope");
const actionRequestMetaKey = Symbol("Vibe64 original action request metadata");

function currentProjectRequestContext() {
  const context = projectContextStorage.getStore() || null;
  if (context?.[practiceScopeKey] && !context[practiceScopeKey].active()) {
    throw Object.assign(new Error("Practice access ended with its owning callback. Read the saved lesson again."), { code: "vibe64_practice_scope_expired" });
  }
  return context;
}

function currentPracticeProjectScope(owner) {
  const grant = currentProjectRequestContext()?.[practiceScopeKey];
  if (!grant) return null;
  if (grant.owner !== owner) {
    throw Object.assign(new Error("Practice access belongs to its original Project context."), { code: "vibe64_practice_context_mismatch" });
  }
  return grant.scope;
}

// Core calls this with its exact derived scope. The private token survives only
// inside the original ALS callback; ordinary request/context fields cannot grant it.
async function runWithPracticeProjectContext(owner, scope, operation) {
  if (typeof operation !== "function") throw new TypeError("Practice access requires an owning callback.");
  let active = true;
  const context = Object.freeze({ ...scope,
    [practiceScopeKey]: Object.freeze({ owner, scope, active: () => active })
  });
  try {
    return await projectContextStorage.run(context, () => operation());
  } finally {
    active = false;
  }
}

// Existing accepted-work owners retain only this exact observation/control
// projection. Fresh effects must re-enter the saved-attempt request admission.
// A practice project admitted as an ordinary project (admitPracticeRequest)
// keeps its write: that admission depends only on the learner's ownership, not
// on lesson activity, so later work (agent turns, helpers) behaves as in any project.
function captureProjectRequestContext() {
  const grant = currentProjectRequestContext()?.[practiceScopeKey];
  return retainPracticeContext(grant?.ordinary === true ? "write" : "control");
}

// The retained projection outlives the owning callback. Only core's practice
// admission retains write; every other caller retains control.
function retainPracticeContext(access) {
  const context = currentProjectRequestContext();
  const grant = context?.[practiceScopeKey];
  if (!grant) return context;
  const scope = Object.freeze({ ...grant.scope, access,
    vibe64User: Object.freeze({ ...grant.scope.vibe64User }) });
  return Object.freeze({ ...scope,
    [practiceScopeKey]: Object.freeze({ owner: grant.owner, scope, active: () => true, ...(access === "write" ? { ordinary: true } : {}) })
  });
}

function assertProjectEffectAdmission() {
  const scope = currentProjectRequestContext()?.[practiceScopeKey]?.scope;
  if (scope && !["create", "write"].includes(scope.access)) {
    throw Object.assign(new Error("Read this saved lesson's current authority before starting new practice work."), {
      code: "vibe64_practice_effect_admission_required", statusCode: 409
    });
  }
}

export {
  actionRequestMetaKey,
  assertProjectEffectAdmission,
  captureProjectRequestContext,
  currentPracticeProjectScope,
  currentProjectRequestContext,
  practiceScopeKey,
  projectContextStorage,
  retainPracticeContext,
  runWithPracticeProjectContext
};
