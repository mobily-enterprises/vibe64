import {
  dockerCommand,
  runHostCommand,
  shellQuote
} from "../../../../server/lib/shellCommands.js";

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
