/**
 * The ERD's own layout worker. Each request posts one message and settles with the worker's answer, its failure or
 * a timeout after 15 seconds. Terminating it rejects every request still pending and ends the worker.
 */
function createErdLayoutWorker() {
  const worker = new Worker(new URL("./workers/erdLayout.worker.js", import.meta.url), { type: "module" });
  const layoutResolvers = new Map();
  let layoutRequestId = 0;
  worker.addEventListener("message", ({ data }) => {
    const resolver = layoutResolvers.get(data.id);
    if (!resolver) return;
    layoutResolvers.delete(data.id);
    clearTimeout(resolver.timeout);
    if (data.ok === false) resolver.reject(new Error(data.error));
    else resolver.resolve(data);
  });
  worker.addEventListener("error", (event) => {
    for (const resolver of layoutResolvers.values()) { clearTimeout(resolver.timeout); resolver.reject(new Error(event.message || "The layout worker failed.")); }
    layoutResolvers.clear();
  });

  /**
   * @param {Record<string, any>} payload
   * @returns {Promise<Record<string, any>>}
   */
  function request(payload) {
    const id = ++layoutRequestId;
    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => { layoutResolvers.delete(id); reject(new Error("The layout worker timed out.")); }, 15000);
      layoutResolvers.set(id, { resolve, reject, timeout });
      worker.postMessage({ ...payload, id });
    });
  }

  function terminate() {
    for (const resolver of layoutResolvers.values()) { clearTimeout(resolver.timeout); resolver.reject(new Error("ERD closed.")); }
    layoutResolvers.clear();
    worker.terminate();
  }

  return Object.freeze({
    request,
    terminate
  });
}

export { createErdLayoutWorker };
