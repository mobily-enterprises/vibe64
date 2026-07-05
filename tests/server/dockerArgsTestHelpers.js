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

function assertDockerGroupAdd(args = [], gid = "") {
  const indexes = args
    .map((arg, index) => arg === "--group-add" ? index : -1)
    .filter((index) => index >= 0);
  assert.ok(indexes.some((index) => args[index + 1] === String(gid)), `expected docker --group-add ${gid}`);
}

function assertDockerVolumeMount(args = [], source = "", target = "") {
  assert.ok(args.includes(`${source}:${target}`));
}

export {
  assertDockerEnv,
  assertDockerGroupAdd,
  assertDockerVolumeMount,
  dockerEnvValue
};
