// Add a service: what a session's Stack can add, and adding one. Add writes
// genesis/stack.md in the session (vibe64.project.stack.services.add); the
// add-service AI task then connects the app to it in that session.
import { ref } from "vue";
import { getHttpWebClient } from "@jskit-ai/http-web/client/lib/httpClient";
import { vibe64ApiResponseError } from "@/lib/vibe64ApiResponses.js";
import { scopedDevelopmentApiUrl } from "@/lib/studioUrls.js";
import { DEPLOYMENT_SERVICE_ID } from "@local/vibe64-genesis/shared/deploymentServiceNames";

const SESSIONS = "/api/vibe64/sessions";
const KIND_LABELS = Object.freeze({
  postgresql: "PostgreSQL database",
  mysql: "MySQL database",
  redis: "Redis",
  bucket: "Files bucket",
  service: "Another App Service"
});
const SERVER_NAMES = Object.freeze({ postgresql: "PostgreSQL", mysql: "MySQL", redis: "Redis" });
const NEEDS_AI_NOTE = "Vibe64 has no ready entry for this stack: the AI declares it";
const SERVICE_ID_RULE = "Lowercase letters, digits and dashes, starting with a letter, up to 16 characters.";

/**
 * A project-scoped request that answers the route's body or throws its refusal.
 * @param {string} projectSlug
 */
function scopedRequest(projectSlug) {
  return async (path, { method = "GET", body } = {}) => {
    const answer = await getHttpWebClient().request(scopedDevelopmentApiUrl(path, projectSlug), {
      method,
      ...(body === undefined ? {} : { body })
    });
    if (answer?.ok === false) {
      throw Object.assign(new Error(vibe64ApiResponseError(answer, "Add a service failed.")), { code: answer.code });
    }
    return answer;
  };
}

function sessionPath(sessionId, suffix) {
  return `${SESSIONS}/${encodeURIComponent(sessionId)}${suffix}`;
}

/** "A, B, C (or D)": the preferred Env names, then each alternative's. */
function envNamesText({ bindings = {}, alternatives = [] }) {
  const preferred = Object.values(bindings).sort().join(", ");
  const others = alternatives.map((entry) => Object.values(entry).sort().join(", ")).filter(Boolean);
  return others.length > 0 ? `${preferred} (or ${others.join(" or ")})` : preferred;
}

function previewText(choice, managed) {
  if (choice.kind === "service") return "Runs in Preview only if the AI also declares it for Preview";
  if (choice.kind === "bucket") return "The app's own storage, until you enter the bucket's settings in Env";
  const server = SERVER_NAMES[choice.kind];
  if (!managed) return `Your own ${server} server, from the values in Env`;
  return choice.kind === "redis" ? "A Redis server Vibe64 provides for this project" : `A ${server} database Vibe64 provides for this project`;
}

/**
 * One row per kind, as the dialog shows it. `refusals` are a host's own reasons a kind can't be added there.
 * @param {{ managed?: boolean, choices?: object[] } | null} answer
 * @param {Record<string, string>} [refusals]
 */
function stackServiceRows(answer, refusals = {}) {
  return (answer?.choices || []).map((choice) => {
    const reason = choice.refused || refusals[choice.kind] || "";
    const names = envNamesText(choice);
    return {
      ...choice,
      label: KIND_LABELS[choice.kind] || choice.kind,
      disabled: Boolean(reason),
      reason,
      appGets: choice.kind === "service"
        ? "An internal service the others reach by the Env name the AI gives its address"
        : names || "The Env names your app's framework reads, which the AI declares",
      previewGets: previewText(choice, answer.managed === true),
      note: !reason && choice.needsAi && choice.kind !== "service" ? NEEDS_AI_NOTE : "",
      // genesis verify counts every declared resource as required, a bucket without its settings too.
      caveat: !reason && choice.kind === "bucket"
        ? "Until the bucket's settings are in Env, `genesis verify` reports the project blocked on them."
        : ""
    };
  });
}

/** Why a new service name can't be used, or "". */
function serviceNameRefusal(name, services = []) {
  if (!name) return "";
  // The server checks it again.
  if (!DEPLOYMENT_SERVICE_ID.test(name)) return SERVICE_ID_RULE;
  return services.some(({ id }) => id === name) ? `This Deployment already has a service named ${name}.` : "";
}

/**
 * The session's choices and the two calls Add makes: write the Stack, then start the AI task in that session.
 * @param {{ projectSlug: () => string, request?: (path: string, options?: { method?: string, body?: object }) => Promise<any> }} options
 */
function useVibe64StackServices({ projectSlug, request }) {
  const send = (path, options) => (request || scopedRequest(projectSlug()))(path, options);
  const answer = ref(null);
  const loading = ref(false);
  const loadError = ref("");
  let reading = "";

  /** @param {string} sessionId */
  async function load(sessionId) {
    reading = sessionId;
    loading.value = true;
    loadError.value = "";
    try {
      const read = await send(sessionPath(sessionId, "/stack/service-choices"));
      if (reading === sessionId) answer.value = read;
    } catch (error) {
      if (reading === sessionId) {
        answer.value = null;
        loadError.value = error?.message || "The session's Stack could not be read.";
      }
    } finally {
      if (reading === sessionId) loading.value = false;
    }
    return answer.value;
  }

  /**
   * @param {string} sessionId
   * @param {{ kind: string, serviceId?: string, reachedBy?: string }} body
   */
  function add(sessionId, body) {
    return send(sessionPath(sessionId, "/stack/services"), { method: "POST", body });
  }

  /**
   * Starts the AI task Add answered, in that session.
   * @param {string} sessionId
   * @param {{ kind: string, input: object }} aiTask
   */
  async function startTask(sessionId, aiTask) {
    return (await send(sessionPath(sessionId, "/ai-tasks"), { method: "POST", body: { kind: aiTask.kind, input: aiTask.input } })).task;
  }

  return { add, answer, load, loadError, loading, startTask };
}

export { KIND_LABELS, serviceNameRefusal, stackServiceRows, useVibe64StackServices };
