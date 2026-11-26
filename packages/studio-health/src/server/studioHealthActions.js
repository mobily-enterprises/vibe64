import { createSchema } from "@jskit-ai/kernel/shared/validators";
import { NOT_A_TOOL, WORKSPACE_OPERATION } from "@local/vibe64-core/server/actionContext";
import { VIBE64_COMMAND, VIBE64_QUERY } from "@local/vibe64-core/shared/actionFields";
import { plannedRestart } from "@local/vibe64-core/server/plannedRestart";
import { readServedClientBuildId } from "@jskit-ai/kernel/server/support";

import {
  crashesAcknowledgeInputValidator,
  studioHealthQueryInputValidator,
  studioToolsQueryInputValidator
} from "./inputSchemas.js";

/** @typedef {import("./types.js").StudioHealthService} StudioHealthService */
/** @typedef {ReturnType<typeof import("./crashes.js").createCrashService>} CrashService */

const ACTION_READ_STUDIO_HEALTH = "vibe64.studio-health.read";
const ACTION_CHECK_STUDIO_TOOLS = "vibe64.studio-health.tools";
const ACTION_READ_CRASH_SUMMARY = "vibe64.studio-health.crashes.summary";
const ACTION_LIST_CRASHES = "vibe64.studio-health.crashes.list";
const ACTION_ACKNOWLEDGE_CRASHES = "vibe64.studio-health.crashes.acknowledge";
const ACTION_READ_PLANNED_RESTART = "vibe64.studio-health.planned-restart.read";

// The bounded Health summary the assistant receives.
const HEALTH_SUMMARY_OUTPUT = {
  mode: "replace",
  schema: createSchema({
    ok: { type: "boolean", required: true },
    healthy: { type: "boolean", required: false },
    error: { type: "string", required: false, maxLength: 512 },
    checks: {
      type: "array",
      required: false,
      maxItems: 40,
      items: createSchema({
        id: { type: "string", required: true, maxLength: 80 },
        label: { type: "string", required: true, maxLength: 120 },
        group: { type: "string", required: false, maxLength: 80 },
        status: { type: "string", required: true, maxLength: 20 },
        need: { type: "string", required: false, maxLength: 20 },
        expected: { type: "string", required: false, maxLength: 300 },
        observed: { type: "string", required: false, maxLength: 300 }
      })
    }
  })
};

/**
 * Long command output stays on the Health page; the assistant gets a bounded summary.
 */
function healthSummaryForAssistant(result) {
  if (result?.ok === false) {
    return {
      ok: false,
      error: String(result.error || "Health checks could not run.").slice(0, 512)
    };
  }
  return {
    ok: true,
    healthy: result.healthy === true,
    checks: (result.checks || []).slice(0, 40).map((check) => ({
      id: String(check.id || "").slice(0, 80),
      label: String(check.label || "").slice(0, 120),
      group: String(check.group || "").slice(0, 80),
      status: String(check.status || "").slice(0, 20),
      need: String(check.need || "needed").slice(0, 20),
      expected: String(check.expected || "").slice(0, 300),
      observed: String(check.observed || "").slice(0, 300)
    }))
  };
}

/**
 * @param {object} dependencies
 * @param {StudioHealthService} dependencies.studioHealth
 * @param {CrashService} dependencies.crashes
 */
/**
 * The planned restart's state for the banner, with the client build this server serves now: after a restart the page
 * offers Reload only when that build is not the one it runs.
 * @param {string} appRoot
 */
async function plannedRestartStatus(appRoot) {
  const clientBuildId = await readServedClientBuildId({ appRoot }).catch(() => "");
  return { ok: true, ...plannedRestart().status(), clientBuildId };
}

function createStudioHealthActions({ studioHealth, crashes, appRoot }) {
  return Object.freeze([
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_STUDIO_HEALTH,
      input: studioHealthQueryInputValidator,
      extensions: {
        assistant: {
          description: "Read this installation's Health checks: workspace services, AI and GitHub sign-in, and the tools Vibe64 uses (Node.js, Git, an AI tool, GitHub CLI, ripgrep, Genesis, Playwright). Each check says pass, warn or fail, whether it is needed or optional, what was expected and what was found. On the person's own computer only Node.js, Git, Genesis and one AI tool are needed; GitHub CLI, ripgrep, the other AI tools and Playwright are optional extras and never block work. Use it to tell the person which setup step is missing and the one command that installs it; it changes nothing and repairs nothing. Never run installers with sudo for the person. Dashboard → Health shows the same checks.",
          output: HEALTH_SUMMARY_OUTPUT,
          transformResult: healthSummaryForAssistant
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input) => studioHealth.inspect(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_CHECK_STUDIO_TOOLS,
      input: studioToolsQueryInputValidator,
      extensions: {
        assistant: {
          description: "Check now whether named tools run on the person's own computer, for example ids \"ruby,cpp\" (Stack runtime ids such as python, ruby, java, php, go, rust, cpp, or node, git, gh, ripgrep, claude, codex, opencode). A tool counts only when it starts and reports its version through the same PATH projects use. Each result says ready, missing or broken, the version and folder found, and for a missing tool the one install command for this computer with any password note. Use it when the person asks whether something is installed, or after they ran an install command, instead of guessing. It only reads: never run the install command for them, and never use sudo. A host that supplies its own tools answers managed with no rows."
        },
        vibe64: WORKSPACE_OPERATION
      },
      execute: (input) => studioHealth.checkTools(input)
    }),
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_CRASH_SUMMARY,
      input: studioHealthQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => crashes.summary(input)
    }),
    // The host's planned restart, for every editor's banner: the notice in force, and for a while after the restart
    // what it stopped.
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_READ_PLANNED_RESTART,
      input: studioHealthQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: () => plannedRestartStatus(appRoot)
    }),
    // Crash records stay off the assistant's tools: an error's message and stack may hold what no AI should read.
    Object.freeze({
      ...VIBE64_QUERY,
      id: ACTION_LIST_CRASHES,
      input: studioHealthQueryInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => crashes.list(input)
    }),
    Object.freeze({
      ...VIBE64_COMMAND,
      id: ACTION_ACKNOWLEDGE_CRASHES,
      input: crashesAcknowledgeInputValidator,
      extensions: { ...NOT_A_TOOL, vibe64: WORKSPACE_OPERATION },
      execute: (input) => crashes.acknowledge(input)
    })
  ]);
}

export {
  ACTION_ACKNOWLEDGE_CRASHES,
  ACTION_CHECK_STUDIO_TOOLS,
  ACTION_LIST_CRASHES,
  ACTION_READ_CRASH_SUMMARY,
  ACTION_READ_PLANNED_RESTART,
  ACTION_READ_STUDIO_HEALTH,
  createStudioHealthActions
};
