import { createReadStream } from "node:fs";
import { stat } from "node:fs/promises";

import { createActionRouteScope } from "@jskit-ai/kernel/server/http";
import {
  VIBE64_PROJECT_ROUTE_BASE,
  requestBody,
  requestQuery,
  vibe64RouteHandler,
  vibe64RouteHttp
} from "@local/vibe64-core/server/featureRoutes";

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

function registerRoutes(http, { publishing, projectContext = null } = {}) {
  const routes = createActionRouteScope(vibe64RouteHttp(http, { tags: ["studio", "vibe64-publishing"] }), {
    routeBase: VIBE64_PROJECT_ROUTE_BASE,
    relativePath: "vibe64",
    surface: "app",
    wrapHandler: vibe64RouteHandler({
      localRequestMessage: "Vibe64 publishing routes only accept requests from this computer.",
      projectContext
    })
  });
  const options = { bodyLimit: 64 * 1024, statusCode: publishingStatusCode };

  routes.actionRoute("GET", "/publishing", { ...options, actionId: "vibe64.publication.state.read", summary: "Read this project's publishing targets, saved baseline, keys status and recent releases." });
  routes.actionRoute("GET", "/publishing/release/suggestion", { ...options, actionId: "vibe64.publication.release.suggest", summary: "Suggest next versions and draft notes from the saved work." });
  routes.actionRoute("POST", "/publishing/release/prepare", { ...options, actionId: "vibe64.publication.release.prepare", buildInput: requestBody, summary: "Write a version bump and changelog entry into a session for the person to Save." });
  routes.actionRoute("POST", "/publishing/targets", { ...options, actionId: "vibe64.publication.target.add", buildInput: requestBody, summary: "Add a publishing target." });
  routes.actionRoute("PATCH", "/publishing/targets/:targetId", { ...options, actionId: "vibe64.publication.target.update", buildInput: (request) => ({ ...requestBody(request), targetId: request.params.targetId }), summary: "Change a target's account or channel." });
  routes.actionRoute("DELETE", "/publishing/targets/:targetId", { ...options, actionId: "vibe64.publication.target.remove", buildInput: (request) => ({ targetId: request.params.targetId }), summary: "Remove a publishing target." });
  routes.actionRoute("POST", "/publishing/targets/:targetId/install-key", { ...options, actionId: "vibe64.publication.install-key.create", buildInput: (request) => ({ targetId: request.params.targetId }), summary: "Create the phone install key for a target." });
  routes.actionRoute("POST", "/publishing/plan", { ...options, actionId: "vibe64.publication.plan.read", buildInput: requestBody, summary: "Build the exact release plan for the saved commit and run preflight." });
  routes.actionRoute("POST", "/publishing/baseline/push", { ...options, actionId: "vibe64.publication.baseline.push", summary: "Push the saved work to the project's remote, fast-forward only." });
  routes.actionRoute("POST", "/publishing/checks", { ...options, actionId: "vibe64.publication.checks.run", summary: "Run the project's checks on the saved commit." });
  routes.actionRoute("POST", "/publishing/dry-run", { ...options, actionId: "vibe64.publication.dryrun.run", buildInput: requestBody, summary: "Start a dry run of the current plan." });
  routes.actionRoute("POST", "/publishing/confirmation", { ...options, actionId: "vibe64.publication.confirmation.open", buildInput: requestBody, summary: "Open the person's confirmation for the current plan." });
  routes.actionRoute("DELETE", "/publishing/confirmation/request", { ...options, actionId: "vibe64.publication.confirmation.dismiss", summary: "Dismiss a confirmation an assistant asked for." });
  routes.actionRoute("POST", "/publishing/releases", { ...options, actionId: "vibe64.publication.release.confirm", buildInput: requestBody, summary: "Confirm the plan and release in the background." });
  routes.actionRoute("GET", "/publishing/releases", { ...options, actionId: "vibe64.publication.history.list", buildInput: (request) => ({ limit: Number(requestQuery(request).limit) || undefined }), summary: "List recent releases and dry runs." });
  routes.actionRoute("GET", "/publishing/releases/:releaseId", { ...options, actionId: "vibe64.publication.release.read", buildInput: (request) => ({ releaseId: request.params.releaseId }), summary: "Read one release." });
  routes.actionRoute("GET", "/publishing/releases/:releaseId/logs", { ...options, actionId: "vibe64.publication.logs.read", buildInput: (request) => ({ releaseId: request.params.releaseId }), summary: "Read one release's log." });
  routes.actionRoute("POST", "/publishing/keys", { ...options, actionId: "vibe64.publication.keys.create", buildInput: requestBody, summary: "Create the person's publishing keys with a passphrase." });
  routes.actionRoute("POST", "/publishing/keys/unlock", { ...options, actionId: "vibe64.publication.keys.unlock", buildInput: requestBody, summary: "Unlock the person's publishing keys for a while." });
  routes.actionRoute("POST", "/publishing/keys/lock", { ...options, actionId: "vibe64.publication.keys.lock", summary: "Lock the person's publishing keys now." });
  routes.actionRoute("POST", "/publishing/accounts", { ...options, actionId: "vibe64.publication.account.add", buildInput: requestBody, summary: "Add a publishing account to the person's keys." });
  routes.actionRoute("DELETE", "/publishing/accounts/:accountId", { ...options, actionId: "vibe64.publication.account.remove", buildInput: (request) => ({ accountId: request.params.accountId }), summary: "Remove a publishing account." });
  routes.actionRoute("POST", "/publishing/recovery-kit", { ...options, actionId: "vibe64.publication.recovery-kit.create", buildInput: requestBody, summary: "Create a recovery kit of every publishing key." });
  routes.actionRoute("POST", "/publishing/recovery-kit/restore", { ...options, bodyLimit: 12 * 1024 * 1024, actionId: "vibe64.publication.recovery-kit.restore", buildInput: requestBody, summary: "Restore publishing keys from a recovery kit." });
  routes.actionRoute("GET", "/publishing/toolchains/android/licence", { ...options, actionId: "vibe64.publication.toolchain.licence.read", summary: "Read Google's Android SDK licence." });
  routes.actionRoute("POST", "/publishing/toolchains/android/licence", { ...options, actionId: "vibe64.publication.toolchain.licence.accept", buildInput: requestBody, summary: "Record the person's acceptance of the Android SDK licence." });
  routes.actionRoute("POST", "/publishing/toolchains/android", { ...options, actionId: "vibe64.publication.toolchain.android.install", summary: "Download Java and the Android SDK into the toolchains folder." });
  routes.actionRoute("POST", "/publishing/toolchains/python", { ...options, actionId: "vibe64.publication.toolchain.python.install", summary: "Set up the Python upload tools in the toolchains folder." });
  routes.actionRoute("POST", "/publishing/share", { ...options, actionId: "vibe64.publication.share.start", buildInput: requestBody, summary: "Share one signed APK on the local network for a few minutes." });
  routes.actionRoute("DELETE", "/publishing/share", { ...options, actionId: "vibe64.publication.share.stop", summary: "Stop sharing the APK." });

  // The signed APK of a proven phone target, downloaded to this computer.
  routes.serviceRoute("GET", "/publishing/releases/:releaseId/targets/:targetId/apk", {
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
