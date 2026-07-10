import { computed } from "vue";
import { ROUTE_VISIBILITY_PUBLIC } from "@jskit-ai/kernel/shared/support/visibility";
import { useCommand } from "@jskit-ai/users-web/client/composables/useCommand";
import { usePaths } from "@jskit-ai/users-web/client/composables/usePaths";
import { useVibe64TerminalCommands } from "@/composables/useVibe64TerminalCommands.js";
import {
  VIBE64_API_SUFFIX,
  VIBE64_SESSIONS_API_SUFFIX,
  VIBE64_SURFACE_ID,
  vibe64AgentAttachmentPath
} from "@/lib/vibe64SessionRequestConfig.js";

function normalizeSessionId(sessionId = "") {
  return String(sessionId || "").trim();
}

function missingSessionResponse() {
  return {
    error: "Vibe64 session id is required.",
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

function useVibe64CodexCommands() {
  const paths = usePaths();
  const sessionsApiPath = computed(() => paths.api(VIBE64_SESSIONS_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const vibe64ApiPath = computed(() => paths.api(VIBE64_API_SUFFIX, {
    surface: VIBE64_SURFACE_ID
  }));
  const terminalCommands = useVibe64TerminalCommands({
    sessionsApiPath,
    vibe64ApiPath
  });

  const uploadAttachmentCommand = useCommand({
    access: "never",
    apiSuffix: VIBE64_SESSIONS_API_SUFFIX,
    buildCommandOptions: (_payload, { context }) => ({
      method: "POST",
      path: vibe64AgentAttachmentPath(sessionsApiPath.value, context.sessionId)
    }),
    buildRawPayload: (_model, { context }) => ({
      contentType: String(context.contentType || ""),
      dataBase64: String(context.dataBase64 || ""),
      fileName: String(context.fileName || "attachment")
    }),
    fallbackRunError: "Assistant attachment could not be uploaded.",
    messages: {
      error: "Assistant attachment could not be uploaded."
    },
    ownershipFilter: ROUTE_VISIBILITY_PUBLIC,
    placementSource: "vibe64.agent-attachment.upload",
    suppressSuccessMessage: true,
    surfaceId: VIBE64_SURFACE_ID,
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
      error: "Assistant attachment upload did not start.",
      ok: false
    };
  }

  return {
    closeAgentTerminal: terminalCommands.closeAgentTerminal,
    closeGlobalCodexTerminal: terminalCommands.closeGlobalCodexTerminal,
    startAgentTerminal: terminalCommands.startAgentTerminal,
    startGlobalCodexTerminal: terminalCommands.startGlobalCodexTerminal,
    uploadAttachment,
    uploadAttachmentCommand
  };
}

export {
  useVibe64CodexCommands
};
