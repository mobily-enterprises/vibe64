// Agent-readable specs of the Preview identity protocol and the managed app identity list, generated from the limits
// this package, vibe64-core and vibe64-genesis enforce, and of how an agent runs browser suites, what a check gets and
// managed Git: the detail the always-loaded session guidance points to instead of carrying.
import {
  PREVIEW_APPLICATION_IDENTITY_LIMIT,
  PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES,
  PREVIEW_IDENTITY_LOGIN_OPERATION,
  PREVIEW_IDENTITY_LOGOUT_OPERATION,
  PREVIEW_IDENTITY_SELECTOR_TYPES
} from "@local/vibe64-core/server/previewAuth";
import { VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL } from "@local/vibe64-genesis/server";

import {
  PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES,
  PREVIEW_IDENTITY_COMMAND_MAX_COOKIES,
  PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES,
  PREVIEW_TOKEN_COOKIE_PREFIX,
  previewIdentityCommandRequest
} from "./previewIdentityCommand.js";
import { VIBE64_LAUNCH_ALIAS_PATTERN } from "./launchPreviewHeaders.js";

const json = (value) => JSON.stringify(value, null, 2);
const types = PREVIEW_IDENTITY_SELECTOR_TYPES.map((type) => `\`${type}\``).join(", ");

const EXAMPLE_REQUEST_ID = "6f1c2a7e-3d4b-4c55-9a10-2b7d8e9f0a11";
const EXAMPLE_REQUEST = previewIdentityCommandRequest({
  operation: PREVIEW_IDENTITY_LOGIN_OPERATION,
  selector: { type: "email", value: "admin@example.com" }
}, { requestId: EXAMPLE_REQUEST_ID, targetHref: "http://127.0.0.1:5173/" });
const EXAMPLE_RESPONSE = Object.freeze({
  protocol: VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  requestId: EXAMPLE_REQUEST_ID,
  ok: true,
  // readable-check: allow setter-seam - not a slot: setCookie is the example response's cookie list
  setCookie: ["app_session=abc123; Path=/; HttpOnly; SameSite=Lax"],
  identity: { displayName: "Admin", email: "admin@example.com", userId: "1" }
});
const EXAMPLE_REJECTION = Object.freeze({
  protocol: VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  requestId: EXAMPLE_REQUEST_ID,
  ok: false,
  code: "user_not_found",
  error: "No active user has that email.",
  statusCode: 404,
  // readable-check: allow setter-seam - not a slot: setCookie is the example rejection's cookie list
  setCookie: []
});

const VIBE64_TERMINALS_AGENT_SPECS = Object.freeze([
  {
    name: "preview-identity-command",
    title: "Preview identity command protocol",
    exampleRequest: EXAMPLE_REQUEST,
    exampleResponses: [EXAMPLE_RESPONSE, EXAMPLE_REJECTION],
    text: () => `# Preview identity command protocol (\`${VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL}\`)

An application-owned executable, declared under an Outputs web target's \`#### Preview identity\` block (grammar: \`vibe64-helper spec outputs\`), that signs the Preview browser in as an existing application account or signs it out. Vibe64 never creates users, changes roles or reads passwords; the application finds the account, rejects missing or disabled ones and creates or clears its own normal browser session.

## Execution

- Vibe64 runs the declared argv from the session's project root with the declared runtimes and timeout. Its environment adds only the Enabled and Secret names, not the project's Env values, so the command loads the application's own configuration itself (for example its generated environment file). On a test-data target (\`- Data: test\`) it also gets the project's Env with every name the Stack's databases bind set to the target's browser-test database, the first app server's copy, which the generated file cannot override; a command for several app servers signs in through \`target.origin\`, as JSKIT's does. For an enabled run the declared Enabled environment name is \`true\` and the Secret environment name holds a fresh per-run secret. Keep the exchange disabled unless both are present; it is a development-preview control, never a sign-in API of a staging or production app.
- stdin: one JSON request line. stdout: one JSON response (at most ${PREVIEW_IDENTITY_COMMAND_MAX_OUTPUT_BYTES} bytes). Exit 0 after writing the response; a non-zero exit or timeout fails the exchange. Write diagnostics to stderr.
- Use the same database and configuration as the server behind \`target.origin\` (for a test target, its test database).
- A JSKIT application's executable can call \`runManagedPreviewIdentityCommand\` from \`@jskit-ai/auth-web/server/managedPreviewIdentity\`. Pass it the application's environment, this protocol and the Preview's launch hostnames, since it reads no environment on its own and its defaults are JSKIT's neutral protocol and loopback only: \`runManagedPreviewIdentityCommand({ env: process.env, protocol: "${VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL}", localHostnames: [${VIBE64_LAUNCH_ALIAS_PATTERN}] })\`.

## Request

- \`operation\`: \`${PREVIEW_IDENTITY_LOGIN_OPERATION}\` or \`${PREVIEW_IDENTITY_LOGOUT_OPERATION}\`.
- \`protocol\`, \`requestId\`: echo both in the response.
- \`subject\` (${PREVIEW_IDENTITY_LOGIN_OPERATION} only): \`{"kind":"selector","selector":{"type":…,"value":…}}\` with type ${types}. Email values arrive lowercased.
- \`target\`: \`{"href","origin"}\` of the application page the cookies are for.

\`\`\`json
${json(EXAMPLE_REQUEST)}
\`\`\`

## Response

- Always: \`protocol\`, the same \`requestId\`, boolean \`ok\`, and \`setCookie\`: an array of complete Set-Cookie header values (at most ${PREVIEW_IDENTITY_COMMAND_MAX_COOKIES}, each at most ${PREVIEW_IDENTITY_COMMAND_MAX_COOKIE_BYTES} bytes, no line breaks, no \`Domain\` attribute, never named \`${PREVIEW_TOKEN_COOKIE_PREFIX}\` or \`${PREVIEW_TOKEN_COOKIE_PREFIX}_*\`).
- \`ok: true\`: at least one cookie. For ${PREVIEW_IDENTITY_LOGIN_OPERATION}, \`identity\` with at least one of \`displayName\`, \`email\`, \`login\`, \`userId\`, \`username\`. For ${PREVIEW_IDENTITY_LOGOUT_OPERATION} (or \`"signedOut": true\`), the cookies that clear the session.
- \`ok: false\`: \`code\` (at most 128 characters), \`error\` (a person-readable reason, at most 2000), \`statusCode\` 400 through 599 (default 400), optional \`signedOut\`, and \`setCookie\` (may be empty).

\`\`\`json
${json(EXAMPLE_RESPONSE)}
\`\`\`

\`\`\`json
${json(EXAMPLE_REJECTION)}
\`\`\`
`
  },
  {
    name: "preview-identities",
    title: "Managed app identities",
    text: () => `# Managed app identities

The ordered list of named existing application accounts that Preview and managed Playwright can sign in as through the application's Preview identity command (\`vibe64-helper spec preview-identity-command\`).

- Each entry has a \`name\`, a selector \`type\` (${types}) and the application's \`value\` for that account. Names are unique, start with a lowercase letter and use at most 64 lowercase letters, digits, \`_\` or \`-\`; ${[...PREVIEW_APPLICATION_IDENTITY_RESERVED_NAMES].map((name) => `\`${name}\``).join(", ")} are reserved. At most ${PREVIEW_APPLICATION_IDENTITY_LIMIT} entries; the first is the default.
- Entries are selectors only, never passwords. A saved entry does not prove that the account exists or can reach a page: verify the selected account's actual Preview access.
- Read the list and the Stack's declared types with \`vibe64-helper preview identities\`; \`vibe64-helper preview status\` shows the configured names and whether the application supports identity exchange.
- A stored entry that breaks these rules is skipped, never fatal: Preview signs in with the valid ones, and the read lists each skipped entry under \`invalidIdentities\` with its 1-based \`position\` in the stored list and its \`reason\`. \`fileProblem\` means the file is not an identity list at all, so none are used. Rename or remove a skipped entry only as the person asks.
- Save with \`vibe64-helper preview identities save < identities.json\`: the complete ordered JSON array replaces the list (preserve unrequested entries, in their positions), each \`type\` must be declared in the target's \`#### Preview identity\` block, and it prints the saved list. Every entry is checked and an invalid one is refused, naming it and the reason, so a replacement while \`invalidIdentities\` is not empty must rename or remove each one. It is written to this session's source, so the person's normal Save keeps it. The person can also use Dashboard > App access or Colleague.
- The person chooses which existing accounts represent each role. Ask which accounts (email, login or user ID) represent admin and other required roles; you may propose them from existing application accounts. Save only names and accounts the person asked for or confirmed. Never create application accounts or change roles for this.
- After saving, verify each entry with \`vibe64-helper preview browser identity <name>\` and the rendered access.

Entry shape:

\`\`\`json
{"name":"admin","type":"email","value":"admin@example.com"}
\`\`\`
`
  },
  {
    name: "browser-tests",
    title: "Browser suites in a session: pin, login state, test targets, one run at a time",
    text: () => `# Browser suites in a session

How a coding agent writes, runs and reports a project's own Playwright suite in a Vibe64 session. Interactive checks use the managed preview browser (\`vibe64-helper preview browser eval\`), not a suite.

## Running a suite

- Never start Playwright directly in a session, even when the repository's own instructions or scripts say to: not \`npx playwright\`, not \`playwright test\`, and not an npm or package script that runs it, such as a repository's \`test:e2e\`. Run the same suite and arguments with \`vibe64-helper playwright test <args>\` (a package script: \`vibe64-helper playwright npm-run <script>\`), and run the project's own Playwright only when \`vibe64-helper playwright\` says this computer has no managed browser runtime.
- Before a suite, \`vibe64-helper playwright readiness\` reports its dependencies and whether this computer has a managed browser runtime; when it does, install no browser.
- Pin \`@playwright/test\` exactly to the \`platformVersion\` that \`vibe64-helper playwright readiness\` reports.
- The login state belongs to the host: pass \`process.env.PLAYWRIGHT_STORAGE_STATE\` unchanged to \`use.storageState\`, and never read, parse or edit that file or its cookies in the Playwright config (\`vibe64-helper playwright\` refuses such a config). If tests run signed out with it, that is a host defect: report it with the evidence; do not work around it.

## Suites that write data: test targets

- For browser tests that write or reset data, inspect \`vibe64-helper preview targets --json\` and the project's \`genesis/stack.md\` Outputs. Run \`vibe64-helper playwright --target <declared-test-target> test <suite arguments>\` (or \`npm-run <script>\` in place of \`test\`). Each such target is a test server the project declares: Vibe64 starts it with the project's own Run command and disposable data (its harness, not a bypass) and points \`PLAYWRIGHT_BASE_URL\` at it, waits for readiness, uses its declared application identity, and restores the previous Preview when your turn ends or Preview is next ensured, not between repeated runs; report restoration failures. Specs create the data they need in fixtures; tests that write never use the person's development target.
- A target name is not proof of test isolation. Before running a destructive suite, the application must verify the server's actual test database and suppress real email, invoices, payments, and other external effects. Keep managed Env unchanged. The test launcher and its preview-identity command must use the same database. Follow the application's declared test resources and never invent a database name. Never spoof safety checks by changing only the test runner's environment.
- A suite's own process, a spec or fixture that opens the database itself, gets every name the Stack's databases bind from Vibe64, whatever the application's \`.env\` says: on a test-data target (\`- Data: test\`) its browser-test database (\`BROWSER_TEST_DB_NAME\`, the first app server's copy) on the session's server; on development data (the person's Preview or a development target) a database that cannot connect, \`vibe64_no_database_in_browser_runs\`. Run such a suite with \`--target <test-target>\`; on development data change data only through the application.
- A test target serves the application's production build, never a development server: built once per tree and reused while a digest of its sources is unchanged, one app server per worker (its Run step takes \`{workers}\`), so the suite tests the code Staging and Production run. JSKIT's \`jskit browser-test-server {host} {port} {workers}\` is one. A declared test target that starts a development server is a defect to fix (or report) before a suite relies on it.
- If no suitable test target exists, add one through the project's existing Outputs contract (\`vibe64-helper spec outputs\`) and application-owned test scripts within authorized scope; normal Preview stays the default. Validate the exact disposable database before resetting it, prepare fixtures before reporting readiness, and make Playwright use PLAYWRIGHT_BASE_URL (the started target's URL) without starting another server. If test resources or external-effect controls are missing, report that blocker. \`vibe64-helper preview ensure --target <id> --wait --json\` deliberately selects an interactive target until changed. If browser startup is slow, measure migrations, fixtures and server startup before retrying or extending deadlines.


## Parallel test targets

- A test target whose Run step takes \`{workers}\` (a web target with \`- Data: test\`, \`vibe64-helper spec outputs\`) serves one app server per Playwright worker, worker *i* on \`{port}\`+*i* with its own copy of the test database. \`vibe64-helper playwright --target <id>\` then runs the suite in parallel, with as many workers as half the machine's test budget (JSKIT's \`testConcurrency()\`) and its free memory allow; \`--workers <n>\` asks for another count, capped at the budget. Never pass Playwright's own \`--workers\` or \`-j\` with \`--target\`: it is refused.
- Each worker's app server and signed-in state arrive in \`PLAYWRIGHT_WORKER_TARGETS\`, which JSKIT's \`browserTestConfig()\` reads; pass it on unchanged, as the login state. A config that ignores it sends every worker to the first server and its database, and the run warns. JSKIT before 0.2.113 gives every worker the first server's database, so such a run is refused: run \`npm run jskit:update\`, or \`--workers 1\`.
- While the run lasts, \`vibe64-helper preview status --json\` lists the workers under \`diagnostics.testWorkers\`. A run with several app servers closes its test target as it ends and brings the previous Preview back at once, so each such run starts the target afresh.
- A target without \`{workers}\`, or a run of one worker, runs as before: one app server, kept until the turn ends.
## One suite at a time

- Batch related browser tests in one managed suite (one Preview switch and restore). Suites and live Preview actions are sequential: no browser actions, ensure/restart or target changes during a suite or restoration.
- Wait on the original execution, including background runs, through cleanup/restoration (empty polls: yield_time_ms: 30000 where supported; shorter only for interactive input); read-only status/logs stay available.
- Before live inspection, confirm \`vibe64-helper playwright status\` shows no active run and \`vibe64-helper preview status\` is ready on the restored target.
- To stop, run \`vibe64-helper playwright cancel <run-id>\`, which waits for cleanup/restoration; retry if cleanup needs attention. Never kill test/Preview PIDs or change locks; launcher exit alone does not prove tests stopped. Recheck status before reporting a busy blocker.

## Reporting

- Keep test output small: run relevant files/cases, save stdout/stderr to local artifacts and keep exit status. Report counts, duration, failed cases, actionable errors and artifact paths, reading only needed failure excerpts.
- Retain startup, resource and Preview-restoration errors even if tests pass, and trailing wrapper diagnostics separately from JSON. Do not rerun for output or reread unchanged logs.
`
  },
  {
    name: "checks",
    title: "Checks: what a check gets wherever it runs, and the Verification that declares the whole suite",
    text: () => `# Checks

A check is a command that tests the project: its lint, its tests, its browser suite or its build. The Stack's \`## Verification\` declares the project's checks. A host may run a declared check on another machine that serves the session, and keeps focused runs, undeclared commands and any check it has a reason to keep (working changes that hold something shaped like a credential, say) where the session is.

## What a check gets

Wherever it runs, a check gets this and nothing more, so write checks that need nothing else:

- The session's tree as it is: its last commit plus every working change, untracked files included, possibly at another absolute path: never hard-code one. A machine that ran the session's checks before keeps ignored and untracked folders such as \`node_modules\` and \`node_modules/.cache\` between checks, and puts the tracked files back to the session's.
- Workspace setup's Prepare steps run again only when their inputs change: the setup's recipe, and for each step the tracked files its declared inputs match, or the whole tree for a step that declares none. Declare each step's inputs (\`package-lock.json\`, say), so a change elsewhere does not run it again.
- The test budget, set by the host, never by the project: \`V64_TEST_CONCURRENCY\`, the processors the machine gives the check (at least 1), and \`PLAYWRIGHT_WORKERS\`, half of that (at least 1), as JSKIT's \`browserTestConfig()\` counts them. Where a host sets neither, JSKIT's \`testConcurrency()\` takes half the processors.
- \`APP_ENV=development\` and, from the Development Env, the names the Stack declares (its environment defaults and resource bindings), secrets included; nothing the Stack does not declare. \`PATH\` holds the project's declared runtimes, and Playwright's browsers are the host's (\`PLAYWRIGHT_BROWSERS_PATH\`): download none.
- Its databases, from the host's own development provisioning where the check runs: the database, its test database (\`TEST_DB_NAME\`) and its browser test database (\`BROWSER_TEST_DB_NAME\`), which a database resource binds through \`testDatabase\` and \`browserTestDatabase\` to exactly those names; Vibe64 refuses any other. The application's own database user makes and drops the copies JSKIT's test runners make of them for their workers; a check never gets administrator credentials. The host grants a fixed number of copies: with more test workers than that, JSKIT runs that many database files at once.
- Temporary files go where \`TMPDIR\` or the system puts them: depend on no location, and remove what a check makes.

## The Verification that declares the whole suite

- Declare every part of the project's checks as its own \`- Verify\` entry, each a command the project has: its lint, unit tests, database tests, client tests, browser suite and build. A part missing from Verification is a part no whole run covers.
- The declared Verification is the whole suite: a whole run runs every entry once. The project's one command for a whole run (\`npm run verify\`, say) runs exactly those parts, once each, the browser suite included: never a listing (\`test:e2e:list\`, \`playwright test --list\`) in a suite's place.
- Each part owns its databases, ports and output folder (\`test-results/<part>\`, say), so parts run side by side and identical runs agree.
- Budgets come from the machine (\`V64_TEST_CONCURRENCY\`, \`PLAYWRIGHT_WORKERS\`, JSKIT's \`testConcurrency()\`): never pin a worker or concurrency count, to make a run pass or otherwise.
- A run reports each part's wall time and its 10 slowest files, so a slow part shows, and its cause is measured before anything waits longer.
`
  },
  {
    name: "managed-git",
    title: "Managed Git and gh: what carries the token, attachments, reporting a failure",
    text: () => `# Managed Git and gh

A session's \`git\` and \`gh\` on PATH are Vibe64's managed commands. The always-loaded session guidance says which repository they act on; this is the rest.

## Commands that carry the session's GitHub token

- In the source, \`git fetch\`, \`pull\`, \`push\`, \`ls-remote\`, \`clone\` and \`remote\`, and every \`gh\` command, carry this session's GitHub token, so they run no hooks, reach GitHub over HTTPS only and refuse what names a program: \`-c\` settings such as credential helpers, \`--config-env\`, \`--exec-path\`, \`--upload-pack\`, signing, submodule recursion, shell variables such as GIT_SSH_COMMAND, repository config such as filters or merge drivers for a pull, and \`gh auth\`, \`alias\`, \`extension\`, \`config\` or a command that is not gh's own.
- Follow the refusal's advice, and ask the person before removing a repository setting you did not add; Save and Update refuse the same repository config. Every other Git command runs without the token.

## Attachments

- For attachments and inline images that GitHub stores for issues (tickets), pull requests or comments, use authenticated managed \`gh api\` with the original attachment URL, save the response to a local file and inspect it before reporting its contents.
- Never use unauthenticated curl/wget, User-Agent experiments or extracted credentials; an unauthenticated 404 does not prove a private attachment is missing.

## When a command fails

- Tell the user which requested action failed, which earlier work is confirmed complete, what remains undone or unconfirmed, and the next safe action. Retain the reported failure stage, execution budget and execution reference when provided; do not expose credentials or dump raw output unnecessarily.
- A timeout or transport failure does not establish invalid authentication, exhausted AI quota, a GitHub outage or a suspension problem. Separate recorded facts from hypotheses; say the cause is unknown when it is unproven. Recommend reconnection only when the reported error explicitly calls for it.
- If the diagnostic says commandSubmitted=false, the requested Git/GitHub action was not attempted. After an execution timeout, lost response or unreadable response, its effects are unconfirmed: use a read-only check of the affected Git/GitHub state before repeating any write. Never claim that a comment was posted or not posted, or that a push succeeded or failed, from those errors alone. If verification is unavailable, report the outcome as unknown and stop; do not repeat the write or claim a safe rollback.
`
  }
]);

export { VIBE64_TERMINALS_AGENT_SPECS };
