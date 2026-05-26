import {
  hostUserDockerArgs
} from "./shellCommands.js";

function dockerEnvArgs(env = {}) {
  return Object.entries(env)
    .filter(([, value]) => String(value || ""))
    .flatMap(([name, value]) => [
      "-e",
      `${name}=${value}`
    ]);
}

function writableHostUserDockerArgs({
  env = {},
  home = "/tmp/studio-home"
} = {}) {
  return [
    ...hostUserDockerArgs(),
    ...dockerEnvArgs({
      HOME: home,
      ...env
    })
  ];
}

export {
  dockerEnvArgs,
  writableHostUserDockerArgs
};
