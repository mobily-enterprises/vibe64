/** A positive finite number, or 0 for anything else (a missing size, NaN, a negative offset). */
function positiveNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export { positiveNumber };
