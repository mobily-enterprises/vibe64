// Where the Preview toolbar sits: left, center or right of the Preview.
const LAUNCH_PREVIEW_TOOLBAR_POSITIONS = Object.freeze(["left", "center", "right"]);

function normalizeLaunchPreviewToolbarPosition(value = "") {
  const normalized = String(value || "").trim();
  return LAUNCH_PREVIEW_TOOLBAR_POSITIONS.includes(normalized) ? normalized : "center";
}

function nextLaunchPreviewToolbarPosition(currentPosition = "center", direction = 0) {
  const currentIndex = LAUNCH_PREVIEW_TOOLBAR_POSITIONS.indexOf(
    normalizeLaunchPreviewToolbarPosition(currentPosition)
  );
  const nextIndex = Math.min(
    LAUNCH_PREVIEW_TOOLBAR_POSITIONS.length - 1,
    Math.max(0, currentIndex + Math.sign(Number(direction) || 0))
  );
  return LAUNCH_PREVIEW_TOOLBAR_POSITIONS[nextIndex] || "center";
}

export {
  nextLaunchPreviewToolbarPosition,
  normalizeLaunchPreviewToolbarPosition
};
