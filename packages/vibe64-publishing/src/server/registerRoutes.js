import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { createVibe64FeatureRoutes } from "@local/vibe64-core/server/featureRoutes";

import { PUBLISHING_ACTIONS as A } from "./actions.js";

const CONFLICT_CODES = new Set([
  "VIBE64_PUBLISH_CONFIRMATION_PLAN_CHANGED",
  "VIBE64_PUBLISH_CONFIRMATION_USED",
  "VIBE64_PUBLISH_BASELINE_MOVED",
  "VIBE64_PUBLISH_TAG_CONFLICT",
  "vibe64_publishing_target_exists",
  "vibe64_publishing_keys_exist"
]);
const FORBIDDEN_CODES = new Set(["VIBE64_PUBLISH_CONFIRMATION_NOT_PERSON", "VIBE64_PUBLISH_CONFIRMATION_INVALID", "VIBE64_PUBLISH_CONFIRMATION_EXPIRED"]);

function publishingStatusCode(response = {}) {
  if (response?.ok !== false) return 200;
  if (CONFLICT_CODES.has(response.code)) return 409;
  if (FORBIDDEN_CODES.has(response.code)) return 403;
  if (/missing$/u.test(response.code || "")) return 404;
  return 400;
}

function registerRoutes(http, { publishing, projectContext = null, routeRelativePath = "", routeSurface = "" } = {}) {
  const routes = createVibe64FeatureRoutes(http, {
    localRequestMessage: "Vibe64 publishing routes only accept requests from this computer.",
    projectContext,
    routeRelativePath,
    routeSurface,
    tags: ["studio", "vibe64-publishing"]
  });
  const base = "/publishing";
  const route = (method, suffix, actionId, summary, buildInput = () => ({}), bodyLimit = 64 * 1024) => {
    routes.actionRoute(method, `${base}${suffix}`, { actionId, buildInput, bodyLimit, statusCode: publishingStatusCode, summary });
  };
  const body = (request) => routes.requestBody(request);

  route("GET", "", A.STATE_READ, "Read this project's publishing targets, saved baseline, keys status and recent releases.");
  route("GET", "/release/suggestion", A.RELEASE_SUGGEST, "Suggest next versions and draft notes from the saved work.");
  route("POST", "/release/prepare", A.RELEASE_PREPARE, "Write a version bump and changelog entry into a session for the person to Save.", body);
  route("POST", "/targets", A.TARGET_ADD, "Add a publishing target.", body);
  route("PATCH", "/targets/:targetId", A.TARGET_UPDATE, "Change a target's account or channel.", (request) => ({ ...body(request), targetId: request.params.targetId }));
  route("DELETE", "/targets/:targetId", A.TARGET_REMOVE, "Remove a publishing target.", (request) => ({ targetId: request.params.targetId }));
  route("POST", "/targets/:targetId/install-key", A.INSTALL_KEY_CREATE, "Create the phone install key for a target.", (request) => ({ targetId: request.params.targetId }));
  route("POST", "/plan", A.PLAN_READ, "Build the exact release plan for the saved commit and run preflight.", body);
  route("POST", "/checks", A.CHECKS_RUN, "Run the project's checks on the saved commit.");
  route("POST", "/dry-run", A.DRYRUN_RUN, "Start a dry run of the current plan.", body);
  route("POST", "/confirmation", A.CONFIRMATION_OPEN, "Open the person's confirmation for the current plan.", body);
  route("DELETE", "/confirmation/request", A.CONFIRMATION_DISMISS, "Dismiss a confirmation an assistant asked for.");
  route("POST", "/releases", A.RELEASE_CONFIRM, "Confirm the plan and release in the background.", body);
  route("GET", "/releases", A.HISTORY_LIST, "List recent releases and dry runs.", (request) => ({ limit: Number(routes.requestQuery(request).limit) || undefined }));
  route("GET", "/releases/:releaseId", A.RELEASE_READ, "Read one release.", (request) => ({ releaseId: request.params.releaseId }));
  route("GET", "/releases/:releaseId/logs", A.LOGS_READ, "Read one release's log.", (request) => ({ releaseId: request.params.releaseId }));
  route("POST", "/keys", A.KEYS_CREATE, "Create the person's publishing keys with a passphrase.", body);
  route("POST", "/keys/unlock", A.KEYS_UNLOCK, "Unlock the person's publishing keys for a while.", body);
  route("POST", "/keys/lock", A.KEYS_LOCK, "Lock the person's publishing keys now.");
  route("POST", "/accounts", A.ACCOUNT_ADD, "Add a publishing account to the person's keys.", body);
  route("DELETE", "/accounts/:accountId", A.ACCOUNT_REMOVE, "Remove a publishing account.", (request) => ({ accountId: request.params.accountId }));
  route("POST", "/recovery-kit", A.RECOVERY_KIT_CREATE, "Create a recovery kit of every publishing key.", body);
  route("POST", "/recovery-kit/restore", A.RECOVERY_KIT_RESTORE, "Restore publishing keys from a recovery kit.", body, 12 * 1024 * 1024);
  route("GET", "/toolchains/android/licence", A.LICENCE_READ, "Read Google's Android SDK licence.");
  route("POST", "/toolchains/android/licence", A.LICENCE_ACCEPT, "Record the person's acceptance of the Android SDK licence.", body);
  route("POST", "/toolchains/android", A.ANDROID_INSTALL, "Download Java and the Android SDK into the toolchains folder.");
  route("POST", "/toolchains/python", A.PYTHON_INSTALL, "Set up the Python upload tools in the toolchains folder.");
  route("POST", "/share", A.SHARE_START, "Share one signed APK on the local network for a few minutes.", body);
  route("DELETE", "/share", A.SHARE_STOP, "Stop sharing the APK.");

  // The signed APK of a proven phone target, downloaded to this computer.
  routes.serviceRoute("GET", `${base}/releases/:releaseId/targets/:targetId/apk`, {
    summary: "Download a signed APK from the release history."
  }, async (request, reply) => {
    let apk;
    try {
      apk = await publishing.signedApk({ releaseId: request.params.releaseId, targetId: request.params.targetId });
    } catch (error) {
      return reply.code(404).send({ ok: false, code: error?.code || "vibe64_publishing_download_missing", error: error?.message || "Not found." });
    }
    const details = await stat(apk.file).catch(() => null);
    if (!details?.isFile()) return reply.code(404).send({ ok: false, code: "vibe64_publishing_download_missing", error: "The signed APK is gone. Release again." });
    reply.header("content-type", "application/vnd.android.package-archive");
    reply.header("content-length", String(details.size));
    reply.header("content-disposition", `attachment; filename="${apk.fileName.replace(/"/gu, "")}"`);
    reply.header("cache-control", "no-store");
    return reply.send(createReadStream(apk.file));
  });
}

export { publishingStatusCode, registerRoutes };
