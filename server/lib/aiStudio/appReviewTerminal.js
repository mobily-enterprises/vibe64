import {
  DEFAULT_LAUNCH_TARGET_PORT,
  createAiStudioLaunchTargetTerminalSpec,
  findAvailableLaunchTargetPort,
  launchTargetStartupScript
} from "./launchTargetTerminal.js";

async function createAiStudioAppReviewTerminalSpec({
  resolveReview = async () => ({}),
  ...options
} = {}) {
  return createAiStudioLaunchTargetTerminalSpec({
    ...options,
    launchTarget: {
      id: "app_review",
      label: "App review"
    },
    resolveLaunch: resolveReview
  });
}

const DEFAULT_REVIEW_PORT = DEFAULT_LAUNCH_TARGET_PORT;
const appReviewStartupScript = launchTargetStartupScript;
const findAvailableReviewPort = findAvailableLaunchTargetPort;

export {
  DEFAULT_REVIEW_PORT,
  appReviewStartupScript,
  createAiStudioAppReviewTerminalSpec,
  findAvailableReviewPort
};
