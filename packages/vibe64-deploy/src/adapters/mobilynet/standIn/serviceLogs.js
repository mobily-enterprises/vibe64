// An App Service instance's logs as mobilynet's stand-in answers them (openApiServices.js readServiceLogs, its machines
// package's serviceLogs.js): read from the instance's host by an operation, so the first ask answers `202` with the
// operation running, and once the stand-in moved on (`advance()`) the same ask answers `200` with the lines, the last
// `lines` of them (200 when absent), each of the service's secrets masked as `[secret]`. An instance's logs are readable
// while it lives and for 7 days after it is removed. What an instance printed is a test's (`set`), else one line naming
// its start.
// STAND-IN ONLY: `unit` and `since` only tell one ask from another; every line is the instance's, whatever its unit.

/**
 * @param {{ failure: Function, answer: Function, nextId: (prefix: string) => string, at: () => string, now: () => Date }} world
 * @param {Map<string, any>} instances each instance of the stand-in's App Services, by id
 */
function createStandInServiceLogs({ failure, answer, nextId, at, now }, instances) {
  /** @type {Map<string, string>} each instance's output, as a test sets it */
  const outputs = new Map();
  /** @type {Map<string, any>} each read asked, by what it asked: its operation, running until the stand-in moves on */
  const reads = new Map();

  /** `GET /v1/services/{id}/logs`. @param {any} service @param {URLSearchParams} params */
  function read(service, params) {
    const instanceId = params.get("instance") ?? "";
    if (!instanceId) return failure(422, "validation_failed", "Check instance.", { fieldErrors: { instance: "The instance's id." } });
    const instance = instances.get(instanceId);
    const kept = instance?.rotation !== "gone" || Date.parse(instance.logsUntil) > now().getTime();
    if (!instance || instance.serviceId !== service.id || !kept) return failure(404, "not_found", "No such instance.");
    const lines = Number(params.get("lines") ?? 200);
    const asked = [instanceId, params.get("unit") ?? "", params.get("since") ?? "", lines].join(" ");
    const operation = reads.get(asked) ?? { id: nextId("op"), kind: "app_logs", state: "running", error: null, createdAt: at(), finishedAt: null };
    reads.set(asked, operation);
    if (operation.state === "running") return answer(202, { instance: instanceId, logs: null, operation: { ...operation } });
    let text = outputs.get(instanceId) ?? `${instance.name}: started ${instance.version}\n`;
    for (const value of Object.values(service.secrets ?? {})) if (value) text = text.split(String(value)).join("[secret]");
    const all = text.endsWith("\n") ? text.slice(0, -1).split("\n") : text.split("\n");
    const tail = all.slice(-lines).join("\n") + (text.endsWith("\n") ? "\n" : "");
    return answer(200, { instance: instanceId, logs: tail, readAt: at(), operation: { ...operation } });
  }

  /** Every read asked so far ends: its next ask answers the lines. */
  function advance() {
    for (const operation of reads.values()) {
      if (operation.state === "running") Object.assign(operation, { state: "succeeded", finishedAt: at() });
    }
  }

  return Object.freeze({
    read,
    advance,
    /** What an instance printed. @param {string} instanceId @param {string} text */
    set: (instanceId, text) => {
      outputs.set(instanceId, String(text));
    }
  });
}

export { createStandInServiceLogs };
