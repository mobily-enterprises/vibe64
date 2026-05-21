import assert from "node:assert/strict";

function dockerEnvValue(args = [], key = "") {
  const prefix = `${key}=`;
  let value = "";
  for (let index = 0; index < args.length - 1; index += 1) {
    if (args[index] === "-e" && String(args[index + 1]).startsWith(prefix)) {
      value = String(args[index + 1]).slice(prefix.length);
    }
  }
  return value;
}

function assertDockerEnv(args = [], key = "", expected = "") {
  assert.equal(dockerEnvValue(args, key), expected);
}

function assertDockerVolumeMount(args = [], source = "", target = "") {
  assert.ok(args.includes(`${source}:${target}`));
}

export {
  assertDockerEnv,
  assertDockerVolumeMount,
  dockerEnvValue
};
