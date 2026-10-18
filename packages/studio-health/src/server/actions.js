import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { studioHealthQueryInputValidator } from "./inputSchemas.js";

const ACTION_READ_STUDIO_HEALTH = "vibe64.studio-health.read";

function createActions({ studioHealth } = {}) {
  if (!studioHealth || typeof studioHealth.inspect !== "function") {
    throw new TypeError("createActions requires the Studio Health API.");
  }
  return Object.freeze([withVibe64ActionContext({
    id: ACTION_READ_STUDIO_HEALTH,
    version: 1,
    kind: "query",
    input: studioHealthQueryInputValidator,
    output: null,
    extensions: { assistant: {
      description: "Read this installation's Health checks: workspace services, AI and GitHub sign-in, and the local tools Vibe64 uses (Node.js, Git, GitHub CLI, ripgrep, Codex, Genesis, Playwright). Each check reports pass or fail with what was expected and a short observed result. Use it to tell the person which setup step is missing on this machine and how to fix it; it changes nothing and repairs nothing. Dashboard → Health shows the same checks.",
      output: { mode: "replace", schema: createSchema({
        ok: { type: "boolean", required: true },
        healthy: { type: "boolean", required: false },
        error: { type: "string", required: false, maxLength: 512 },
        checks: { type: "array", required: false, maxItems: 40, items: createSchema({
          id: { type: "string", required: true, maxLength: 80 },
          label: { type: "string", required: true, maxLength: 120 },
          group: { type: "string", required: false, maxLength: 80 },
          status: { type: "string", required: true, maxLength: 20 },
          expected: { type: "string", required: false, maxLength: 300 },
          observed: { type: "string", required: false, maxLength: 300 }
        }) }
      }) },
      // Long command output stays on the Health page; the assistant gets a bounded summary.
      transformResult: result => result?.ok === false ? { ok: false, error: String(result.error || "Health checks could not run.").slice(0, 512) } : {
        ok: true, healthy: result.healthy === true,
        checks: (result.checks || []).slice(0, 40).map(check => ({
          id: String(check.id || "").slice(0, 80), label: String(check.label || "").slice(0, 120),
          group: String(check.group || "").slice(0, 80), status: String(check.status || "").slice(0, 20),
          expected: String(check.expected || "").slice(0, 300), observed: String(check.observed || "").slice(0, 300)
        }))
      }
    } },
    idempotency: "none",
    audit: { actionName: ACTION_READ_STUDIO_HEALTH },
    observability: {},
    execute(input) {
      return studioHealth.inspect(input);
    }
  }, { projectScoped: false })]);
}

export {
  ACTION_READ_STUDIO_HEALTH,
  createActions
};
