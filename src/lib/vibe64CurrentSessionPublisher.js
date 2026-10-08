function createVibe64CurrentSessionPublisher({
  coalesceByPath = false,
  onError = () => null,
  publish
} = {}) {
  if (typeof publish !== "function") {
    throw new TypeError("Current Vibe64 session publisher requires publish().");
  }

  const pendingPublications = new Map();
  let publicationChain = Promise.resolve();
  let lastPublishedIdentity = null;
  let stopped = false;

  function request(publication = {}) {
    if (stopped) {
      return publicationChain;
    }
    const apiPath = String(publication?.apiPath || "");
    const sessionId = String(publication?.sessionId || "").trim();
    const publicationKey = (typeof coalesceByPath === "function" ? coalesceByPath() : coalesceByPath) ? apiPath : "";
    pendingPublications.set(publicationKey, {
      apiPath,
      identity: JSON.stringify([apiPath, sessionId]),
      sessionId
    });
    publicationChain = publicationChain.catch(() => null).then(async () => {
      if (stopped || pendingPublications.size === 0) {
        return;
      }
      const [key, publication] = pendingPublications.entries().next().value;
      pendingPublications.delete(key);
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
    pendingPublications.clear();
  }

  return Object.freeze({
    request,
    stop
  });
}

export {
  createVibe64CurrentSessionPublisher
};
