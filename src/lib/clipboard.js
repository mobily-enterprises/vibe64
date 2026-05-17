function fallbackCopyText(value) {
  if (typeof document === "undefined") {
    return false;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "readonly");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.append(textarea);
  textarea.select();
  const copied = document.execCommand("copy");
  textarea.remove();
  return copied;
}

async function writeClipboardText(value) {
  const text = String(value || "");
  if (!text) {
    return false;
  }
  if (typeof navigator !== "undefined" && navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(text);
    return true;
  }
  if (fallbackCopyText(text)) {
    return true;
  }
  throw new Error("Clipboard API is unavailable.");
}

export {
  writeClipboardText
};
