import {
  dockerCommand,
  runHostCommand,
  shellQuote
} from "@local/studio-terminal-core/server/shellCommands";

async function runDocker(args, options = {}) {
  return runHostCommand("docker", args, {
    ...options,
    timeout: options.timeout || 30_000
  });
}

export {
  dockerCommand,
  runDocker,
  shellQuote
};
