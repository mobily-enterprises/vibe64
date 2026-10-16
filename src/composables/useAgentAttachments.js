import { useAssistantAttachments } from "@jskit-ai/assistant-core/client/conversation-attachments";

import { VIBE64_UPLOAD_MAX_BYTES as AGENT_ATTACHMENT_MAX_BYTES } from "@local/vibe64-core/shared";

const AGENT_ATTACHMENT_UPLOAD_CONCURRENCY = 1;

function useAgentAttachments(options = {}) {
  return useAssistantAttachments({
    ...options,
    maxBytes: AGENT_ATTACHMENT_MAX_BYTES,
    uploadConcurrency: AGENT_ATTACHMENT_UPLOAD_CONCURRENCY
  });
}

export { AGENT_ATTACHMENT_MAX_BYTES, AGENT_ATTACHMENT_UPLOAD_CONCURRENCY, useAgentAttachments };

export {
  ASSISTANT_ATTACHMENT_MAX_ITEMS as AGENT_ATTACHMENT_MAX_ITEMS,
  assistantAttachmentEventHasFiles as codexAttachmentEventHasFiles,
  assistantAttachmentFiles as codexAttachmentFiles,
  assistantAttachmentFilesFromDropEvent as codexAttachmentFilesFromDropEvent,
  assistantAttachmentFilesFromPasteEvent as codexAttachmentFilesFromPasteEvent,
  assistantAttachmentFilesFromTransferItems as codexAttachmentFilesFromTransferItems
} from "@jskit-ai/assistant-core/client/conversation-attachments";
