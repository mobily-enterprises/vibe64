import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

import { registerApkDownloadRoutes } from "./apkDownloadRoutes.js";
import { PUBLISHING_ACTIONS } from "./publishingActions.js";
import { publishingStatusCode } from "./publishingError.js";

/** @typedef {import("./types.js").PublishingService} PublishingService */
/** @typedef {import("@jskit-ai/kernel/server/types").RuntimeHttp} RuntimeHttp */
/** @typedef {import("@local/vibe64-core/server/types").StudioProjectContext} StudioProjectContext */

const PUBLISHING_BODY_LIMIT = 64 * 1024;

function targetInput(request) {
  return { targetId: request.params.targetId };
}

/**
 * The body for the URL's target.
 */
function targetBodyInput(request) {
  return {
    ...requestBody(request),
    targetId: request.params.targetId
  };
}

/**
 * The history page size, when the query names one.
 */
function historyInput(request) {
  return { limit: Number(requestQuery(request).limit) || undefined };
}

function releaseInput(request) {
  return { releaseId: request.params.releaseId };
}

function accountInput(request) {
  return { accountId: request.params.accountId };
}

/**
 * @param {RuntimeHttp} http
 * @param {object} capabilities
 * @param {StudioProjectContext} capabilities.projectContext
 * @param {PublishingService} capabilities.publishing
 */
function registerRoutes(http, { projectContext, publishing }) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-publishing"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 publishing routes only accept requests from this computer.",
      projectContext
    })
  });
  routes.actionRoute("GET", "/publishing", {
    actionId: PUBLISHING_ACTIONS.STATE_READ,
    summary: "Read this project's publishing targets, saved baseline, keys status and recent releases.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("GET", "/publishing/release/suggestion", {
    actionId: PUBLISHING_ACTIONS.RELEASE_SUGGEST,
    summary: "Suggest next versions and draft notes from the saved work.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/release/prepare", {
    actionId: PUBLISHING_ACTIONS.RELEASE_PREPARE,
    buildInput: requestBody,
    summary: "Write a version bump and changelog entry into a session for the person to Save.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/targets", {
    actionId: PUBLISHING_ACTIONS.TARGET_ADD,
    buildInput: requestBody,
    summary: "Add a publishing target.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("PATCH", "/publishing/targets/:targetId", {
    actionId: PUBLISHING_ACTIONS.TARGET_UPDATE,
    buildInput: targetBodyInput,
    summary: "Change a target's account or channel.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("DELETE", "/publishing/targets/:targetId", {
    actionId: PUBLISHING_ACTIONS.TARGET_REMOVE,
    buildInput: targetInput,
    summary: "Remove a publishing target.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/targets/:targetId/install-key", {
    actionId: PUBLISHING_ACTIONS.INSTALL_KEY_CREATE,
    buildInput: targetInput,
    summary: "Create the phone install key for a target.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/plan", {
    actionId: PUBLISHING_ACTIONS.PLAN_READ,
    buildInput: requestBody,
    summary: "Build the exact release plan for the saved commit and run preflight.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/baseline/push", {
    actionId: PUBLISHING_ACTIONS.BASELINE_PUSH,
    summary: "Push the saved work to the project's remote, fast-forward only.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/checks", {
    actionId: PUBLISHING_ACTIONS.CHECKS_RUN,
    summary: "Run the project's checks on the saved commit.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/dry-run", {
    actionId: PUBLISHING_ACTIONS.DRYRUN_RUN,
    buildInput: requestBody,
    summary: "Start a dry run of the current plan.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/confirmation", {
    actionId: PUBLISHING_ACTIONS.CONFIRMATION_OPEN,
    buildInput: requestBody,
    summary: "Open the person's confirmation for the current plan.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("DELETE", "/publishing/confirmation/request", {
    actionId: PUBLISHING_ACTIONS.CONFIRMATION_DISMISS,
    summary: "Dismiss a confirmation an assistant asked for.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/releases", {
    actionId: PUBLISHING_ACTIONS.RELEASE_CONFIRM,
    buildInput: requestBody,
    summary: "Confirm the plan and release in the background.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("GET", "/publishing/releases", {
    actionId: PUBLISHING_ACTIONS.HISTORY_LIST,
    buildInput: historyInput,
    summary: "List recent releases and dry runs.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("GET", "/publishing/releases/:releaseId", {
    actionId: PUBLISHING_ACTIONS.RELEASE_READ,
    buildInput: releaseInput,
    summary: "Read one release.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("GET", "/publishing/releases/:releaseId/logs", {
    actionId: PUBLISHING_ACTIONS.LOGS_READ,
    buildInput: releaseInput,
    summary: "Read one release's log.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/keys", {
    actionId: PUBLISHING_ACTIONS.KEYS_CREATE,
    buildInput: requestBody,
    summary: "Create the person's publishing keys with a passphrase.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/keys/unlock", {
    actionId: PUBLISHING_ACTIONS.KEYS_UNLOCK,
    buildInput: requestBody,
    summary: "Unlock the person's publishing keys for a while.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/keys/lock", {
    actionId: PUBLISHING_ACTIONS.KEYS_LOCK,
    summary: "Lock the person's publishing keys now.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/accounts", {
    actionId: PUBLISHING_ACTIONS.ACCOUNT_ADD,
    buildInput: requestBody,
    summary: "Add a publishing account to the person's keys.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("DELETE", "/publishing/accounts/:accountId", {
    actionId: PUBLISHING_ACTIONS.ACCOUNT_REMOVE,
    buildInput: accountInput,
    summary: "Remove a publishing account.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/recovery-kit", {
    actionId: PUBLISHING_ACTIONS.RECOVERY_KIT_CREATE,
    buildInput: requestBody,
    summary: "Create a recovery kit of every publishing key.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/recovery-kit/restore", {
    actionId: PUBLISHING_ACTIONS.RECOVERY_KIT_RESTORE,
    buildInput: requestBody,
    summary: "Restore publishing keys from a recovery kit.",
    bodyLimit: 12 * 1024 * 1024,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("GET", "/publishing/toolchains/android/licence", {
    actionId: PUBLISHING_ACTIONS.LICENCE_READ,
    summary: "Read Google's Android SDK licence.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/toolchains/android/licence", {
    actionId: PUBLISHING_ACTIONS.LICENCE_ACCEPT,
    buildInput: requestBody,
    summary: "Record the person's acceptance of the Android SDK licence.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/toolchains/android", {
    actionId: PUBLISHING_ACTIONS.ANDROID_INSTALL,
    summary: "Download Java and the Android SDK into the toolchains folder.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/toolchains/python", {
    actionId: PUBLISHING_ACTIONS.PYTHON_INSTALL,
    summary: "Set up the Python upload tools in the toolchains folder.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("POST", "/publishing/share", {
    actionId: PUBLISHING_ACTIONS.SHARE_START,
    buildInput: requestBody,
    summary: "Share one signed APK on the local network for a few minutes.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });
  routes.actionRoute("DELETE", "/publishing/share", {
    actionId: PUBLISHING_ACTIONS.SHARE_STOP,
    summary: "Stop sharing the APK.",
    bodyLimit: PUBLISHING_BODY_LIMIT,
    statusCode: publishingStatusCode
  });

  registerApkDownloadRoutes(routes, { publishing });
}

export { registerRoutes };
