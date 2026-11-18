import { AppError } from "@jskit-ai/kernel/server/runtime";
import { normalizeText } from "@jskit-ai/kernel/shared/support/normalize";
import { STACK_SERVICE_KINDS, serviceRefusal } from "@local/vibe64-project/server/stackServices";
import { setupCheckResult } from "./workspaceSetup.js";

/** @typedef {import("../types.js").AiTaskKind} AiTaskKind */
/** @typedef {import("../types.js").AiTaskProblem} AiTaskProblem */
/** @typedef {import("@local/vibe64-project/server/types").ProjectService} ProjectService */
/** @typedef {import("@local/vibe64-sessions/server/types").SessionsService} SessionsService */
/** @typedef {import("@local/vibe64-terminals/server/types").TerminalsService} TerminalsService */

const ANOTHER_SERVICE = "service";
const NO_SAVE = "Do not commit, push or save.";
const RESOURCE_HANDOFF = [
  `${NO_SAVE} Return kind=complete with what you changed: Vibe64 then prepares the workspace, restarts Preview and returns any failure to this conversation.`,
  "Use kind=question only for what only the person knows."
].join(" ");
const SERVICE_HANDOFF = [
  `${NO_SAVE} Return kind=complete with what you changed: Vibe64 then reads the Deployment and returns any failure to this conversation.`,
  "Use kind=question only for what only the person knows."
].join(" ");
const KEEP_DECLARATION = "Do not change the resource's declaration in `## Resources`.";
const NO_VALUES = "Vibe64 gives the app its values from the Env wherever it runs. Never write a value of it into a file.";
// What the AI binds when it declares a kind the catalogue has no piece for: each semantic to the Env name the app
// already reads (`<ENV>`), the preferred alternative first.
const ENV = "<ENV>";
const DATABASE_ALTERNATIVES = [
  {
    bindings: { database: ENV, host: ENV, password: ENV, port: ENV, username: ENV },
    preferred: true
  },
  { bindings: { url: ENV } }
];
const DECLARED_ALTERNATIVES = Object.freeze({
  bucket: [
    {
      bindings: { accessKeyId: ENV, bucket: ENV, endpoint: ENV, region: ENV, secretAccessKey: ENV },
      allowEmpty: ["endpoint"],
      preferred: true
    }
  ],
  mysql: DATABASE_ALTERNATIVES,
  postgresql: DATABASE_ALTERNATIVES,
  redis: [{ bindings: { url: ENV }, preferred: true }]
});

/** "A, B and C". */
function listed(names) {
  return names.length > 1 ? `${names.slice(0, -1).join(", ")} and ${names.at(-1)}` : names.join("");
}

/** What the app receives: the preferred alternative's Env names, then each other alternative's. */
function receivedAs({ bindings, alternatives }) {
  const preferred = listed(Object.values(bindings).sort());
  const others = alternatives.map((entry) => listed(Object.values(entry).sort())).filter(Boolean);
  return others.length > 0 ? `${preferred} (preferred) or ${others.join(" or ")}` : preferred;
}

/** How the app uses each kind, beside the component's own Guidance. */
function kindGuidance(kind) {
  if (kind === "redis") {
    return ["- Use the framework's own Redis client at one boundary, with a key prefix and a time to live as the component's Guidance says."];
  }
  if (kind === "bucket") {
    return [
      "- Use the framework's own file storage, saving, reading and removing files by key.",
      "- Until the person enters the bucket's settings in Env, development keeps the app's own default storage and `genesis verify` reports the bucket's values missing. That is expected: never fill them in a file."
    ];
  }
  return [
    "- Use the framework's own database client and migration lifecycle. Add migrations only for what the app needs now, and keep the seed idempotent.",
    "- Declare database preparation in `## Workspace setup` and the Deployment's Migrate step, only as commands the app itself provides. Exact grammar: `vibe64-helper spec workspace-setup`, `vibe64-helper spec deployment`."
  ];
}

/** The brief's opening: the resource Add declared, or the one the AI declares first. */
function resourceOpening({ kind, resourceId, piece, declared, bindings, alternatives }) {
  if (declared) {
    return [
      `genesis/stack.md now declares resource \`${resourceId}\` (${kind})${piece ? ` through Stack component \`${piece}\`` : ""}.`,
      `The app receives its values as ${receivedAs({ bindings, alternatives })}. Connect the application to it in this session:`
    ].join(" ");
  }
  const block = JSON.stringify({ id: resourceId, kind, environmentAlternatives: DECLARED_ALTERNATIVES[kind] }, null, 2);
  return [
    `Declare resource \`${resourceId}\` (kind \`${kind}\`) in \`## Resources\`, as one fenced \`json genesis-resource\` block binding each semantic to the Env name the app reads (keep only the alternatives the app supports):`,
    `\`\`\`json genesis-resource\n${block}\n\`\`\``,
    "Then connect the application to it in this session:"
  ].join("\n\n");
}

function resourceBrief({ facts }) {
  const { kind, piece, declared } = facts;
  const opening = resourceOpening(facts);
  return [
    opening,
    [
      `- Read \`genesis context\` for the paths you change, and follow ${piece ? "the component's Guidance and Adoption" : "the Stack's Guidance"}.`,
      ...kindGuidance(kind),
      ...(kind === "bucket" || kind === "redis"
        ? ["- Declare any preparation the app needs in `## Workspace setup`, only as commands the app itself provides. Exact grammar: `vibe64-helper spec workspace-setup`, `vibe64-helper spec deployment`."]
        : []),
      `- ${declared ? KEEP_DECLARATION : "Declare only this resource; leave the other declarations in `## Resources` as they are."} ${NO_VALUES}`,
      `- ${RESOURCE_HANDOFF}`
    ].join("\n")
  ].join("\n\n");
}

function serviceBrief({ facts }) {
  const { serviceId, reachedBy } = facts;
  return [
    `Add \`### Service \`${serviceId}\`: <summary>\` to \`## Deployment\` (exact grammar: \`vibe64-helper spec deployment\`):`,
    [
      "- `- Exposure: `internal``, with its Serve command and Ready check taken from this app's own code, never guessed, and its Instances.",
      "- If `## Deployment` has no `### Service` heading yet, first move its Serve, Ready when, Instances and Sandbox allows lines, unchanged, under `### Service `web`: <summary>` with `- Exposure: `public``.",
      ...(reachedBy ? [`- On \`${reachedBy}\`: \`- Reaches: \`${serviceId}\` as \`<ENV>\`\`, the Env name the app reads for its address.`] : []),
      "- Never add or change `- Sandbox allows:`.",
      "- If Preview should run it, declare it as an Output or a Project service as that grammar allows.",
      `- ${SERVICE_HANDOFF}`
    ].join("\n")
  ].join("\n\n");
}

function addServiceContext({ facts }) {
  return facts.kind === ANOTHER_SERVICE
    ? ["Never add or change `- Sandbox allows:`.", SERVICE_HANDOFF].join("\n")
    : [facts.declared ? KEEP_DECLARATION : "", NO_VALUES, RESOURCE_HANDOFF].filter(Boolean).join("\n");
}

function retryMessage(diagnostic) {
  return [
    "Vibe64 checked your work, and it does not pass yet. Your edits remain: repair only what still fails.",
    `Latest check:\n${diagnostic}`,
    NO_SAVE
  ].join("\n\n");
}

function failed(message, diagnostic, retryKey = diagnostic) {
  return { passed: false, message, retryKey, diagnostic };
}

/**
 * Add a service: after Add a service writes genesis/stack.md (or for a kind the catalogue has no piece for, and for
 * another App Service), the AI connects the app to it in the session, and Vibe64 checks the result: for a resource,
 * it is declared, the workspace prepares and Preview restarts on it; for a service, the Deployment declares it.
 * @param {{ project: ProjectService, sessions: SessionsService, terminals: TerminalsService }} dependencies
 * @returns {AiTaskKind}
 */
function createAddServiceKind({ project, sessions, terminals }) {
  async function choicesOf(sessionId) {
    const answer = await project.readStackServiceChoices({ sessionId });
    if (answer?.ok === false) {
      const status = answer.code === "vibe64_session_not_found" ? 404 : 409;
      const message = normalizeText(answer.error) || "The session's Stack could not be read.";
      throw new AppError(status, message, { code: answer.code || "vibe64_ai_task_no_problem" });
    }
    return answer.choices;
  }

  /**
   * What Add a service offered, read again from the session's Stack: the task refuses anything else.
   * @param {{ sessionId: string }} context
   * @param {{ kind?: string, resourceId?: string, serviceId?: string, exposure?: string, reachedBy?: string }} input
   * @returns {Promise<AiTaskProblem>}
   */
  async function readAddServiceProblem({ sessionId }, input) {
    const kind = normalizeText(input.kind);
    if (!STACK_SERVICE_KINDS.includes(kind) && kind !== ANOTHER_SERVICE) {
      throw new AppError(400, "Choose a service to add.", { code: "vibe64_stack_service_kind_unknown" });
    }
    const choice = (await choicesOf(sessionId)).find((entry) => entry.kind === kind);
    if (kind === ANOTHER_SERVICE) {
      const serviceId = normalizeText(input.serviceId);
      const reachedBy = normalizeText(input.reachedBy);
      const refused = serviceRefusal(choice, { serviceId, reachedBy });
      if (refused) throw new AppError(409, refused, { code: "vibe64_stack_service_refused" });
      return {
        key: JSON.stringify(["add-service", kind, serviceId]),
        summary: `Add the ${serviceId} service to the Deployment`,
        details: reachedBy ? `An internal service that ${reachedBy} reaches.` : "An internal service.",
        facts: { kind, serviceId, exposure: "internal", reachedBy }
      };
    }
    if (!choice.present && choice.refused) throw new AppError(409, choice.refused, { code: "vibe64_stack_service_refused" });
    if (!choice.present && choice.piece) {
      throw new AppError(409, `genesis/stack.md declares no ${kind} resource. Add it first.`, { code: "vibe64_ai_task_no_problem" });
    }
    const { resourceId, piece, bindings, alternatives, present } = choice;
    return {
      key: JSON.stringify(["add-service", kind, resourceId]),
      summary: present ? `Connect the app to ${resourceId} (${kind})` : `Declare ${resourceId} (${kind}) and connect the app to it`,
      details: present ? `The app receives its values as ${receivedAs(choice)}.` : "The catalogue has no ready entry for this Stack.",
      facts: { kind, resourceId, piece, bindings, alternatives, declared: present }
    };
  }

  async function checkResource({ progress, sessionId, signal, taskId }, task) {
    const { kind, resourceId } = task.problem.facts;
    const choice = (await choicesOf(sessionId)).find((entry) => entry.kind === kind);
    if (!choice?.present) {
      const diagnostic = `genesis/stack.md declares no ${kind} resource yet: declare \`${resourceId}\` in \`## Resources\`.`;
      return failed(`No ${kind} resource is declared yet.`, diagnostic);
    }
    progress({ step: "Preparing the workspace" });
    // The person who started the task prepares as themselves, as Fix workspace preparation does.
    const prepared = await sessions.retryWorkspaceSetup(sessionId, { aiTaskId: taskId, signal, vibe64User: task.startedBy });
    const setup = setupCheckResult(prepared);
    if (!setup.passed) return setup;
    progress({ step: "Restarting Preview" });
    const preview = await terminals.restartPreviewAfterSetup(sessionId, { finishedAt: prepared.workspaceSetup?.finishedAt, signal });
    if (preview?.ok === false) {
      const reason = normalizeText(preview.error) || "Preview did not answer.";
      return failed("Preview did not become ready.", `Preview did not become ready after preparation: ${reason}`);
    }
    return preview?.running
      ? { passed: true, message: `The workspace is prepared, and Preview runs with ${choice.resourceId}.` }
      : { passed: true, message: `The workspace is prepared. Preview isn't running: it uses ${choice.resourceId} when it starts.` };
  }

  async function checkService({ sessionId }, task) {
    const { serviceId } = task.problem.facts;
    const choice = (await choicesOf(sessionId)).find((entry) => entry.kind === ANOTHER_SERVICE);
    if (choice.services.some(({ id }) => id === serviceId)) return { passed: true, message: `The Deployment declares ${serviceId}.` };
    return failed(`The Deployment does not declare ${serviceId} yet.`, choice.refused || `The Deployment declares no service ${serviceId} yet.`);
  }

  function addServiceBrief(problem) {
    return problem.facts.kind === ANOTHER_SERVICE ? serviceBrief(problem) : resourceBrief(problem);
  }

  function runAddServiceCheck(context, task) {
    return task.problem.facts.kind === ANOTHER_SERVICE ? checkService(context, task) : checkResource(context, task);
  }

  return Object.freeze({
    id: "add-service",
    title: "Add a service",
    noun: "task",
    tray: "Adding a service…",
    routing: "fix",
    // Direct Update, Save and Prepare wait for it: it changes the session's source.
    repository: true,
    busy: "A service is being added in this session. Wait for it, or cancel it.",
    opening: "Connect the app to the service.",
    problem: readAddServiceProblem,
    brief: addServiceBrief,
    context: addServiceContext,
    steps: ["The AI connects the app to the service", "Vibe64 prepares the workspace and restarts Preview"],
    check: {
      by: "vibe64",
      label: "Checking the service…",
      output: "Preparation output",
      run: runAddServiceCheck,
      retry: {
        limit: 3,
        display: "Continue connecting the app to the service.",
        message: retryMessage
      }
    },
    done: "The app is connected to the service."
  });
}

export { createAddServiceKind };
