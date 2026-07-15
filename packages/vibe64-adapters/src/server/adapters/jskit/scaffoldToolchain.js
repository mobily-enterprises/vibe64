import {
  VIBE64_PLAYWRIGHT_VERSION_ENV
} from "@local/vibe64-execution/server";

const JSKIT_CREATE_APP_PACKAGE_SPEC = "@jskit-ai/create-app";
const JSKIT_CREATE_APP_PLAYWRIGHT_OPTION = `--playwright-version "$${VIBE64_PLAYWRIGHT_VERSION_ENV}"`;

export {
  JSKIT_CREATE_APP_PACKAGE_SPEC,
  JSKIT_CREATE_APP_PLAYWRIGHT_OPTION
};
