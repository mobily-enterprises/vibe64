const ATTACHMENT_SECTION_HEADING = "Attached files for Codex:";

function attachmentFileName(attachment = {}) {
  return String(attachment.fileName || "attachment").trim() || "attachment";
}

function attachmentContainerPath(attachment = {}) {
  return String(attachment.containerPath || "").trim();
}

function attachmentSizeLabel(size) {
  const bytes = Number(size);
  if (!Number.isFinite(bytes) || bytes < 0) {
    return "";
  }
  if (bytes < 1024) {
    return `${bytes} B`;
  }
  if (bytes < 1024 * 1024) {
    return `${(bytes / 1024).toFixed(1)} KB`;
  }
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function promptAttachmentReference(attachment = {}) {
  const containerPath = attachmentContainerPath(attachment);
  if (!containerPath) {
    return "";
  }
  const sizeLabel = attachmentSizeLabel(attachment.size);
  const details = sizeLabel ? ` (${sizeLabel})` : "";
  return `- ${attachmentFileName(attachment)}${details}: ${containerPath}`;
}

function promptAttachmentReferences(attachments = []) {
  return attachments
    .map(promptAttachmentReference)
    .filter(Boolean);
}

function appendPromptAttachmentReferences(promptText = "", attachments = []) {
  const references = promptAttachmentReferences(attachments);
  if (references.length < 1) {
    return String(promptText || "");
  }

  const source = String(promptText || "").trimEnd();
  const sectionStartPattern = new RegExp(`(^|\\n)${ATTACHMENT_SECTION_HEADING}\\n`, "u");
  if (sectionStartPattern.test(source)) {
    return `${source}\n${references.join("\n")}`;
  }

  return [
    source,
    [
      ATTACHMENT_SECTION_HEADING,
      ...references
    ].join("\n")
  ].filter(Boolean).join("\n\n");
}

export {
  ATTACHMENT_SECTION_HEADING,
  appendPromptAttachmentReferences,
  promptAttachmentReference,
  promptAttachmentReferences
};
