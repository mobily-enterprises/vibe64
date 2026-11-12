/**
 * How long something has run, as a person reads it: whole seconds under a minute ("41 s"), whole minutes under an
 * hour ("2 min"), then hours and minutes ("1 h 5 min"). A time before its start reads as none.
 * @param {number} ms
 */
function elapsedText(ms) {
  const seconds = Math.max(0, Math.floor(ms / 1_000));
  if (seconds < 60) return `${seconds} s`;
  const minutes = Math.floor(seconds / 60);
  return minutes < 60 ? `${minutes} min` : `${Math.floor(minutes / 60)} h ${minutes % 60} min`;
}

export { elapsedText };
