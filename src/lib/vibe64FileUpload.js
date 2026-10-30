import { vibe64ApiError } from "@/lib/vibe64ApiResponses.js";
import { resolveStudioRequestUrl } from "@/lib/studioUrls.js";

// One browser upload: a multipart POST of a single file with byte progress and
// cancellation. Chat attachments and Files share it, each with its own wording.
const FILE_UPLOAD_MESSAGES = Object.freeze({
  cancelled: "Upload was cancelled.",
  failure: "File could not be uploaded.",
  invalid: "The upload returned an invalid response."
});

function fileUploadAbortError(message) {
  const error = new Error(message);
  error.name = "AbortError";
  return error;
}

function fileUploadPayload(request) {
  const response = request?.response;
  if (response && typeof response === "object") {
    return response;
  }
  const source = typeof response === "string"
    ? response
    : String(request?.responseText || "");
  if (!source.trim()) {
    return null;
  }
  try {
    return JSON.parse(source);
  } catch {
    return null;
  }
}

function fileUploadProgress(event = {}, fileSize = 0) {
  const totalBytes = Number.isFinite(Number(fileSize))
    ? Math.max(0, Number(fileSize))
    : 0;
  const transportTotal = event.lengthComputable === true && Number.isFinite(Number(event.total))
    ? Math.max(0, Number(event.total))
    : 0;
  if (transportTotal < 1) {
    return {
      bytesSent: 0,
      progress: null,
      totalBytes
    };
  }
  const transportLoaded = Number.isFinite(Number(event.loaded))
    ? Number(event.loaded)
    : 0;
  const progress = Math.min(1, Math.max(0, transportLoaded / transportTotal));
  return {
    bytesSent: Math.min(totalBytes, Math.floor(totalBytes * progress)),
    progress,
    totalBytes
  };
}

function uploadFileRequest({
  file,
  messages = FILE_UPLOAD_MESSAGES,
  onProgress = null,
  path,
  signal = null
} = {}) {
  const { cancelled, failure, invalid } = messages;
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(fileUploadAbortError(cancelled));
      return;
    }

    let request;
    try {
      request = new globalThis.XMLHttpRequest();
    } catch {
      reject(new Error(`${failure} Browser upload support is unavailable.`));
      return;
    }

    let settled = false;
    const progressHandler = (event) => {
      if (typeof onProgress !== "function") {
        return;
      }
      try {
        onProgress(fileUploadProgress(event, file.size));
      } catch {
        // Presentation callbacks cannot take ownership of the upload request.
      }
    };
    const cleanup = () => {
      signal?.removeEventListener?.("abort", abortHandler);
      request.upload?.removeEventListener?.("progress", progressHandler);
      request.onload = null;
      request.onerror = null;
      request.onabort = null;
      request.ontimeout = null;
    };
    const settle = (callback, value) => {
      if (settled) {
        return;
      }
      settled = true;
      cleanup();
      callback(value);
    };
    const abortError = () => fileUploadAbortError(cancelled);
    const abortHandler = () => {
      request.abort();
      settle(reject, abortError());
    };

    try {
      const body = new FormData();
      body.append("file", file, String(file.name || "attachment"));
      request.open("POST", resolveStudioRequestUrl(path), true);
      request.onload = () => {
        const payload = fileUploadPayload(request);
        if (request.status >= 200 && request.status < 300) {
          if (payload && typeof payload === "object") {
            settle(resolve, payload);
            return;
          }
          settle(reject, new Error(invalid));
          return;
        }
        const error = vibe64ApiError(
          payload || {},
          `${failure} (HTTP ${request.status || "unknown"})`
        );
        error.status = Number(request.status || 0);
        error.statusCode = error.status;
        settle(reject, error);
      };
      request.onerror = () => {
        settle(reject, new Error(`${failure} Check your connection and try again.`));
      };
      request.onabort = () => {
        settle(reject, abortError());
      };
      request.ontimeout = () => {
        settle(reject, new Error(`${failure} The request timed out.`));
      };
      request.upload?.addEventListener?.("progress", progressHandler);
      signal?.addEventListener?.("abort", abortHandler, { once: true });
      if (signal?.aborted) {
        abortHandler();
        return;
      }
      request.withCredentials = true;
      request.setRequestHeader("Accept", "application/json");
      request.send(body);
    } catch (error) {
      settle(reject, error instanceof Error ? error : new Error(failure));
    }
  });
}

export { uploadFileRequest };
