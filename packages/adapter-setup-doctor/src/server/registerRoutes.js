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
    closeTerminalSummary: "Close an Adapter Setup Doctor terminal session.",
    localRequestMessage: "Adapter Setup Doctor routes only accept loopback Studio requests.",
    queryValidator: statusQueryInputValidator,
    readTerminalSummary: "Read an Adapter Setup Doctor terminal session.",
    serviceToken: "feature.adapter-setup-doctor.service",
    startTerminalSummary: "Start an Adapter Setup Doctor terminal session.",
    statusSummary: "Read Adapter Setup Doctor status.",
    streamSummary: "Stream Adapter Setup Doctor status progress.",
    tags: ["studio", "adapter-setup-doctor"],
    terminalInputValidator,
    terminalStartInputValidator,
    writeTerminalSummary: "Write to an Adapter Setup Doctor terminal session."
  });
}

export { registerRoutes };
