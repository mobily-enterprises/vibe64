const DEFAULT_READY_STATUS_CACHE_TTL_MS = 120_000;

function createReadyStatusCache({
  ttlMs = DEFAULT_READY_STATUS_CACHE_TTL_MS
} = {}) {
  let cached = null;

  function read() {
    if (!cached) {
      return null;
    }
    if (cached.expiresAt <= Date.now()) {
      cached = null;
      return null;
    }
    return cached.status;
  }

  function remember(status) {
    if (status?.ready === true) {
      cached = {
        expiresAt: Date.now() + ttlMs,
        status
      };
    } else {
      cached = null;
    }
    return status;
  }

  return Object.freeze({
    read,
    remember
  });
}

export {
  createReadyStatusCache
};
