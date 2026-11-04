// Screen fit, one rule for every task: a phone or a short screen gets all of it; otherwise a
// dialog with a fixed height, so a window never jumps as its content changes.
const PHONE_WIDTH = 600;
const SHORT_HEIGHT = 560;
const EXPANDED_WIDTH = 960;

/**
 * @param {number} width
 * @param {number} height
 * @returns {{ fullscreen: boolean, phone: boolean, width: string | undefined, height: string | undefined }}
 */
function aiTaskFit(width, height) {
  const phone = width < PHONE_WIDTH;
  if (phone || height < SHORT_HEIGHT) return { fullscreen: true, phone, width: undefined, height: undefined };
  return width < EXPANDED_WIDTH
    ? { fullscreen: false, phone, width: "min(92vw, 46rem)", height: "88dvh" }
    : { fullscreen: false, phone, width: "46rem", height: "min(80dvh, 46rem)" };
}

export { aiTaskFit };
