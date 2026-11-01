import { VIBE64_UPLOAD_MAX_BYTES, VIBE64_UPLOAD_BODY_LIMIT_BYTES } from "@local/vibe64-core/shared";
import { requestQuery } from "@local/vibe64-core/server/featureRoutes";
import {
  ACTION_DOWNLOAD_AREA_ARCHIVE,
  ACTION_DOWNLOAD_AREA_FILE,
  ACTION_DOWNLOAD_SOURCE_FILE,
  ACTION_UPLOAD_AREA_FILE
} from "./sourceEditorActions.js";
import { areaPathQueryInput, areaQueryInput, sessionQueryInput } from "./routeInputs.js";
import { filePreviewImageType } from "../shared/fileTypes.js";

/** @typedef {import("./types.js").ActionRouteScope} ActionRouteScope */

/**
 * An inline image keeps its real type so the browser can show it in place;
 * the policy stops an SVG opened directly from running script or loading anything.
 * @param {object} reply
 * @param {object} result
 * @param {boolean} inline
 */
async function sendFileDownload(reply, result, inline) {
  if (!result.ok) {
    return result;
  }
  const encodedName = encodeURIComponent(result.name).replace(/[!'()*]/gu, (character) =>
    `%${character.codePointAt(0).toString(16).toUpperCase()}`);
  const imageType = inline ? filePreviewImageType(result.name) : "";
  try {
    // An async handler must stay pending until Fastify has sent the file stream.
    await reply.header("Content-Type", imageType || "application/octet-stream")
      .header("Content-Disposition", imageType ? "inline" : `attachment; filename*=UTF-8''${encodedName}`)
      .header("Cache-Control", "private, no-store")
      .header("X-Content-Type-Options", "nosniff")
      .header("Content-Security-Policy", "default-src 'none'; img-src data:; style-src 'unsafe-inline'; sandbox")
      .send(result.fileHandle.createReadStream({ autoClose: true }));
  } catch (error) {
    await result.fileHandle.close();
    throw error;
  }
}

async function downloadAreaFile(request, reply) {
  const result = await request.executeAction({ actionId: ACTION_DOWNLOAD_AREA_FILE, input: areaPathQueryInput(request) });
  return sendFileDownload(reply, result, requestQuery(request).inline === "1");
}

async function downloadAreaArchive(request, reply) {
  const result = await request.executeAction({ actionId: ACTION_DOWNLOAD_AREA_ARCHIVE, input: areaPathQueryInput(request) });
  return sendFileDownload(reply, result, requestQuery(request).inline === "1");
}

async function downloadSourceFile(request, reply) {
  const { inline, ...input } = sessionQueryInput(request);
  const result = await request.executeAction({ actionId: ACTION_DOWNLOAD_SOURCE_FILE, input });
  return sendFileDownload(reply, result, inline === "1");
}

function uploadAreaFile(request) {
  return request.executeAction({
    actionId: ACTION_UPLOAD_AREA_FILE,
    input: areaQueryInput(request),
    context: {
      sourceEditorUpload: {
        readUpload: () => request.parts({
          throwFileSizeLimit: true,
          limits: { files: 1, fields: 0, parts: 1, fileSize: VIBE64_UPLOAD_MAX_BYTES }
        })
      }
    }
  });
}

/**
 * Binary and multipart framing stays at HTTP; the file operations are actions.
 * @param {ActionRouteScope} routes
 */
function registerFileTransferRoutes(routes) {
  routes.serviceRoute("GET", "/sessions/:sessionId/files/:area/download", {
    summary: "Download original bytes, or show an image in place, from an authorized file area."
  }, downloadAreaFile);
  routes.serviceRoute("GET", "/sessions/:sessionId/files/:area/archive", {
    summary: "Download original bytes, or show an image in place, from an authorized file area."
  }, downloadAreaArchive);
  routes.serviceRoute("POST", "/sessions/:sessionId/files/:area/upload", {
    bodyLimit: VIBE64_UPLOAD_BODY_LIMIT_BYTES,
    summary: "Upload one file into an authorized writable file area."
  }, uploadAreaFile);
  routes.serviceRoute("GET", "/project-files/:area/download", {
    summary: "Download original bytes, or show an image in place, from an authorized file area."
  }, downloadAreaFile);
  routes.serviceRoute("GET", "/project-files/:area/archive", {
    summary: "Download original bytes, or show an image in place, from an authorized file area."
  }, downloadAreaArchive);
  routes.serviceRoute("POST", "/project-files/:area/upload", {
    bodyLimit: VIBE64_UPLOAD_BODY_LIMIT_BYTES,
    summary: "Upload one file into an authorized writable file area."
  }, uploadAreaFile);
  routes.serviceRoute("GET", "/sessions/:sessionId/source-editor/download", {
    summary: "Download an original source file."
  }, downloadSourceFile);
}

export { registerFileTransferRoutes };
