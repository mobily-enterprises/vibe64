import {
  createDoctorRepair,
  failDoctorCheck as failCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";
import {
  dockerCommand
} from "@local/studio-terminal-core/server/shellCommands";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

function adapterToolchainBuildArgs({
  baseImage = STUDIO_BASE_TOOLCHAIN_IMAGE,
  context = "",
  dockerfile = "",
  image = ""
} = {}) {
  return [
    "build",
    "-t",
    image,
    "--build-arg",
    `VIBE64_BASE_IMAGE=${baseImage}`,
    "-f",
    dockerfile,
    context
  ];
}

function adapterToolchainBuildScript(options = {}) {
  const args = adapterToolchainBuildArgs(options);
  return [
    "set -e",
    `echo '$ ${dockerCommand(args)}'`,
    dockerCommand(args)
  ].join("\n");
}

function adapterToolchainBuildRepair({
  actionId = "",
  label = "",
  ...options
} = {}) {
  return createDoctorRepair({
    actionId,
    autoRun: true,
    command: dockerCommand(adapterToolchainBuildArgs(options)),
    kind: "terminal",
    label
  });
}

async function checkAdapterToolchainImage(toolkit, {
  buildRepair = null,
  expected = "",
  explanation = "",
  id = "",
  image = "",
  label = ""
} = {}) {
  const result = await toolkit.runDocker([
    "image",
    "inspect",
    image,
    "--format",
    "{{.Id}}"
  ], {
    timeout: 12_000
  });

  if (!result.ok) {
    return failCheck({
      id,
      label,
      expected: expected || `${image} exists locally.`,
      observed: result.output,
      explanation,
      repair: buildRepair
    });
  }

  return passCheck({
    id,
    label,
    expected: expected || `${image} exists locally.`,
    observed: result.output,
    explanation: `${label} is present.`
  });
}

function missingAdapterToolchainCheck({
  buildRepair = null,
  expected = "",
  id = "",
  label = ""
} = {}) {
  return failCheck({
    id,
    label,
    expected,
    observed: `${label} is missing.`,
    explanation: `Build ${label} first.`,
    repair: buildRepair
  });
}

export {
  adapterToolchainBuildArgs,
  adapterToolchainBuildRepair,
  adapterToolchainBuildScript,
  checkAdapterToolchainImage,
  missingAdapterToolchainCheck
};
