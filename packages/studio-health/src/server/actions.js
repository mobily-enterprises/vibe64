import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { withVibe64ActionContext } from "@local/vibe64-core/server/actionContext";
import { studioHealthQueryInputValidator, studioToolsQueryInputValidator } from "./inputSchemas.js";

const ACTION_READ_STUDIO_HEALTH = "vibe64.studio-health.read";
const ACTION_CHECK_STUDIO_TOOLS = "vibe64.studio-health.tools";

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
      description: "Read this installation's Health checks: workspace services, AI and GitHub sign-in, and the tools Vibe64 uses (Node.js, Git, an AI tool, GitHub CLI, ripgrep, Genesis, Playwright). Each check says pass, warn or fail, whether it is needed or optional, what was expected and what was found. On the person's own computer only Node.js, Git, Genesis and one AI tool are needed; GitHub CLI, ripgrep, the other AI tools and Playwright are optional extras and never block work. Use it to tell the person which setup step is missing and the one command that installs it; it changes nothing and repairs nothing. Never run installers with sudo for the person. Dashboard → Health shows the same checks.",
      output: { mode: "replace", schema: createSchema({
        ok: { type: "boolean", required: true },
        healthy: { type: "boolean", required: false },
        error: { type: "string", required: false, maxLength: 512 },
        checks: { type: "array", required: false, maxItems: 40, items: createSchema({
          id: { type: "string", required: true, maxLength: 80 },
          label: { type: "string", required: true, maxLength: 120 },
          group: { type: "string", required: false, maxLength: 80 },
          status: { type: "string", required: true, maxLength: 20 },
          need: { type: "string", required: false, maxLength: 20 },
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
          need: String(check.need || "needed").slice(0, 20),
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
  }, { projectScoped: false }), withVibe64ActionContext({
    id: ACTION_CHECK_STUDIO_TOOLS,
    version: 1,
    kind: "query",
    input: studioToolsQueryInputValidator,
    output: null,
    extensions: { assistant: {
      description: "Check now whether named tools run on the person's own computer, for example ids \"ruby,cpp\" (Stack runtime ids such as python, ruby, java, php, go, rust, cpp, or node, git, gh, ripgrep, claude, codex, opencode). A tool counts only when it starts and reports its version through the same PATH projects use. Each result says ready, missing or broken, the version and folder found, and for a missing tool the one install command for this computer with any password note. Use it when the person asks whether something is installed, or after they ran an install command, instead of guessing. It only reads: never run the install command for them, and never use sudo. A host that supplies its own tools answers managed with no rows."
    } },
    idempotency: "none",
    audit: { actionName: ACTION_CHECK_STUDIO_TOOLS },
    observability: {},
    execute(input) {
      return studioHealth.checkTools(input);
    }
  }, { projectScoped: false })]);
}

export {
  ACTION_CHECK_STUDIO_TOOLS,
  ACTION_READ_STUDIO_HEALTH,
  createActions
};
