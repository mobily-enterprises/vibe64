/** @typedef {import("./types.js").RepositoryUpdateProbe} RepositoryUpdateProbe */

/**
 * The repository updates capability: the update probe, and close(), which
 * stops the project watches and the probe.
 * @param {object} dependencies
 * @param {() => void} dependencies.closeWatches
 * @param {RepositoryUpdateProbe} dependencies.probe
 */
function createRepositoryUpdates({ closeWatches, probe }) {
  function close() {
    closeWatches();
    probe.close();
  }

  return Object.freeze({
    probe,
    close
  });
}

export { createRepositoryUpdates };
