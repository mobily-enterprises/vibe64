/** A publication that failed is dropped; the next request publishes again. */
function ignorePublicationError() {}

/**
 * Publishes the person's current session, one publication at a time, skipping one that repeats the last published.
 * @param {{
 *   onError?: (error: unknown, publication: { apiPath: string, identity: string, sessionId: string }) => void,
 *   publish: (publication: { apiPath: string, sessionId: string }) => Promise<void>
 * }} options
 */
function createVibe64CurrentSessionPublisher({
  onError = ignorePublicationError,
  publish
}) {
  let pendingPublication = null;
  let publicationChain = Promise.resolve();
  let lastPublishedIdentity = null;
  let stopped = false;

  function request(publication = {}) {
    if (stopped) {
      return publicationChain;
    }
    const apiPath = String(publication.apiPath || "");
    const sessionId = String(publication.sessionId || "").trim();
    pendingPublication = {
      apiPath,
      identity: JSON.stringify([apiPath, sessionId]),
      sessionId
    };
    publicationChain = publicationChain.catch(() => null).then(async () => {
      const publication = pendingPublication;
      pendingPublication = null;
      if (stopped || !publication) {
        return;
      }
      if (publication.identity === lastPublishedIdentity) {
        return;
      }
      try {
        await publish({
          apiPath: publication.apiPath,
          sessionId: publication.sessionId
        });
        lastPublishedIdentity = publication.identity;
      } catch (error) {
        onError(error, publication);
      }
    });
    return publicationChain;
  }

  function stop() {
    stopped = true;
    pendingPublication = null;
  }

  return Object.freeze({
    request,
    stop
  });
}

export {
  createVibe64CurrentSessionPublisher
};
