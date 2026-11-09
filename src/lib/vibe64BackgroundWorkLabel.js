/**
 * The working label of a turn whose reply is written while commands it started in the background still run. The
 * turn is still open: it can continue when they finish, and Stop ends it.
 * @param {number} [count] how many background commands run, when the engine reports it
 */
function backgroundWorkLabel(count = 0) {
  return count > 0
    ? `Still working · waiting on ${count} background ${count === 1 ? "command" : "commands"}…`
    : "Still working · waiting on background commands…";
}

export { backgroundWorkLabel };
