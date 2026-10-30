// Image types Files shows in place. The server sends these with their real
// content type for an inline preview; the browser shows them only as images.
const FILE_PREVIEW_IMAGE_TYPES = Object.freeze({
  avif: "image/avif", bmp: "image/bmp", gif: "image/gif", ico: "image/x-icon",
  jpeg: "image/jpeg", jpg: "image/jpeg", png: "image/png", svg: "image/svg+xml", webp: "image/webp"
});

function filePreviewImageType(fileName = "") {
  const name = String(fileName || "").split("/").at(-1);
  const extension = name.includes(".") ? name.split(".").at(-1).toLowerCase() : "";
  return Object.hasOwn(FILE_PREVIEW_IMAGE_TYPES, extension) ? FILE_PREVIEW_IMAGE_TYPES[extension] : "";
}

export { FILE_PREVIEW_IMAGE_TYPES, filePreviewImageType };
