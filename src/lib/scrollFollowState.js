const DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX = 48;

function numericElementValue(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

function scrollDistanceFromBottom(element = null) {
  if (!element) {
    return 0;
  }
  return Math.max(
    0,
    numericElementValue(element.scrollHeight) -
      numericElementValue(element.scrollTop) -
      numericElementValue(element.clientHeight)
  );
}

function scrollElementNearBottom(
  element = null,
  thresholdPx = DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX
) {
  const threshold = Math.max(0, numericElementValue(thresholdPx));
  return scrollDistanceFromBottom(element) <= threshold;
}

export {
  DEFAULT_SCROLL_FOLLOW_THRESHOLD_PX,
  scrollDistanceFromBottom,
  scrollElementNearBottom
};
