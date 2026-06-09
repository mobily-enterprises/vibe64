import {
  VIBE64_JSKIT_TOOLCHAIN_IMAGE_ENV,
  vibe64ToolchainImage
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const JSKIT_TOOLCHAIN_IMAGE = vibe64ToolchainImage("vibe64-jskit-toolchain", VIBE64_JSKIT_TOOLCHAIN_IMAGE_ENV);

export {
  JSKIT_TOOLCHAIN_IMAGE
};
