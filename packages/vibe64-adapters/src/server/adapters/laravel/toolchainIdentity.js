import {
  VIBE64_LARAVEL_TOOLCHAIN_IMAGE_ENV,
  vibe64ToolchainImage
} from "@local/studio-terminal-core/server/studioRuntimeIdentity";

const LARAVEL_TOOLCHAIN_IMAGE = vibe64ToolchainImage("vibe64-laravel-toolchain", VIBE64_LARAVEL_TOOLCHAIN_IMAGE_ENV);

export {
  LARAVEL_TOOLCHAIN_IMAGE
};
