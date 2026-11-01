const VIBE64_CONVERSATION_ATTACHMENT_MAX_ITEMS = 10;
const VIBE64_CONVERSATION_ATTACHMENT_FILE_NAME_MAX_CHARACTERS = 160;
const ATTACHMENT_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const IMAGE_TYPES = Object.freeze({
  avif: "image/avif",
  bmp: "image/bmp",
  gif: "image/gif",
  jpeg: "image/jpeg",
  jpg: "image/jpeg",
  png: "image/png",
  webp: "image/webp"
});

function conversationAttachmentContentType(fileName = "") {
  const extension = String(fileName).split(".").at(-1).toLowerCase();
  return Object.hasOwn(IMAGE_TYPES, extension) ? IMAGE_TYPES[extension] : "application/octet-stream";
}

function conversationAttachmentReference(attachment = {}, number = 1) {
  const kind = conversationAttachmentContentType(attachment.fileName).startsWith("image/") ? "Image" : "File";
  return `[${kind} #${number}]`;
}

function conversationAttachmentFileName(value = "") {
  const normalized = Array.from(String(value ?? ""), (character) => {
    const codePoint = character.codePointAt(0);
    return codePoint <= 31 || codePoint === 127 ? " " : character;
  }).join("").trim();
  return Array.from(normalized)
    .slice(0, VIBE64_CONVERSATION_ATTACHMENT_FILE_NAME_MAX_CHARACTERS)
    .join("");
}

function normalizeVibe64ConversationAttachments(value = []) {
  return (Array.isArray(value) ? value : [])
    .slice(0, VIBE64_CONVERSATION_ATTACHMENT_MAX_ITEMS)
    .map((candidate) => {
      if (
        !candidate ||
        typeof candidate !== "object" ||
        Array.isArray(candidate) ||
        typeof candidate.fileName !== "string"
      ) {
        return null;
      }
      const fileName = conversationAttachmentFileName(candidate.fileName);
      if (!fileName) {
        return null;
      }
      return {
        ...(ATTACHMENT_ID_PATTERN.test(String(candidate.attachmentId || ""))
          ? { attachmentId: candidate.attachmentId }
          : {}),
        ...(/^\[(?:Image|File) #[1-9][0-9]{0,3}\]$/u.test(candidate.reference || "")
          ? { reference: candidate.reference }
          : {}),
        fileName,
        ...(Number.isSafeInteger(candidate.size) && candidate.size >= 0
          ? { size: candidate.size }
          : {})
      };
    })
    .filter(Boolean);
}

export {
  conversationAttachmentContentType,
  conversationAttachmentReference,
  normalizeVibe64ConversationAttachments
};
