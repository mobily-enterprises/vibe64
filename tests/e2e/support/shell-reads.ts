/**
 * The reads the editor shell makes on every page, whatever the scenario, answered as nothing to show: no crash that
 * nobody acknowledged, and no planned restart. Every mock layer that refuses requests it does not list (the assistant
 * status server, the integration shell mocks and the self-contained smoke) answers these from here, so a read the
 * shell adds is answered once, for every spec. Paths are under /api, as `routeApiEndpoint` takes them.
 */
const SHELL_READS = Object.freeze([
  ["/studio/health/crashes/summary", { ok: true, canAcknowledge: true, unacknowledged: 0, latest: null }],
  ["/studio/health/planned-restart", { ok: true, active: null, restarted: null }]
] as const);

export { SHELL_READS };
