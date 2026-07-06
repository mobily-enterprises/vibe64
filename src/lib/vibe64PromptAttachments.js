const ATTACHMENT_SECTION_HEADING = "Attached files for Codex:";

function attachmentFileName(attachment = {}) {
  return String(attachment.fileName || "attachment").trim() || "attachment";
}

function attachmentPath(attachment = {}) {
  return String(attachment.path || "").trim();
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
  const codexPath = attachmentPath(attachment);
  if (!codexPath) {
    return "";
  }
  const sizeLabel = attachmentSizeLabel(attachment.size);
  const details = sizeLabel ? ` (${sizeLabel})` : "";
  return `- ${attachmentFileName(attachment)}${details}: ${codexPath}`;
}

function promptAttachmentReferences(attachments = []) {
  return attachments
    .map(promptAttachmentReference)
    .filter(Boolean);
}

function promptAttachmentFileNames(attachments = []) {
  return attachments
    .map(attachmentFileName)
    .filter(Boolean);
}

function escapeRegExp(value = "") {
  return String(value || "").replace(/[.*+?^${}()|[\]\\]/gu, "\\$&");
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

function appendPromptAttachmentFileNames(promptText = "", attachments = []) {
  const fileNames = promptAttachmentFileNames(attachments);
  if (fileNames.length < 1) {
    return String(promptText || "");
  }

  return [
    String(promptText || "").trimEnd(),
    fileNames.join("\n")
  ].filter(Boolean).join("\n\n");
}

function removePromptAttachmentReferences(promptText = "", attachments = []) {
  const references = new Set(promptAttachmentReferences(attachments));
  if (references.size < 1) {
    return String(promptText || "");
  }

  const textWithoutReferences = String(promptText || "")
    .split("\n")
    .filter((line) => !references.has(line.trimEnd()))
    .join("\n");
  const trailingEmptySectionPattern = new RegExp(
    `\\n{0,2}${escapeRegExp(ATTACHMENT_SECTION_HEADING)}\\n*$`,
    "u"
  );
  return textWithoutReferences.replace(trailingEmptySectionPattern, "").trimEnd();
}

export {
  ATTACHMENT_SECTION_HEADING,
  appendPromptAttachmentFileNames,
  appendPromptAttachmentReferences,
  promptAttachmentFileNames,
  promptAttachmentReference,
  promptAttachmentReferences,
  removePromptAttachmentReferences
};
