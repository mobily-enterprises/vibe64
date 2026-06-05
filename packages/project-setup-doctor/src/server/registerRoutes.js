import {
  registerDoctorRoutes
} from "@local/setup-doctor-core/server/doctorRoutes";

import {
  ACTION_GET_STATUS
} from "./actions.js";
import {
  statusQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
} from "./inputSchemas.js";

function registerRoutes(app, options = {}) {
  registerDoctorRoutes(app, {
    ...options,
    actionId: ACTION_GET_STATUS,
    closeTerminalSummary: "Close a Project Setup Doctor terminal session.",
    includeVibe64User: true,
    localRequestMessage: "Project Setup Doctor routes only accept loopback Studio requests.",
    queryValidator: statusQueryInputValidator,
    readTerminalSummary: "Read a Project Setup Doctor terminal session.",
    serviceToken: "feature.project-setup-doctor.service",
    startTerminalSummary: "Start a Project Setup Doctor terminal session.",
    statusSummary: "Read Project Setup Doctor status.",
    streamSummary: "Stream Project Setup Doctor status progress.",
    tags: ["studio", "project-setup-doctor"],
    terminalInputValidator,
    terminalStartInputValidator,
    writeTerminalSummary: "Write to a Project Setup Doctor terminal session."
  });
}

export { registerRoutes };
