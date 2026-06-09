import {
  hardStopDoctorCheck as hardStopCheck,
  passDoctorCheck as passCheck
} from "@local/vibe64-core/server/doctorCheckItems";

async function checkAdapterToolchainImage(toolkit, {
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
    return hardStopCheck({
      id,
      label,
      expected: expected || `${image} exists locally.`,
      observed: result.output,
      explanation
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
  expected = "",
  id = "",
  label = ""
} = {}) {
  return hardStopCheck({
    id,
    label,
    expected,
    observed: `${label} is missing.`,
    explanation: `${label} is managed host infrastructure. This Vibe64 host was not provisioned with the required toolchain image.`
  });
}

export {
  checkAdapterToolchainImage,
  missingAdapterToolchainCheck
};
