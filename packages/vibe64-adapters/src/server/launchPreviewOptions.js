import {
  shellQuote
} from "@local/vibe64-execution/server";

const STARTUP_ARGS_PREVIEW_OPTION_ID = "startupArgs";

function startupArgsPreviewOption({
  description = "Arguments passed to the app server command when previewing this app.",
  placeholder = "--flag\nvalue"
} = {}) {
  return {
    defaultValue: [],
    description,
    id: STARTUP_ARGS_PREVIEW_OPTION_ID,
    label: "Startup arguments",
    placeholder,
    type: "string-list"
  };
}

function launchTargetWithStartupArgsOption(launchTarget = {}) {
  const previewOptions = Array.isArray(launchTarget.previewOptions)
    ? launchTarget.previewOptions
    : [];
  return {
    ...launchTarget,
    previewOptions: [
      ...previewOptions.filter((option) => option?.id !== STARTUP_ARGS_PREVIEW_OPTION_ID),
      startupArgsPreviewOption()
    ]
  };
}

function normalizeLaunchInputValues(launchInput = {}) {
  return launchInput && typeof launchInput === "object" && !Array.isArray(launchInput) &&
    launchInput.values && typeof launchInput.values === "object" && !Array.isArray(launchInput.values)
    ? launchInput.values
    : {};
}

function startupArgsFromLaunchInput(launchInput = {}) {
  const value = normalizeLaunchInputValues(launchInput)[STARTUP_ARGS_PREVIEW_OPTION_ID];
  return (Array.isArray(value) ? value : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
}

function commandWithStartupArgs(command = "", startupArgs = [], {
  separator = ""
} = {}) {
  const normalizedCommand = String(command || "").trim();
  const normalizedArgs = (Array.isArray(startupArgs) ? startupArgs : [])
    .map((entry) => String(entry || "").trim())
    .filter(Boolean);
  if (!normalizedCommand || normalizedArgs.length < 1) {
    return normalizedCommand;
  }
  return [
    normalizedCommand,
    separator ? String(separator) : "",
    normalizedArgs.map(shellQuote).join(" ")
  ].filter(Boolean).join(" ");
}

export {
  STARTUP_ARGS_PREVIEW_OPTION_ID,
  commandWithStartupArgs,
  launchTargetWithStartupArgsOption,
  startupArgsFromLaunchInput,
  startupArgsPreviewOption
};
