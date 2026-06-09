import {
  VIBE64_CPP_TOOLCHAIN_IMAGE_ENV,
  vibe64ToolchainImage
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const CPP_TOOLCHAIN_IMAGE = vibe64ToolchainImage("vibe64-cpp-toolchain", VIBE64_CPP_TOOLCHAIN_IMAGE_ENV);

export {
  CPP_TOOLCHAIN_IMAGE
};
