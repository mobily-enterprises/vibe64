import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";

// Saves a blob as a file named fileName through a temporary blob link.
function saveBlobAsFile(blob, fileName) {
  const objectUrl = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = objectUrl;
  anchor.download = fileName;
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(objectUrl), 1000);
}

// The JSON HTTP client cannot return binary bodies, so attachments are fetched
// directly with the same cookie authentication and saved through a blob link.
async function downloadAttachment(url, fileName, fallbackMessage = "Download failed.") {
  const response = await fetch(url, { credentials: "include" });
  if (!response.ok || !response.headers.get("content-disposition")?.startsWith("attachment;")) {
    throw new Error(vibe64ApiResponseError(await response.json().catch(() => ({})), fallbackMessage));
  }
  saveBlobAsFile(await response.blob(), fileName);
}

export { downloadAttachment, saveBlobAsFile };
