import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  resolveStudioTargetRoot
} from "@local/vibe64-core/server/studioRoots";
import {
  projectServiceSourceRoot
} from "@local/vibe64-core/server/projectServiceSelection";
import {
  inspectVibe64Outputs
} from "@local/vibe64-genesis/server";

const EXPECTED_UNCONFIGURED_CODES = new Set([
  "BLUEPRINT_REQUIRED",
  "STACK_REQUIRED"
]);

function resolveCurrentAppRoot(appRoot) {
  return resolveStudioTargetRoot({
    explicitRoot: appRoot
  });
}

function currentAppResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_current_app_inspection_failed",
    fallbackMessage: "The current app could not be inspected."
  });
}

function unconfiguredCurrentApp(root = "", message = "") {
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

function outputsView(root = "", outputs = {}) {
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

function createService({
  appRoot = "",
  env = process.env,
  inspectOutputs = inspectVibe64Outputs,
  projectService
} = {}) {
  if (
    !projectService ||
    typeof projectService.createRuntime !== "function" ||
    typeof projectService.projectInspectionEnvironment !== "function"
  ) {
    throw new TypeError("createService requires the Vibe64 Project API.");
  }

  function selectedProjectRoot() {
    if (String(appRoot || "").trim()) {
      return resolveCurrentAppRoot(appRoot);
    }
    return projectServiceSourceRoot(projectService);
  }

  async function rootForInput(input = {}) {
    const sessionId = String(input.sessionId || "").trim();
    if (!sessionId) {
      return selectedProjectRoot();
    }
    const runtime = await projectService.createRuntime({
      inspectSource: false
    });
    const session = await runtime.getSession(sessionId, {
      inspectSource: false
    });
    const root = sessionSourcePath(session);
    if (!root) {
      const error = new Error("The selected session does not have a source directory.");
      error.code = "vibe64_session_source_required";
      error.sessionId = sessionId;
      throw error;
    }
    return root;
  }

  async function projectEnvironment(input = {}) {
    const userEnvironment = await projectService.projectInspectionEnvironment({
      scope: "dev",
      sessionId: input.sessionId
    });
    return {
      ...env,
      ...userEnvironment
    };
  }

  // A host that supplies resources (a managed database) may not have prepared
  // them yet; Preview then says Vibe64 is on it rather than asking for values.
  async function resourcesBeingPrepared(input = {}) {
    if (typeof projectService.projectEnvironmentStatus !== "function") return false;
    try {
      return (await projectService.projectEnvironmentStatus({ scope: "dev", sessionId: input.sessionId })).status === "not-prepared";
    } catch {
      return false;
    }
  }

  return Object.freeze({
    async inspectCurrentApp(input = {}) {
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
  });
}

export {
  createService,
  resolveCurrentAppRoot
};
