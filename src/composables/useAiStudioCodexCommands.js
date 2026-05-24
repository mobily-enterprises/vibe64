import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import {
  AI_STUDIO_SESSIONS_API_SUFFIX,
  AI_STUDIO_SURFACE_ID,
  LOCAL_STUDIO_COMMAND_OPTIONS,
  aiStudioCodexAttachmentPath
} from "@/lib/aiStudioSessionRequestConfig.js";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function missingSessionResponse() {
  return {
    error: "AI Studio session id is required.",
    ok: false
  };
}

function arrayBufferToBase64(buffer) {
  const bytes = new Uint8Array(buffer);
  const chunkSize = 0x8000;
  const chunks = [];
  for (let index = 0; index < bytes.length; index += chunkSize) {
    chunks.push(String.fromCharCode(...bytes.subarray(index, index + chunkSize)));
  }
  return btoa(chunks.join(""));
}

async function filePayload(file) {
  const arrayBuffer = await file.arrayBuffer();
  return {
    contentType: String(file.type || ""),
    dataBase64: arrayBufferToBase64(arrayBuffer),
    fileName: String(file.name || "attachment")
  };
}

function useAiStudioCodexCommands() {
  const paths = usePaths();
  const sessionsApiPath = computed(() => paths.api(AI_STUDIO_SESSIONS_API_SUFFIX, {
    surface: AI_STUDIO_SURFACE_ID
  }));

  const uploadAttachmentCommand = useCommand({
    access: "never",
    apiSuffix: AI_STUDIO_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      options: LOCAL_STUDIO_COMMAND_OPTIONS,
      path: aiStudioCodexAttachmentPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      contentType: String(context.contentType || ""),
      dataBase64: String(context.dataBase64 || ""),
      fileName: String(context.fileName || "attachment")
    }),
    fallbackRunError: "Codex attachment could not be uploaded.",
    messages: {
      error: "Codex attachment could not be uploaded."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "ai-studio.codex-attachment.upload",
    suppressSuccessMessage: true,
    surfaceId: AI_STUDIO_SURFACE_ID,
    writeMethod: "POST"
  });

  async function uploadAttachment(sessionId = "", file = null) {
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

    const response = await uploadAttachmentCommand.run({
      ...await filePayload(file),
      sessionId: normalizedSessionId
    });
    return response || {
      error: "Codex attachment upload did not start.",
      ok: false
    };
  }

  return {
    uploadAttachment,
    uploadAttachmentCommand
  };
}

export {
  useAiStudioCodexCommands
};
