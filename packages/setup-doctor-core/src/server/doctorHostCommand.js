function normalizeHostCommandOptions(options = {}) {
  return Array.isArray(options)
    ? {
        extraArgs: options
      }
    : options;
}

function buildDoctorHostCommandArgs(commandArgs) {
  return Array.isArray(commandArgs) ? commandArgs.map((arg) => String(arg)) : [];
}

function buildDoctorTerminalArgs(commandArgs, options = {}) {
  void normalizeHostCommandOptions(options);
  return buildDoctorHostCommandArgs(commandArgs);
}

export {
  buildDoctorHostCommandArgs,
  buildDoctorTerminalArgs,
  normalizeHostCommandOptions
};
