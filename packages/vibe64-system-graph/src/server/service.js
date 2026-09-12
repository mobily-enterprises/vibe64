import {
  inspectGenesisSubsystems,
  refreshGenesisCities
} from "@local/vibe64-genesis/server";
import {
  normalizeText,
  pathExists,
  vibe64Error
} from "@local/vibe64-core/server/core";
import {
  sessionSourcePath
} from "@local/vibe64-core/server/sessionSourcePath";
import {
  vibe64Result
} from "@local/vibe64-core/server/serverResponses";

import {
  readGenesisCity,
  requireGenesisCity,
  validateGenesisCity
} from "./genesisCities.js";

function systemResult(operation) {
  return vibe64Result(operation, {
    fallbackCode: "vibe64_system_graph_failed",
    fallbackMessage: "Vibe64 City operation failed."
  });
}

function systemError(message, code, details = {}) {
  const error = vibe64Error(message, code);
  error.details = details;
  return error;
}

function cityStatus(record, error = null) {
  if (error) {
    return {
      available: false,
      error: {
        code: String(error.code || "vibe64_invalid_genesis_city"),
        message: String(error.message || error)
      },
      path: error.details?.path || record?.path || "",
      state: "invalid"
    };
  }
  if (!record?.exists) {
    return {
      available: false,
      error: null,
      path: record?.path || "",
      state: "missing"
    };
  }
  return {
    available: true,
    error: null,
    path: record.path,
    schema: record.city.schema,
    schemaVersion: record.city.schemaVersion,
    state: "ready",
    status: record.city.status
  };
}

function combinedStatus(cities) {
  const states = Object.values(cities).map((city) => city.state);
  if (states.includes("invalid")) {
    return "invalid";
  }
  if (states.includes("missing")) {
    return "missing";
  }
  return "ready";
}

function settledCityStatus(result, kind) {
  if (result.status === "fulfilled") {
    return cityStatus(result.value);
  }
  return cityStatus({ kind }, result.reason);
}

function createService({
  cityReader = readGenesisCity,
  subsystemReader = inspectGenesisSubsystems,
  projectService,
  refresher = refreshGenesisCities
} = {}) {
  if (!projectService || typeof projectService.createRuntime !== "function") {
    throw new TypeError("createService requires the Vibe64 Project API.");
  }
  if (typeof cityReader !== "function" || typeof refresher !== "function") {
    throw new TypeError("createService requires Genesis City reader and refresher functions.");
  }

  async function systemContext(sessionId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      throw systemError("Missing Vibe64 session id.", "vibe64_invalid_session_id");
    }
    const runtime = await projectService.createRuntime({
      sessionId: normalizedSessionId
    });
    const session = await runtime.getSession(normalizedSessionId);
    const sourceRoot = sessionSourcePath(session);
    if (!sourceRoot || !await pathExists(sourceRoot)) {
      throw systemError(
        "Create the active session source before opening City.",
        "vibe64_system_source_unavailable",
        { sessionId: normalizedSessionId }
      );
    }
    return {
      sessionId: normalizedSessionId,
      sourceRoot
    };
  }

  async function readCity(sessionId, kind) {
    const context = await systemContext(sessionId);
    const record = await cityReader(context.sourceRoot, kind);
    return {
      city: requireGenesisCity(record, kind),
      kind,
      ok: true,
      path: record.path
    };
  }

  return Object.freeze({
    async readSubsystems(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const map = await subsystemReader({ projectRoot: context.sourceRoot });
        return { ok: true, ...map };
      });
    },

    async readStatus(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const [machineResult, programResult] = await Promise.allSettled([
          cityReader(context.sourceRoot, "machine"),
          cityReader(context.sourceRoot, "program")
        ]);
        const cities = {
          machine: settledCityStatus(machineResult, "machine"),
          program: settledCityStatus(programResult, "program")
        };
        return {
          cities,
          ok: true,
          status: combinedStatus(cities)
        };
      });
    },

    async readMachineCity(input = {}) {
      return systemResult(() => readCity(input.sessionId, "machine"));
    },

    async readProgramCity(input = {}) {
      return systemResult(() => readCity(input.sessionId, "program"));
    },

    async refresh(input = {}) {
      return systemResult(async () => {
        const context = await systemContext(input.sessionId);
        const result = await refresher({
          projectRoot: context.sourceRoot,
          write: true
        });
        const machine = validateGenesisCity(result?.machine, "machine");
        const program = validateGenesisCity(result?.program, "program");
        return {
          changedFiles: Array.isArray(result.changedFiles) ? result.changedFiles : [],
          cities: {
            machine,
            program
          },
          diagnostics: Array.isArray(result.diagnostics) ? result.diagnostics : [],
          ok: true,
          status: normalizeText(result.status) || "ready",
          summary: normalizeText(result.summary)
        };
      });
    }
  });
}

export {
  createService
};
