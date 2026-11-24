import { computed } from "vue";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/http-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/shell-web/client/navigation/usePaths";
import {
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AgentAttachmentFilePath,
  vibe64AgentAttachmentPath
} from "@/lib/vibe64SessionRequestConfig.js";
import { uploadFileRequest } from "@/lib/vibe64FileUpload.js";
import { delay } from "@/lib/vibe64HeldRequest.js";
import { workAnswerLost } from "@/lib/vibe64SessionWorkOutcome.js";

function missingSessionResponse() {
  return {
    error: "Vibe64 session id is required.",
    ok: false
  };
}

function missingAttachmentResponse() {
  return {
    error: "Attachment id is required.",
    ok: false
  };
}

// readable-check: allow method-probe - input validation: an attachment is a File or Blob, the values that read their own bytes
function readableAttachmentFile(file) {
  return Boolean(file) && typeof file.arrayBuffer === "function";
}

const ATTACHMENT_UPLOAD_MESSAGES = Object.freeze({
  cancelled: "Attachment upload was cancelled.",
  failure: "Assistant attachment could not be uploaded.",
  invalid: "Assistant attachment upload returned an invalid response."
});

// Contention a later attempt gets past: the session's write lock, which setup preparing the workspace, Save or Update
// hold for minutes (the server waits thirty seconds for it, then refuses in the holder's words), and the attachment
// storage lock. An upload refused for either, or whose answer never came back (the hosted edge cut it, or the
// connection dropped), is sent again after these waits, the last repeating, which a cancel ends at once; an upload
// stored but never answered leaves an unsent file that expires.
const RETRYABLE_UPLOAD_REFUSALS = new Set(["vibe64_agent_write_mode_busy", "vibe64_agent_attachment_busy"]);
const UPLOAD_RETRY_DELAYS_MS = Object.freeze([1_000, 2_000, 3_000, 5_000]);
const MAX_UPLOAD_ATTEMPTS = 12;
const UPLOAD_LOST_CONTACT = "Vibe64 could not be reached to upload this attachment. Check your connection and try again.";

function retryableUploadRefusal(value) {
  return RETRYABLE_UPLOAD_REFUSALS.has(String(value?.code || ""));
}

function uploadRetryDelay(attempt, signal) {
  return delay(UPLOAD_RETRY_DELAYS_MS[Math.min(attempt, UPLOAD_RETRY_DELAYS_MS.length - 1)], signal);
}

function useVibe64AttachmentCommands() {
  const paths = usePaths();
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const deleteAttachmentCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "DELETE",
      path: vibe64AgentAttachmentFilePath(
        sessionsApiPath.value,
        context.sessionId,
        context.attachmentId
      )
    }),
    fallbackRunError: "Assistant attachment could not be removed.",
    messages: {
      error: "Assistant attachment could not be removed."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.agent-attachment.delete",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
    writeMethod: "DELETE"
  });

  async function deleteAttachment(sessionId = "", attachmentId = "") {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return missingSessionResponse();
    }
    const normalizedAttachmentId = String(attachmentId || "").trim();
    if (!normalizedAttachmentId) {
      return missingAttachmentResponse();
    }
    return await deleteAttachmentCommand.run({
      attachmentId: normalizedAttachmentId,
      sessionId: normalizedSessionId
    });
  }

  async function uploadAttachment(sessionId = "", file = null, {
    onProgress = null,
    signal = null
  } = {}) {
    const normalizedSessionId = normalizeText(sessionId);
    if (!normalizedSessionId) {
      return missingSessionResponse();
    }
    if (!readableAttachmentFile(file)) {
      return {
        error: "Attachment file is required.",
        ok: false
      };
    }
    const path = vibe64AgentAttachmentPath(sessionsApiPath.value, normalizedSessionId);
    for (let attempt = 0; ; attempt += 1) {
      const last = attempt + 1 >= MAX_UPLOAD_ATTEMPTS;
      let result;
      try {
        result = await uploadFileRequest({ file, messages: ATTACHMENT_UPLOAD_MESSAGES, onProgress, path, signal });
      } catch (error) {
        if (signal?.aborted || (!retryableUploadRefusal(error) && !workAnswerLost(error))) throw error;
        if (last) throw retryableUploadRefusal(error) ? error : new Error(UPLOAD_LOST_CONTACT);
        await uploadRetryDelay(attempt, signal);
        continue;
      }
      if (result?.ok !== false || !retryableUploadRefusal(result) || last) return result;
      await uploadRetryDelay(attempt, signal);
    }
  }

  return { deleteAttachment, uploadAttachment };
}

export {
  useVibe64AttachmentCommands
};
