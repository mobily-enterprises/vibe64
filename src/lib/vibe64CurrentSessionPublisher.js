function createVibe64CurrentSessionPublisher({
  onError = () => null,
  publish
} = {}) {
  if (typeof publish !== "function") {
    throw new TypeError("Current Vibe64 session publisher requires publish().");
  }

  let pendingPublication = null;
  let publicationChain = Promise.resolve();
  let lastPublishedIdentity = null;
  let stopped = false;

  function request(publication = {}) {
    if (stopped) {
      return publicationChain;
    }
    const apiPath = String(publication?.apiPath || "");
    const sessionId = String(publication?.sessionId || "").trim();
    pendingPublication = {
      apiPath,
      identity: JSON.stringify([apiPath, sessionId]),
      sessionId
    };
    publicationChain = publicationChain.catch(() => null).then(async () => {
      if (stopped || !pendingPublication) {
        return;
      }
      const publication = pendingPublication;
      pendingPublication = null;
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
