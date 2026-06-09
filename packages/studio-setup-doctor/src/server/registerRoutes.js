import {
  registerDoctorRoutes
} from "@local/setup-doctor-core/server/doctorRoutes";

import {
  ACTION_READ_STUDIO_SETUP
} from "./actions.js";
import {
  studioSetupQueryInputValidator,
  terminalInputValidator,
  terminalStartInputValidator
} from "./inputSchemas.js";

function registerRoutes(app, options = {}) {
  registerDoctorRoutes(app, {
    ...options,
    actionId: ACTION_READ_STUDIO_SETUP,
    closeTerminalSummary: "Close a Studio Setup Doctor terminal session.",
    includeVibe64User: true,
    localRequestMessage: "Studio Setup Doctor routes only accept loopback Studio requests.",
    queryValidator: studioSetupQueryInputValidator,
    readTerminalSummary: "Read a Studio Setup Doctor terminal session.",
    serviceToken: "feature.studio-setup-doctor.service",
    startTerminalSummary: "Start a Studio Setup Doctor terminal session.",
    statusSummary: "Read Studio Setup Doctor status.",
    streamSummary: "Stream Studio Setup Doctor status progress.",
    tags: ["studio-setup"],
    terminalInputValidator,
    terminalStartInputValidator,
    writeTerminalSummary: "Write to a Studio Setup Doctor terminal session."
  });
}

export { registerRoutes };
