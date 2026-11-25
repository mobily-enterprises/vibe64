// What a Deploy and a Take offline say as they go (steps.js): each step in the engine's own words, the event a report
// gets of it, and the caller's report itself, stamped with the time and never failing the run it reports on. A report
// names the step, the service or resource and the refresh it started, never a setting's value.
import { namesWords } from "./address.js";
import { MIGRATING } from "./migrations.js";

/**
 * What a step does, in the words a person reads in a Deploy's log: the step and the service or resource it is for.
 * @param {any} step nextStep's step @param {{ needs?: any, release?: { domain?: string, aliases?: string[] } }} [context]
 */
function stepWords(step, { needs, release } = {}) {
  const exposure = needs?.services.find((one) => one.id === step.service)?.exposure;
  const others = release?.aliases?.length > 0 ? `, with ${namesWords(release.aliases)}` : "";
  switch (step.kind) {
    case "createResource": return `Making the hosted service for ${step.resource}`;
    case "resizeResource": return `Resizing the hosted service of ${step.resource} to ${step.size}`;
    case "adopt": return `Taking up ${step.item === "service" ? "App Service" : "the hosted service of"} ${step.name}, made by a Deploy cut short`;
    case "ensureDomain": return step.alias
      ? `Adding ${step.domain}, which sends people to ${release?.domain ?? "the domain"}`
      : `Adding the domain ${step.domain}`;
    case "uploadRelease": return `Uploading the release of ${step.service}`;
    case "shareRelease": return `${step.service} takes the release uploaded for ${step.from}: one build of one source, built once`;
    case "keepRelease": return `${step.service} keeps the release it runs: the same commit, Stack and engine`;
    case "releaseService": return `Handing App Service ${step.service} the new release${step.task ? MIGRATING : ""}`;
    case "createService": return step.replaces
      ? `Making App Service ${step.service} again on its build's app, beside the one that runs now (${step.replaces.providerName}), which serves until it does`
        + (step.task ? MIGRATING : "")
      : (exposure !== "public"
      ? `Making App Service ${step.service}, internal: only the app's other services reach it`
      : step.withoutDomain
        ? `Making App Service ${step.service}, public behind the load balancer: it takes ${release?.domain ?? "its domain"} from ${step.withoutDomain} once healthy${others}`
        : `Making App Service ${step.service}, public behind the load balancer at ${release?.domain ?? "its domain"}${others}`) + (step.task ? MIGRATING : "");
    case "link": return `Linking ${step.service} to ${step.resource}`;
    case "checkRefresh": return `Reading how the update of ${step.service} ended`;
    case "unlink": return `Unlinking ${step.resource}, no longer in genesis/stack.md, from ${step.service}`;
    case "putSettings": return `Updating the settings of ${step.service}`;
    case "changeService": {
      const { change } = step;
      if (change.connections) return `Updating the services ${step.service} reaches`;
      return `Resizing App Service ${step.service} to ${change.size}`;
    }
    case "takeDomain": {
      const aliases = step.aliases ?? [];
      if (!step.from) return `Routing ${namesWords([step.domain, ...aliases.map((one) => one.host)])} to App Service ${step.service}`;
      const moved = [step.domain, ...aliases.filter((one) => one.take).map((one) => one.host)];
      const routed = aliases.filter((one) => !one.take).map((one) => one.host);
      return `Moving ${namesWords(moved)} from App Service ${step.from} to ${step.service}, at the same DNS target${moved.length > 1 ? "s" : ""}`
        + (routed.length > 0 ? `, and routing ${namesWords(routed)} to it` : "");
    }
    case "deleteReplaced": return `Deleting ${step.providerName}, the App Service ${step.service} ran before: the new one serves`;
    case "deleteService": return step.replaced
      ? `Deleting App Service ${step.service}, to make it again: its exposure changed`
      : `Deleting App Service ${step.service}, no longer in genesis/stack.md`;
    default: return step.kind;
  }
}

/**
 * The caller's report, stamped with the time, never failing the run: a report that throws or rejects is ignored.
 * @param {(event: any) => unknown} report
 */
function reporterOf(report) {
  return (event) => {
    try {
      const answered = report({ at: new Date().toISOString(), ...event });
      if (typeof answered?.catch === "function") answered.catch(() => {});
    } catch {
      // A report is the caller's: it never stops the run it reports on.
    }
  };
}

/**
 * What a report says of a step: its kind, the service or resource it is for, its words, and the refresh it started or
 * read (`{ serviceId, refreshId }`); never its values.
 * @param {any} step @param {string} words @param {any} [record] the record after the step, for the refresh it started
 */
function stepEvent(step, words, record = null) {
  const event = { kind: "step", step: step.kind, words, ...(step.service ? { service: step.service } : {}), ...(step.resource ? { resource: step.resource } : {}) };
  if (step.kind === "checkRefresh") return { ...event, refresh: { serviceId: step.id, refreshId: step.refreshId } };
  const refreshId = step.service ? record?.run.services[step.service]?.refreshId : null;
  const serviceId = step.service ? record?.items[`service.${step.service}`]?.id : null;
  return refreshId && serviceId ? { ...event, refresh: { serviceId, refreshId } } : event;
}

/** Text ending as a sentence ends, its own full stop kept. @param {string} text */
const sentence = (text) => (/[.!?]$/u.test(text.trim()) ? text.trim() : `${text.trim()}.`);

export { reporterOf, sentence, stepEvent, stepWords };
