import { DESCRIPTION, last, RUN_RANGE, SERVICE_PORT } from "./base.js";
import { domainNameOf, SHARED_LABEL, tagOf } from "./names.js";

// How the Google Cloud adapter's services are reached: the firewall rules Reaches opens, the external Application
// Load Balancer before the public service, an internal passthrough load balancer before an internal group, and the
// domain's certificate (Certificate Manager, with a DNS authorisation) and address.

// A group's machine leaving (the group resized down, rolled onto a new template, deleted) gets no new requests and this
// long to finish those it has before Compute Engine deletes it; with none set, Google ends them at once. Cloud Run
// drains its own.
const DRAIN_SECONDS = 30;

function createGoogleFrontends(g) {
  const {
    orNull, orExisting, project, region, P, networkUrl, subnetUrl, compute, certificates, computeDone, operationDone, ensureCompute,
    deleteCompute
  } = g;

  // --- Firewall rules: Reaches ----------------------------------------------------------------------------------------

  /**
   * The rule letting a service's instances reach those it names on their port, made, changed or (none named) deleted:
   * from its machines' tag, or, from Cloud Run, from Cloud Run's egress subnet, as Direct VPC egress carries no tag an
   * ingress rule matches (so a Cloud Run service's rule lets every Cloud Run service of the network in).
   * @param {string} name @param {Array<{ to: string, port: number }>} connections @param {boolean} fromRun
   */
  async function putReaches(name, connections, fromRun) {
    const rule = `${name}-reaches`;
    const found = await orNull(() => compute("GET", `global/firewalls/${rule}`));
    if (connections.length === 0) {
      if (found) await deleteCompute(`global/firewalls/${rule}`);
      return;
    }
    const body = {
      name: rule, network: networkUrl, direction: "INGRESS", ...(fromRun ? { sourceRanges: [RUN_RANGE] } : { sourceTags: [tagOf(name)] }),
      targetTags: [...new Set(connections.map((one) => tagOf(last(one.to))))],
      allowed: [{ IPProtocol: "tcp", ports: [...new Set(connections.map((one) => String(one.port)))] }],
      description: JSON.stringify(connections)
    };
    await computeDone(found ? await compute("PATCH", `global/firewalls/${rule}`, { body }) : await compute("POST", "global/firewalls", { body }));
  }

  /** The connections a service's rule says it opens, those whose target is still named. */
  function connectionsOf(name, firewalls) {
    const rule = firewalls.find((one) => one.name === `${name}-reaches`);
    if (!rule) return [];
    let said = [];
    try {
      said = JSON.parse(rule.description ?? "[]");
    } catch {
      said = [];
    }
    return said.filter((one) => (rule.targetTags ?? []).includes(tagOf(last(one.to)))).map(({ to, port }) => ({ to, port }));
  }

  // --- The load balancer in front of the public service, and an internal one before a group --------------------------

  /** The external Application Load Balancer's parts for the public service, at the domain's address and certificates. */
  async function frontend(name, { group, domain, health }) {
    const domainName = domainNameOf(domain);
    let backendBody;
    if (group) {
      backendBody = {
        name: `${name}-backend`, loadBalancingScheme: "EXTERNAL_MANAGED", protocol: "HTTP", portName: "http", timeoutSec: 3600, healthChecks: [health],
        backends: [{ group, balancingMode: "UTILIZATION", capacityScaler: 1 }], connectionDraining: { drainingTimeoutSec: DRAIN_SECONDS }, description: DESCRIPTION
      };
    } else {
      const neg = await ensureCompute(`regions/${region}/networkEndpointGroups/${name}-neg`, `regions/${region}/networkEndpointGroups`, {
        name: `${name}-neg`, networkEndpointType: "SERVERLESS", cloudRun: { service: name }, description: DESCRIPTION
      });
      // A serverless backend takes no health check, balancing mode or port name; Google ignores its protocol.
      backendBody = { name: `${name}-backend`, loadBalancingScheme: "EXTERNAL_MANAGED", backends: [{ group: neg.selfLink }], description: DESCRIPTION };
    }
    const backend = await ensureCompute(`global/backendServices/${name}-backend`, "global/backendServices", backendBody);
    const map = await ensureCompute(`global/urlMaps/${name}-lb`, "global/urlMaps", { name: `${name}-lb`, defaultService: backend.selfLink, description: DESCRIPTION });
    const proxy = await ensureCompute(`global/targetHttpsProxies/${name}-https`, "global/targetHttpsProxies", {
      name: `${name}-https`, urlMap: map.selfLink, certificateMap: `//certificatemanager.googleapis.com/${P}/locations/global/certificateMaps/${domainName}`
    });
    const address = await compute("GET", `global/addresses/${domainName}`);
    await ensureCompute(`global/forwardingRules/${name}-https`, "global/forwardingRules", {
      name: `${name}-https`, IPAddress: address.address, IPProtocol: "TCP", portRange: "443", target: proxy.selfLink, loadBalancingScheme: "EXTERNAL_MANAGED", networkTier: "PREMIUM"
    });
    const redirect = await ensureCompute(`global/urlMaps/${name}-redirect`, "global/urlMaps", {
      name: `${name}-redirect`, defaultUrlRedirect: { httpsRedirect: true, redirectResponseCode: "MOVED_PERMANENTLY_DEFAULT", stripQuery: false }, description: DESCRIPTION
    });
    const http = await ensureCompute(`global/targetHttpProxies/${name}-http`, "global/targetHttpProxies", { name: `${name}-http`, urlMap: redirect.selfLink });
    await ensureCompute(`global/forwardingRules/${name}-http`, "global/forwardingRules", {
      name: `${name}-http`, IPAddress: address.address, IPProtocol: "TCP", portRange: "80", target: http.selfLink, loadBalancingScheme: "EXTERNAL_MANAGED", networkTier: "PREMIUM"
    });
  }

  /** The public service's load balancer parts, deleted in the order they depend on each other. */
  async function deleteFrontend(name) {
    for (const path of [
      `global/forwardingRules/${name}-https`, `global/forwardingRules/${name}-http`, `global/targetHttpsProxies/${name}-https`,
      `global/targetHttpProxies/${name}-http`, `global/urlMaps/${name}-lb`, `global/urlMaps/${name}-redirect`, `global/backendServices/${name}-backend`,
      `regions/${region}/networkEndpointGroups/${name}-neg`
    ]) await deleteCompute(path);
  }

  /** The internal passthrough load balancer an internal group is reached through, and its DNS name. */
  async function internalFrontend(name, { group, health }) {
    const backend = await ensureCompute(`regions/${region}/backendServices/${name}-internal`, `regions/${region}/backendServices`, {
      name: `${name}-internal`, loadBalancingScheme: "INTERNAL", protocol: "TCP", healthChecks: [health], backends: [{ group, balancingMode: "CONNECTION" }],
      connectionDraining: { drainingTimeoutSec: DRAIN_SECONDS }, description: DESCRIPTION
    });
    await ensureCompute(`regions/${region}/forwardingRules/${name}-internal`, `regions/${region}/forwardingRules`, {
      name: `${name}-internal`, loadBalancingScheme: "INTERNAL", backendService: backend.selfLink, IPProtocol: "TCP", ports: [String(SERVICE_PORT)],
      network: networkUrl, subnetwork: subnetUrl, serviceLabel: "app", description: DESCRIPTION
    });
  }
  const internalNameOf = (name) => `app.${name}-internal.il4.${region}.lb.${project}.internal`;

  // --- The domain -----------------------------------------------------------------------------------------------------

  /** The DNS records the owner adds for a domain: its DNS authorisation's CNAME, and an A record at the load balancer. */
  async function domainRecords(name) {
    const id = domainNameOf(name);
    const [authorization, address, certificate] = await Promise.all([
      orNull(() => certificates("GET", `dnsAuthorizations/${id}`)),
      orNull(() => compute("GET", `global/addresses/${id}`)),
      orNull(() => certificates("GET", `certificates/${id}`))
    ]);
    return {
      domain: name,
      certificate: certificate?.managed?.state ?? null,
      records: [
        ...(authorization?.dnsResourceRecord ? [{ name: authorization.dnsResourceRecord.name, type: authorization.dnsResourceRecord.type, data: authorization.dnsResourceRecord.data }] : []),
        ...(address?.address ? [{ name: `${name}.`, type: "A", data: address.address }] : [])
      ]
    };
  }

  /** Covers a domain: its DNS authorisation, managed certificate, certificate map and entry, and the load balancer's address. */
  async function ensureDomain(name) {
    const id = domainNameOf(name);
    const labels = { [SHARED_LABEL]: "domain" };
    const ensure = async (path, collection, idName, body) => {
      if (await orNull(() => certificates("GET", path))) return;
      const operation = await orExisting(() => certificates("POST", collection, { query: { [idName]: id }, body: { ...body, labels } }));
      if (operation) await operationDone("certificatemanager", "v1", operation);
    };
    await ensure(`dnsAuthorizations/${id}`, "dnsAuthorizations", "dnsAuthorizationId", { domain: name });
    await ensure(`certificates/${id}`, "certificates", "certificateId", { managed: { domains: [name], dnsAuthorizations: [`${P}/locations/global/dnsAuthorizations/${id}`] } });
    await ensure(`certificateMaps/${id}`, "certificateMaps", "certificateMapId", {});
    await ensure(`certificateMaps/${id}/certificateMapEntries/${id}`, `certificateMaps/${id}/certificateMapEntries`, "certificateMapEntryId", {
      hostname: name, certificates: [`${P}/locations/global/certificates/${id}`]
    });
    await ensureCompute(`global/addresses/${id}`, "global/addresses", { name: id, ipVersion: "IPV4", description: DESCRIPTION });
    return domainRecords(name);
  }

  return { putReaches, connectionsOf, frontend, deleteFrontend, internalFrontend, internalNameOf, domainRecords, ensureDomain };
}

export { createGoogleFrontends };
