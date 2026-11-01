/** @typedef {import("./types.js").PublishingService} PublishingService */
/** @typedef {ReturnType<typeof import("@jskit-ai/kernel/server/http").createActionRouteScope>} ActionRouteScope */

/**
 * The download of a proven phone target's signed APK to this computer.
 * @param {ActionRouteScope} routes
 * @param {object} capabilities
 * @param {PublishingService} capabilities.publishing
 */
function registerApkDownloadRoutes(routes, { publishing }) {
  routes.serviceRoute("GET", "/publishing/releases/:releaseId/targets/:targetId/apk", {
    summary: "Download a signed APK from the release history."
  }, async (request, reply) => {
    let download;
    try {
      download = await publishing.signedApkDownload({ releaseId: request.params.releaseId, targetId: request.params.targetId });
    } catch (error) {
      return reply.code(404).send({
        ok: false,
        code: error?.code || "vibe64_publishing_download_missing",
        error: error?.message || "Not found."
      });
    }
    reply.header("content-type", "application/vnd.android.package-archive");
    reply.header("content-length", String(download.size));
    reply.header("content-disposition", `attachment; filename="${download.fileName.replace(/"/gu, "")}"`);
    reply.header("cache-control", "no-store");
    return reply.send(download.stream);
  });
}

export { registerApkDownloadRoutes };
