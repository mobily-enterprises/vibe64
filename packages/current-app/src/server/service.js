import { vibe64Error } from "@local/vibe64-core/server/core";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  projectServiceSourceRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  inspectVibe64Outputs
} from "@local/vibe64-genesis/server";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";

/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeEnv} RuntimeEnv */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */

const EXPECTED_UNCONFIGURED_CODES = new Set([
  "BLUEPRINT_REQUIRED",
  "STACK_REQUIRED"
]);

function currentAppResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_current_app_inspection_failed",
    fallbackMessage: "The current app could not be inspected."
  });
}

function unconfiguredCurrentApp(root, message) {
  return {
    components: [],
    diagnostics: [],
    message: message || "Vibe64 does not declare an output target for this project yet.",
    ok: true,
    ready: false,
    resources: [],
    root,
    runtimeRequirements: [],
    stackHash: "",
    status: "unconfigured",
    targets: []
  };
}

function outputsView(root, outputs) {
  return {
    components: Array.isArray(outputs.components) ? outputs.components : [],
    diagnostics: Array.isArray(outputs.diagnostics) ? outputs.diagnostics : [],
    ok: true,
    ready: outputs.status === "ready",
    resources: Array.isArray(outputs.resources) ? outputs.resources : [],
    root,
    runtimeRequirements: Array.isArray(outputs.runtimeRequirements) ? outputs.runtimeRequirements : [],
    stackHash: String(outputs.stackHash || ""),
    status: String(outputs.status || "unconfigured"),
    targets: Array.isArray(outputs.targets) ? outputs.targets : []
  };
}

/**
 * @param {object} dependencies
 * @param {RuntimeEnv} dependencies.env the base environment the outputs inspection runs in
 * @param {typeof inspectVibe64Outputs} [dependencies.inspectOutputs]
 * @param {ProjectService} dependencies.project
 */
function createService({
  env,
  inspectOutputs = inspectVibe64Outputs,
  project
}) {
  async function rootForInput(input) {
    const sessionId = normalizeText(input.sessionId);
    if (!sessionId) {
      return projectServiceSourceRoot(project);
    }
    const runtime = await project.createRuntimeWithoutSource();
    const session = await runtime.getSessionWithoutSource(sessionId);
    const root = sessionSourcePath(session);
    if (!root) {
      const error = vibe64Error("The selected session does not have a source directory.", "vibe64_session_source_required", {
        messageCode: "vibe64_current_app_session_source_required"
      });
      error.sessionId = sessionId;
      throw error;
    }
    return root;
  }

  async function projectEnvironment(input) {
    const userEnvironment = await project.projectInspectionEnvironment({
      scope: "dev",
      sessionId: input.sessionId
    });
    return {
      ...env,
      ...userEnvironment
    };
  }

  /**
   * A host that supplies resources (a managed database) may not have prepared
   * them yet; Preview then says Vibe64 is on it rather than asking for values.
   */
  async function resourcesBeingPrepared(input) {
    try {
      return (await project.projectEnvironmentStatus({ scope: "dev", sessionId: input.sessionId })).status === "not-prepared";
    } catch {
      return false;
    }
  }

  async function inspectCurrentApp(input) {
    return currentAppResult(async () => {
      const root = await rootForInput(input);
      if (!root) {
        return unconfiguredCurrentApp("", "Choose a project source or session before inspecting Vibe64 outputs.");
      }
      try {
        const [environment, resourcesPreparing] = await Promise.all([projectEnvironment(input), resourcesBeingPrepared(input)]);
        return outputsView(root, await inspectOutputs({ environment, projectRoot: root, resourcesPreparing }));
      } catch (error) {
        if (!EXPECTED_UNCONFIGURED_CODES.has(String(error?.code || ""))) {
          throw error;
        }
        return unconfiguredCurrentApp(root, String(error?.message || ""));
      }
    });
  }

  return Object.freeze({ inspectCurrentApp });
}

export {
  createService
};
