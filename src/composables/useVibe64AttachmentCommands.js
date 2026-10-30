import { computed } from "vue";
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

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

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

const ATTACHMENT_UPLOAD_MESSAGES = Object.freeze({
  cancelled: "Attachment upload was cancelled.",
  failure: "Assistant attachment could not be uploaded.",
  invalid: "Assistant attachment upload returned an invalid response."
});

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
    const normalizedSessionId = normalizeSessionId(sessionId);
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
    const normalizedSessionId = normalizeSessionId(sessionId);
    if (!normalizedSessionId) {
      return missingSessionResponse();
    }
    if (!file || typeof file.arrayBuffer !== "function") {
      return {
        error: "Attachment file is required.",
        ok: false
      };
    }
    return await uploadFileRequest({
      file,
      messages: ATTACHMENT_UPLOAD_MESSAGES,
      onProgress,
      path: vibe64AgentAttachmentPath(sessionsApiPath.value, normalizedSessionId),
      signal
    });
  }

  return { deleteAttachment, uploadAttachment };
}

export {
  useVibe64AttachmentCommands
};
