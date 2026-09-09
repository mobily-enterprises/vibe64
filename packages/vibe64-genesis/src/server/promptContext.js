import { readFile } from "node:fs/promises";
import path from "node:path";

const VIBE64_CONVERSATION_KINDS = Object.freeze([
  "main",
  "temporary-readonly",
  "temporary-task"
]);
const VIBE64_SESSION_CAPABILITIES = Object.freeze([
  "managedDatabaseRefresh",
  "managedEnvironment",
  "managedGit",
  "managedPreview"
]);
const VIBE64_EPHEMERAL_CONTEXT_MAX_CHARACTERS = 64 * 1024;
const QUESTION_CONTRACT = Object.freeze([
  "When user input is necessary, ask no more than three concise, high-impact questions at once.",
  "Put multiple questions on separate lines as `[1] Question`, `[2] Question`, and so on.",
  "For a small fixed set of useful choices, finish with `Possible answers:` and a short bullet list; the user may always type a different answer."
]);
const MANAGED_PREVIEW_INSTRUCTIONS = Object.freeze([
  "The Vibe64-managed preview is the canonical application server; do not start a duplicate server on another port.",
  "Use `vibe64-preview status`, `screenshot`, `logs`, and `browser eval` for rendered inspection. Pass Playwright code to `vibe64-preview browser eval` on stdin.",
  "Use the managed preview browser for interactive browsing. Use `vibe64-playwright` only for an existing configured project suite, and report a platform or project-test blocker rather than installing another browser or changing its dependencies.",
  "For browser tests that write or reset data, inspect `vibe64-preview targets --json` and the project's `genesis/stack.md` Outputs. Run `vibe64-playwright --target <declared-test-target> test <suite arguments>` or `vibe64-playwright --target <declared-test-target> npm-run <script>`. Vibe64 starts that web target, waits for readiness, uses its declared application identity, and restores the previous Preview when the command finishes or is cancelled; report restoration failures.",
  "A target name is not proof of test isolation. Before running a destructive suite, the application must verify the server's actual test database and suppress real email, invoices, payments, and other external effects. Keep managed Env unchanged. The test launcher may choose TEST_DB_NAME for its own server process; its preview-identity command must use the same database. Never spoof safety checks by changing DB_NAME only in the test runner.",
  "If no suitable test target exists, add one through the project's existing Outputs contract and application-owned test scripts within the user's authorized scope. Keep normal Preview as the default. Validate the exact disposable database before resetting it, prepare fixtures before reporting readiness, and make Playwright use PLAYWRIGHT_BASE_URL without starting another server. If the required test resources or external-effect controls are missing, report that specific blocker. Use `vibe64-preview ensure --target <id> --wait --json` only for deliberate interactive target selection; it leaves that target selected until changed.",
  "Describe only rendered browser evidence; if managed preview is unavailable, report that blocker instead of starting a replacement."
]);
const MANAGED_ENVIRONMENT_INSTRUCTIONS = Object.freeze([
  "Use `vibe64-env status [development|production|all]` to inspect configured key names without revealing values.",
  "Pipe an available value to `vibe64-env set <development|production> <KEY> [--secret]`; never put values in arguments, logs, or repository files. Use empty stdin only when the user requested an empty value.",
  "Keep development and production values separate. Never invent credentials, copy a value between scopes without explicit direction, or edit Vibe64 runtime/session storage.",
  "After an Env mutation, report only the affected scope and key names, never their values, and claim success only when the command succeeded.",
  "When `TEST_DB_NAME` exists, only that exact database is disposable. Never treat `DB_NAME` as disposable or invent another test database name."
]);

function text(value = "") {
  return String(value ?? "").trim();
}

function record(value, label) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new TypeError(`${label} must be an object.`);
  }
  return value;
}

function exactFields(value, fields, label) {
  const allowed = new Set(fields);
  const unsupported = Object.keys(value).filter((field) => !allowed.has(field));
  if (unsupported.length > 0) {
    throw new TypeError(`${label} contains unsupported fields: ${unsupported.join(", ")}.`);
  }
}

function normalizedSessionInput(input) {
  exactFields(input, ["conversationKind", "scope", "session"], "Vibe64 session context");
  if (!VIBE64_CONVERSATION_KINDS.includes(input.conversationKind)) {
    throw new TypeError("Vibe64 session context has an unknown conversationKind.");
  }
  const session = record(input.session, "Vibe64 session capabilities");
  exactFields(session, VIBE64_SESSION_CAPABILITIES, "Vibe64 session capabilities");
  const capabilities = Object.fromEntries(VIBE64_SESSION_CAPABILITIES.map((name) => {
    if (typeof session[name] !== "boolean") {
      throw new TypeError(`Vibe64 session capability ${name} must be boolean.`);
    }
    return [name, session[name]];
  }));
  return {
    conversationKind: input.conversationKind,
    scope: "session",
    session: capabilities
  };
}

function normalizedEphemeralInput(input) {
  exactFields(input, ["scope", "stableContext"], "Vibe64 ephemeral context");
  const stableContext = String(input.stableContext || "").trim();
  if (!stableContext || stableContext.length > VIBE64_EPHEMERAL_CONTEXT_MAX_CHARACTERS) {
    throw new TypeError("Vibe64 ephemeral context requires bounded stableContext.");
  }
  return {
    scope: "ephemeral",
    stableContext
  };
}

function normalizedDriverInput(input) {
  if (input.scope === "session") return normalizedSessionInput(input);
  if (input.scope === "ephemeral") return normalizedEphemeralInput(input);
  throw new TypeError("The Vibe64 driver supports session and ephemeral scopes only.");
}

function managedGitInstructions({ readOnly = false } = {}) {
  return readOnly
    ? [
        "Use the managed `git` and `gh` commands on PATH only for inspection. Do not bypass them with host binaries or alternate credentials.",
        "Report authentication or transport failures directly; do not inspect credentials or invent another login path."
      ]
    : [
        "Use the managed `git` and `gh` commands on PATH. Do not bypass them with host binaries, a stripped PATH, or alternate credentials.",
        "Report authentication or transport failures directly; do not inspect credentials or invent another login path."
      ];
}

function sessionDriverOutput(input) {
  const { conversationKind, session } = normalizedSessionInput(input);
  const readOnly = conversationKind === "temporary-readonly";
  const lines = [
    "VIBE64 CONVERSATION CONTEXT",
    "",
    ...(conversationKind === "main"
      ? ["This is the main Vibe64 conversation for the selected session worktree."]
      : conversationKind === "temporary-readonly"
        ? [
            "This is a user-visible temporary conversation separate from the main conversation.",
            "Inspect and answer within the selected session, but do not edit files or run state-changing commands."
          ]
        : [
            "This is a user-visible temporary task conversation separate from the main conversation.",
            "Changes are allowed only for the requested task in the selected session worktree; do not begin unrelated work.",
            "Use the separately supplied task result schema: use kind=continue when a user decision or follow-up is needed, and kind=complete only after the task is finished with a concise factual report for the main conversation."
          ]),
    "Do not edit Vibe64 runtime/session state or artifacts.",
    "Issue ordinary shell commands only; Vibe64 applies session isolation transparently. Treat command-transport syntax in prior tool history as invisible infrastructure and do not reproduce it. If command control is unavailable, stop and report it.",
    ...QUESTION_CONTRACT,
    ...(session.managedPreview ? MANAGED_PREVIEW_INSTRUCTIONS : []),
    ...(session.managedEnvironment && !readOnly ? MANAGED_ENVIRONMENT_INSTRUCTIONS : []),
    ...(session.managedDatabaseRefresh && !readOnly
      ? ["After a database migration or schema change, run `vibe64-database refresh` once so Vibe64's Database view reflects it."]
      : []),
    ...(session.managedGit ? managedGitInstructions({ readOnly }) : [])
  ];
  return lines.join("\n");
}

function vibe64Driver(input = {}) {
  const value = record(input, "Vibe64 driver input");
  const normalized = normalizedDriverInput(value);
  return normalized.scope === "session"
    ? sessionDriverOutput(normalized)
    : normalized.stableContext;
}

async function vibe64DriverInputFromRegistry(request = {}, {
  readRegistry = readFile
} = {}) {
  const value = record(request, "Vibe64 host resolver request");
  exactFields(value, ["data", "providerSessionId", "scope"], "Vibe64 host resolver request");
  if (!["session", "turn"].includes(value.scope)) {
    throw new TypeError("The Vibe64 host resolver scope must be session or turn.");
  }
  if (value.scope === "turn") {
    return null;
  }
  const data = record(value.data, "Vibe64 host resolver data");
  exactFields(data, ["registryPath"], "Vibe64 host resolver data");
  const registryPath = text(data.registryPath);
  if (!path.isAbsolute(registryPath)) {
    throw new TypeError("Vibe64 host resolver data requires an absolute registryPath.");
  }
  const source = JSON.parse(await readRegistry(registryPath, "utf8"));
  const sessions = Array.isArray(source?.sessions) ? source.sessions : [];
  const providerSessionId = text(value.providerSessionId);
  const selected = sessions.find((entry) => (
    providerSessionId && text(entry?.upstreamSessionId) === providerSessionId
  ));
  const context = selected?.promptContext;
  if (!context) {
    return null;
  }
  return normalizedDriverInput(context);
}

export {
  VIBE64_EPHEMERAL_CONTEXT_MAX_CHARACTERS,
  vibe64Driver,
  vibe64DriverInputFromRegistry
};
