// Production's needs from the saved commit's genesis/stack.md, and only from it: the Deployment section
// (vibe64.application-deployment.v2) says how the app builds, migrates, serves and its services, and each
// `genesis-resource` of `## Resources` what it needs with the setting names it reads. Nothing is guessed from the app's
// files. A Stack that does not say enough is refused, naming the fix in genesis/stack.md, which the coding agent can
// make.
//
// The engine depends on no editor package: the editor passes the Deployment section as public Vibe64's Genesis boundary
// inspected it, and its own resource rules (the project package's preferredAlternative, which checks a resource's
// bindings for its kind, and resourceKindIsDatabase).
import { buildLeadsOf } from "./builds.js";
import { NEED_KINDS, STACK_FIX, needsProblem } from "./needs.js";

/** A refusal of the Stack, as the page and the deploy show it. */
function problem(code, message) {
  return { code, message };
}

/**
 * The needs, or the first reason the Stack can't give them.
 * @param {any} deployment the Stack's Deployment section as public Vibe64 inspected it (inspectVibe64Deployment), or
 *   null when the Stack has no usable one. One the grammar refused is `{ status: "blocked", diagnostics: [{ code,
 *   message, line }] }`, `line` being the refusal's line in the section (the error's `details.line`), which the problem
 *   carries.
 * @param {object} resourceRules the editor's resource rules
 * @param {(resource: object) => { bindings: Record<string, string>, allowEmpty?: string[] }} resourceRules.preferredAlternative
 *   a declared resource's one preferred alternative, its bindings checked for its kind; throws naming what is wrong
 * @param {(kind: string) => boolean} resourceRules.resourceKindIsDatabase
 * @returns {{ needs: object | null, problem: { code: string, message: string } | null }}
 */
function needsOfStack(deployment, { preferredAlternative, resourceKindIsDatabase }) {
  if (!deployment || deployment.status === "unconfigured") {
    return {
      needs: null,
      problem: problem("production_deployment_missing", "genesis/stack.md has no Deployment section, which says how "
        + `Production builds, migrates and serves the app. ${STACK_FIX}`)
    };
  }
  if (deployment.status !== "ready") {
    const why = deployment.diagnostics?.[0]?.message || "it isn't valid";
    const line = deployment.diagnostics?.[0]?.line;
    return {
      needs: null,
      problem: {
        ...problem("production_deployment_invalid", `genesis/stack.md's Deployment section can't be used${Number.isInteger(line)
          ? ` (line ${line} of the section)` : ""}: ${why} Fix it in genesis/stack.md (the coding agent can do this), Save, then deploy to production.`),
        ...(Number.isInteger(line) ? { line } : {})
      }
    };
  }
  const resources = [];
  const supplied = [];
  for (const declared of Array.isArray(deployment.resources) ? deployment.resources : []) {
    const resource = declared?.resource ?? {};
    const id = String(resource.id || "");
    const kind = String(resource.kind || "");
    let alternative;
    try {
      alternative = preferredAlternative(resource);
    } catch (error) {
      return { needs: null, problem: problem("production_resource_invalid", `genesis/stack.md's resource ${id || "(no id)"} can't be used: ${error.message} ${STACK_FIX}`) };
    }
    const bindings = { ...alternative.bindings };
    if (Object.hasOwn(NEED_KINDS, kind)) {
      resources.push({ id, kind, bindings });
    } else if (resourceKindIsDatabase(kind)) {
      return {
        needs: null,
        problem: problem("production_resource_unsupported", `genesis/stack.md declares ${id} as a ${kind} database, which `
          + "Production can't share between its instances. Declare it as a mysql or postgresql resource in genesis/stack.md "
          + "(the coding agent can do this), Save, then deploy to production.")
      };
    } else {
      // A resource Production does not make (an API account of the person's own, for example): its settings come
      // from the Production Env, as the person enters them.
      const allowEmpty = (alternative.allowEmpty ?? []).map((semantic) => bindings[semantic]).filter(Boolean);
      supplied.push({ id, kind, settings: Object.values(bindings), allowEmpty });
    }
  }
  const declared = Array.isArray(deployment.services) ? deployment.services : [];
  // The service whose build each shares (builds.js): services the provider would release alike are built once.
  const leads = buildLeadsOf(declared);
  const needs = {
    services: declared.map((service) => ({
      id: service.id,
      exposure: service.exposure,
      reached: service.reached,
      instances: { min: service.instances?.min, max: service.instances?.max, start: service.instances?.production },
      atLeast: service.atLeast ?? null,
      reaches: (service.reaches ?? []).map((reach) => ({ service: reach.service, setting: reach.setting })),
      settings: { ...service.settings },
      sandbox: [...(service.sandboxAllowances ?? [])],
      builtWith: leads[service.id]
    })),
    resources,
    supplied,
    generatedSecrets: [...(deployment.generatedSecrets ?? [])],
    setupCode: String(deployment.setupCode || "")
  };
  const wrong = needsProblem(needs);
  if (wrong) {
    return { needs: null, problem: problem("production_needs_invalid", `genesis/stack.md's Deployment and resources can't be used: ${wrong} ${STACK_FIX}`) };
  }
  return { needs, problem: null };
}

export { needsOfStack };
