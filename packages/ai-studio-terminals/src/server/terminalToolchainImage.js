import {
  dockerImageExists
} from "@local/studio-terminal-core/server/containerRuntime";
import {
  STUDIO_BASE_TOOLCHAIN_IMAGE
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const BASE_TERMINAL_TOOLCHAIN_LABEL = "managed base toolchain";

function baseTerminalToolchainSpec() {
  return {
    image: STUDIO_BASE_TOOLCHAIN_IMAGE,
    label: BASE_TERMINAL_TOOLCHAIN_LABEL,
    required: false,
    setupActionLabel: "Build managed base toolchain"
  };
}

function normalizeTerminalToolchainSpec(spec = {}) {
  const image = String(spec?.image || "").trim();
  if (!image) {
    return baseTerminalToolchainSpec();
  }
  return {
    image,
    label: String(spec.label || image).trim() || image,
    required: true,
    setupActionLabel: String(spec.setupActionLabel || "").trim()
  };
}

function missingTerminalToolchainImageError(spec = baseTerminalToolchainSpec()) {
  if (spec.required) {
    const setupHint = spec.setupActionLabel
      ? ` Open Setup and run ${spec.setupActionLabel}.`
      : " Open Setup and build the adapter toolchain.";
    return `${spec.label} image ${spec.image} is missing.${setupHint}`;
  }
  return `Managed base toolchain image ${spec.image} is missing. Open Setup and run Build managed base toolchain.`;
}

async function resolveTerminalToolchainImage({
  imageExists = dockerImageExists,
  runtime = null,
  session = {},
  target = "",
  targetRoot = ""
} = {}) {
  const adapterSpec = typeof runtime?.adapter?.getTerminalToolchainSpec === "function"
    ? await runtime.adapter.getTerminalToolchainSpec({
        config: runtime.projectConfig || {},
        runtime,
        session,
        target,
        targetRoot
      })
    : {};
  const spec = normalizeTerminalToolchainSpec(adapterSpec);
  if (await imageExists(spec.image)) {
    return {
      ...spec,
      ok: true
    };
  }
  return {
    ...spec,
    error: missingTerminalToolchainImageError(spec),
    ok: false
  };
}

export {
  baseTerminalToolchainSpec,
  missingTerminalToolchainImageError,
  normalizeTerminalToolchainSpec,
  resolveTerminalToolchainImage
};
