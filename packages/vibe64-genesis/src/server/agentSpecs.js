// Agent-readable specs of every Vibe64-owned Stack section, printed by
// `vibe64 spec <name>`. Entry forms and limits come from the parsers' own tables,
// and every example below parses with its real parser.
import { ARCHITECTURE_OBSERVATIONS_SCHEMA } from "genesis-compiler";

import {
  DEPLOYMENT_ENTRY_FORMS,
  DEPLOYMENT_HEADING_FORMS,
  DEPLOYMENT_RESOURCE_ENTRY_FORMS,
  DEPLOYMENT_SERVICE_ENTRY_FORMS,
  DEPLOYMENT_STEP_ROLES,
  VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
  VIBE64_APPLICATION_DEPLOYMENT_SECTION
} from "./applicationDeployment.js";
import {
  PACKAGING_ENTRY_FORMS,
  PACKAGING_HEADING_FORM,
  VIBE64_PACKAGING_CONTRACT,
  VIBE64_PACKAGING_PACKERS,
  VIBE64_PACKAGING_SECTION
} from "./packaging.js";
import {
  ARCHITECTURE_INSPECTOR_FIELDS,
  ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES,
  VIBE64_ARCHITECTURE_INSPECTION_CONTRACT,
  VIBE64_ARCHITECTURE_INSPECTION_SECTION
} from "./architectureInspection.js";
import {
  ARCHITECTURE_LAYOUT_KINDS,
  VIBE64_ARCHITECTURE_LAYOUT_CONTRACT,
  VIBE64_ARCHITECTURE_LAYOUT_SECTION
} from "./architectureLayout.js";
import {
  CONNECTED_DEVELOPMENT_ENTRY_FORMS,
  VIBE64_CONNECTED_DEVELOPMENT_CONTRACT,
  VIBE64_CONNECTED_DEVELOPMENT_SECTION
} from "./connectedDevelopment.js";
import {
  INTEGRATION_SETUP_ENTRY_FORM,
  VIBE64_INTEGRATION_SETUP_CONTRACT,
  VIBE64_INTEGRATION_SETUP_SECTION
} from "./integrationSetup.js";
import {
  OUTPUTS_ENTRY_FORMS,
  OUTPUTS_HEADING_FORMS,
  VIBE64_OUTPUT_MAX_PARAMETERS,
  VIBE64_OUTPUTS_CONTRACT,
  VIBE64_OUTPUTS_SECTION,
  VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL,
  VIBE64_PREVIEW_IDENTITY_RESERVED_ENVIRONMENT_NAMES
} from "./outputs.js";
import {
  PROJECT_SERVICE_ENTRY_FORM,
  VIBE64_PROJECT_SERVICES_CONTRACT,
  VIBE64_PROJECT_SERVICES_SECTION
} from "./projectServices.js";
import {
  VIBE64_RESOURCE_ESTIMATE_FIELDS,
  VIBE64_RESOURCE_ESTIMATE_MAX_MIB,
  VIBE64_RESOURCE_ESTIMATES_CONTRACT,
  VIBE64_RESOURCE_ESTIMATES_SECTION
} from "./resourceEstimates.js";
import {
  STAGING_DATA_ENTRY_FORMS,
  STAGING_DATA_HEADING_FORMS,
  STAGING_DATA_LIMITS,
  STAGING_DATA_MODES,
  VIBE64_STAGING_DATA_CONTRACT,
  VIBE64_STAGING_DATA_SECTION
} from "./stagingData.js";
import {
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  WORKSPACE_SETUP_ENTRY_FORM
} from "./workspaceSetup.js";
import {
  CONNECTED_CUSTOM_RUNNER_CONTRACT,
  CONNECTED_PACKAGE_TYPES,
  CONNECTED_SOURCES_CONTRACT,
  CONNECTIONS_LOCK_FILE,
  CONNECTIONS_LOCK_SCHEMA
} from "../shared/connectedPackageTypes.js";

const COMMAND_RULES = [
  "Command values: the executable and every argument are separate backticked values separated by single spaces (at most 64 values of at most 4096 characters, no line breaks). The executable is a name on PATH or a project-relative path, never absolute and never containing `..`.",
  "Runtimes are lowercase technology ids selected in the project's Stack, such as `nodejs` or `php`. Paths are canonical project-relative paths; `.` is the project root.",
  "A section containing only `- Nothing.` explicitly declares nothing. Blank lines are ignored."
].join("\n");

const list = (forms) => forms.map((form) => `    ${form}`).join("\n");

function sectionSpec({ name, title, section, contract = "", summary, body, example }) {
  return {
    name,
    title,
    section,
    example,
    text: () => [
      `# ${title}`,
      "",
      `Section: \`## ${section}\` in \`genesis/stack.md\`${contract ? `, contract \`${contract}\`` : ""}. Vibe64 owns its grammar and meaning; Genesis transports the exact section text.`,
      "",
      summary,
      "",
      body.trim(),
      "",
      COMMAND_RULES,
      "",
      "## Example",
      "",
      "```markdown",
      `## ${section}`,
      "",
      example.trim(),
      "```",
      ""
    ].join("\n")
  };
}

const outputsExample = `
### Target \`app\`: Application

- Default.
- Mode: \`interactive\`
- Runtimes: \`nodejs\`
- Run \`Start\`: \`npm\` \`run\` \`dev\` \`--\` \`--host\` \`{host}\` \`--port\` \`{port}\`

#### Presentation

- Kind: \`web\`
- URL path: \`/\`
- Ready when: \`GET\` \`/health\` returns \`200\`

#### Preview identity

- Command: \`tools/preview-identity\`
- Protocol: \`${VIBE64_PREVIEW_IDENTITY_COMMAND_PROTOCOL}\`
- Identity types: \`email\`
- Enabled environment: \`APP_PREVIEW_IDENTITY_ENABLED\`
- Secret environment: \`APP_PREVIEW_IDENTITY_SECRET\`
- Runtimes: \`nodejs\`

### Target \`test-app\`: Test Preview

- Mode: \`interactive\`
- Data: \`test\`
- Runtimes: \`nodejs\`
- Run \`Start test application\`: \`node\` \`tests/support/start-test-app.mjs\` \`{host}\` \`{port}\`

#### Presentation

- Kind: \`web\`
- Ready when: \`GET\` \`/health\` returns \`200\`

### Target \`report\`: Monthly report

- Mode: \`finite\`
- Runtimes: \`nodejs\`
- Build \`Export\`: \`node\` \`tools/export.mjs\` \`--month\` \`{parameter:month}\`

#### Parameter \`month\`: Month

- Default: \`2026-01\`
- Description: \`Month to export.\`
- Required.

#### Download \`csv\`

- Path: \`exports/report.csv\`
- Name: \`report.csv\`
- Media type: \`text/csv\`
`;

// What each Staging data mode means, by its name in the inspection's result.
const STAGING_DATA_MODE_MEANINGS = Object.freeze({
  empty: "Staging has its own database and it starts empty; the Deployment's Migrate makes its structure. An application without this section has this.",
  full: "Staging's own database is built from a whole dump of production's. Needs Source and `### Contacts`.",
  sampled: "Staging's own database is built from a sample of that dump, by the recipe below. Needs Source, Unlisted tables, `### Tables` and `### Contacts`; `### Links` and `### Keep together` are optional.",
  shared: "Staging uses production's database itself and nothing is copied. A host treats a Migrate on Staging as a migration of production's database.",
  frozen: "as shared, and Staging never runs Migrate: its code must work with production's structure as it is."
});

const VIBE64_GENESIS_AGENT_SPECS = Object.freeze([
  sectionSpec({
    name: "workspace-setup",
    title: "Workspace setup",
    section: VIBE64_WORKSPACE_SETUP_SECTION,
    contract: VIBE64_WORKSPACE_SETUP_CONTRACT,
    summary: "Ordered commands that prepare a session's working copy (dependencies, generated files, migrations) before any Output runs.",
    body: `
Each entry:
${list([WORKSPACE_SETUP_ENTRY_FORM])}

- \`\` in \`workdir\` \`\` runs the command in that project directory (default \`.\`).
- \`\` when \`path\` exists \`\` waits: setup stays waiting until the path exists (for example a manifest the agent has not created yet).
- \`\` if \`path\` exists \`\` skips the step while the path is missing.
- \`\` from \`path\`... \`\` names every file the command reads: project files or folders (a folder covers every file below it), where \`*\` matches within one path segment and \`**\` across segments. Ignored files are never seen. After the step succeeds Vibe64 records what those files held and the command; a later preparation skips the step while both are unchanged and the session's resources are the ones it ran on. Name the lockfile too, and leave \`from\` out when unsure: a step without it runs whenever preparation runs.
- Steps run in order through managed execution with the session's development Env. Vibe64 records success against the exact recipe; changing any step runs setup again, and Outputs stay pending until it succeeds. Prepare workspace runs every step. Keep every step repeatable and non-destructive.
`,
    example: `
- Prepare \`Install dependencies\` from \`package.json\` \`package-lock.json\` with \`nodejs\`: \`npm\` \`ci\`
- Prepare \`Migrate database\` with \`nodejs\` if \`migrations\` exists: \`npm\` \`run\` \`db:migrate\`
- Prepare \`Install client\` with \`nodejs\` in \`client\` when \`client/package.json\` exists: \`npm\` \`ci\`
`
  }),
  sectionSpec({
    name: "outputs",
    title: "Outputs",
    section: VIBE64_OUTPUTS_SECTION,
    contract: VIBE64_OUTPUTS_CONTRACT,
    summary: "The runnable targets Vibe64 offers: interactive terminal or web apps shown in Preview, and finite runs that produce downloads.",
    body: `
Headings, each target followed by its entries and then optional blocks:
${list(OUTPUTS_HEADING_FORMS)}

Target entries:
${list(OUTPUTS_ENTRY_FORMS.target)}

- Ids use lowercase letters, digits and single hyphens. Target ids are unique; at most one target is \`- Default.\` (the normal Preview).
- \`interactive\`: exactly one Run step, last, and one \`#### Presentation\`. \`finite\`: no Run, Presentation or Preview identity, and at least one \`#### Download\`.
- Steps are ordered Prepare, Build, then Run. \`{host}\` and \`{port}\` may appear only in a web target's Run step; the application must listen there. \`{parameter:id}\` may appear in any step argument.
- \`\` - Data: \`test\` \`\` declares a target that enforces isolated test data (Test Preview banner; used by \`vibe64-helper playwright --target <id>\`). \`development\` is the other value; omitting Data asserts nothing.
- Workdir defaults to \`.\`.

\`#### Parameter\` entries (at most ${VIBE64_OUTPUT_MAX_PARAMETERS} per target, each used in a step):
${list(OUTPUTS_ENTRY_FORMS.parameter)}

Values are single-line text of at most 4096 characters; an omitted Default is empty; Required rejects blank values. Parameters are visible arguments: keep credentials in Env.

\`#### Presentation\` entries:
${list(OUTPUTS_ENTRY_FORMS.presentation)}

\`terminal\` accepts only Kind. \`web\` needs one Ready when (status 200 through 399); URL path defaults to \`/\`.

\`#### Download\` entries (all required):
${list(OUTPUTS_ENTRY_FORMS.download)}

Path is a project-relative file the steps produce; Name is a safe file name of at most 255 characters; Media type is lowercase type/subtype.

\`#### Preview identity\` entries (web targets only; Command, Protocol and Identity types are required):
${list(OUTPUTS_ENTRY_FORMS.previewIdentity)}

- The command is a committed, application-owned project-relative executable whose path contains \`/\`, without \`{host}\` or \`{port}\`.
- Enabled and Secret environment names are distinct uppercase names, not ${[...VIBE64_PREVIEW_IDENTITY_RESERVED_ENVIRONMENT_NAMES].join(", ")} or \`XDG_*\`. For an enabled web run Vibe64 sets the enabled name to \`true\` and the secret name to a fresh per-run secret; the application must keep its identity exchange disabled unless both are present.
- The command's stdin/stdout protocol: \`vibe64-helper spec preview-identity-command\`. The configured account names: \`vibe64-helper spec preview-identities\`.
`,
    example: outputsExample
  }),
  sectionSpec({
    name: "deployment",
    title: "Deployment",
    section: VIBE64_APPLICATION_DEPLOYMENT_SECTION,
    contract: VIBE64_APPLICATION_DEPLOYMENT_CONTRACT,
    summary: "The commands that turn a project revision into a running app, on Staging or in Production.",
    body: `
Entries:
${list(DEPLOYMENT_ENTRY_FORMS)}

- Steps are ordered ${DEPLOYMENT_STEP_ROLES.join(", ")}; exactly one Serve step comes last. Serve starts the long-running application, which listens on the address given by the \`HOST\` and \`PORT\` environment variables. Arguments are passed literally (no \`{host}\` or \`{port}\` placeholders), so a server that takes its address only as arguments needs a committed project script that reads them.
- Every step runs exactly as declared with the Env of the environment it runs in. A host may also give Serve, and only Serve, its runtime's conventional production setting, such as \`NODE_ENV=production\` for Node; a value the project sets itself, on the Serve step or in that Env, wins. To be sure of a mode, declare it on the Serve step, for example \`env\` \`NODE_ENV=production\` \`node\` \`server.js\`, never in the Env or Prepare, where it can make package installation skip the build tools a later step needs.
- Generated secrets names secrets the application needs as a stable random value, such as a session-signing key. When the host finds no entry with that name in the environment's Env, it stores a strong random value there once, as a secret: it is kept across releases, never printed, and never replaces a value someone set. Replacing it is an ordinary change to that Env.
- Setup code names the one secret of that environment the application asks for when its first account registers on its empty database, so that only the project owner can create that account (the first account usually becomes the application's owner). The host generates it as it does a generated secret, so never also list it under Generated secrets, and shows its value only to the project owner; it is never printed, logged or given to an assistant. Declare it only when the application reads that variable.
- Sandbox allows names, from a closed set, what the application's own commands and service may do beyond the ordinary sandbox of an app a host runs: \`gvisor\` lets them start gVisor's rootless \`runsc\` (it makes its own user, mount, PID, IPC, UTS and network namespaces, mounts inside them and traces its own processes); \`fuse\` lets them mount a FUSE file system through \`/dev/fuse\` inside a user and mount namespace of their own (for example \`unshare\` \`--user\` \`--map-root-user\` \`--mount\`), never through a set-user-ID helper such as \`fusermount3\` outside one. Nothing else widens: no new privileges or capabilities outside those namespaces, the same writable folders and devices. A host grants an allowance only where its owner permits it, and refuses a deploy that needs one it does not grant rather than run it with less. Declare it only when the application needs it, never to make a failing deploy pass: an allowance widens what an intruder in the application could reach, so whether to grant it is the project owner's decision, never an assistant's. An assistant never adds or changes this line on its own; it explains the failure and asks the person.
- Packages names the system packages the application's steps and service need beyond its runtimes, by their nixpkgs names: an attribute such as \`git\` or \`python313Packages.pip\`, or one output of it after \`^\`, such as \`gcc-unwrapped^lib\` (at most 200, each once). A host that builds the app's machine from a package collection installs exactly these beside the runtimes and refuses a name it doesn't have; a host that runs the app on a machine it does not build ignores the line, so there the packages must already be installed. Name every program a step or the service runs that is not part of a runtime, such as \`git\` for a Prepare step that clones, or a browser the service starts; never install one from a script instead.
- Host-level preparation beyond the package manager and Packages, such as devices or host permissions, goes in one script per hosting environment, \`scripts/hosting/<host>.sh\`, which the \`HOSTING_SCRIPT\` environment variable names and the Prepare step runs; an application that needs none has no such script. It never works around Vibe64's rules: what Vibe64 provides, such as a runtime or a sandbox allowance, is declared in this section, never installed or switched on by the script, and where the host lacks something the script fails with one plain sentence instead of switching features off.
- Instances says how many identical copies of the application a host may run at once behind one address, each with a disk and memory of its own (a count from 1 to 100). Without it a host runs one copy. Declare it only when no copy keeps anything a later request needs: uploaded files on its own disk, sign-ins or sessions in memory or in files, or a scheduled job that must run once. Such state belongs in a declared resource (a database, a bucket, Redis); a host never guesses it from the source. A host that can't run Migrate once per release runs it in each copy as it starts, so a migration takes a lock and does nothing once applied.
- One Ready when entry is required (status 200 through 399). Workdir defaults to \`.\`. Each other entry appears at most once.
- Services: an application that runs as more than one kind of process (a different machine size, untrusted work kept apart from secrets, scaling apart) lists them under headings ${DEPLOYMENT_HEADING_FORMS.map((form) => `\`\` ${form} \`\``).join(" and ")}, after the entries shared by every service (Workdir, Runtimes, Recreate on restore, Generated secrets, Setup code, Packages, and the Prepare, Build and Migrate steps: one build serves every service). Without such headings the Deployment is one public service, \`web\`. With them, each service says its own Serve, Ready when, Instances and Sandbox allows, and none of these stays above the headings. A service's id is a lowercase letter then up to 15 lowercase letters, digits and hyphens; there are 1 to 8, exactly one public. \`### Service\` entries:
${list(DEPLOYMENT_SERVICE_ENTRY_FORMS)}
  Exposure, Serve, Ready when and Instances (1 to 100, the least first) are required. Needs at least is the smallest machine it runs on, in whole vCPUs and GiB, never a provider's size name. Production is the count Production starts with (default the least); after that its count is a running setting, set within Instances, never by a Deploy. Reached \`each instance\` (internal services only) gives each instance the address the others reach it at. Reaches opens the reached service's port to this one and sets SETTING to its address. A Setting is a fact of the source, the same in every environment; secrets and values that differ per environment belong in the environment's Env. No Reaches or Setting names a setting the host gives (\`APP_ENV\`, \`HOST\`, \`PORT\`, \`APP_PUBLIC_URL\`, \`TRUSTED_PROXIES\`, \`STAGING_REACHES_REAL_PEOPLE\`, any \`V64_\` name), a generated secret, the setup code or a name a resource binds. A service's Packages come beside the shared ones.
- \`### Resource\` entries, for a resource of \`## Resources\` by its id:
${list(DEPLOYMENT_RESOURCE_ENTRY_FORMS)}
  For a bucket only: \`local folder\` means development gives the application no bucket settings and it keeps its files in its own folder; \`own bucket\` (the default) lets the person enter a bucket's settings.
- Recreate on restore lists project-relative globs (only \`*\` and \`**\`) that a restored app rebuilds with its Prepare step, such as installed dependencies. It requires a Prepare step.
- Migrate applies pending migrations without destroying data. A host runs it once per release, on a temporary copy of the new release with its Env and resources, before any copy of that release starts; a host that can't runs it as each copy starts. Either way the version before keeps serving on the migrated database while the release rolls out, and again if the release fails, and returning to an earlier version returns its code, never its schema. So a migration only adds what the version before still works with (expand first), and a column or table the code stops using is removed in a later release, once no version that reads it serves (contract later).
- Prepare and Build never need the database or another managed service: a host may run them alone, without those credentials, to check that a revision builds before it publishes it.
- The host gives every step \`APP_ENV\`, the environment it deploys to: \`staging\` or \`production\`. Vibe64 runs a session's commands and Preview with \`development\`, and automated test runs use \`test\`. No step, Generated secret or Setup code sets it, nor \`SIDE_EFFECTS\`, which \`APP_ENV\` replaced. Nor does one set \`STAGING_REACHES_REAL_PEOPLE\`, which a host gives a Staging only while the project's owner marks that real people use it. Every decision about where the application runs reads \`APP_ENV\` through one helper of the application's, never \`NODE_ENV\`, which only picks optimised builds and library modes; a missing or unknown value refuses to start, naming the fix. Following it is the application's job:
  - \`development\` and \`test\`: no email, SMS, push notification, webhook or connector write leaves the application; each is written to its log, and payments use the provider's sandbox.
  - \`staging\`: email goes only to \`STAGING_EMAIL_TO\` and SMS only to \`STAGING_SMS_TO\`, and each is logged instead when its variable is unset; push notifications, webhooks and connector writes are logged; payments use the provider's sandbox. When the host also gives \`STAGING_REACHES_REAL_PEOPLE=true\` (real people use that Staging), email and SMS go to the people they are for instead, and everything else stays as \`staging\` has it; any other value, or the setting outside \`staging\`, refuses to start.
  - \`production\`: everything is real.
  - Every page shows a small, always-visible banner naming the environment, except in \`production\`; a \`staging\` page that real people use says so in it.
  Read it when the application runs, never at build time. In Node, for example: \`const to = { production: message.to, staging: process.env.STAGING_REACHES_REAL_PEOPLE === "true" ? message.to : process.env.STAGING_EMAIL_TO }[process.env.APP_ENV]; if (to) await mailer.send({ ...message, to }); else console.info("%s: email to %s not sent", process.env.APP_ENV, message.to);\`
`,
    example: `
- Runtimes: \`nodejs\`
- Recreate on restore: \`node_modules\`
- Generated secrets: \`SESSION_SECRET\`
- Prepare \`Install\`: \`npm\` \`ci\`
- Build \`Build\`: \`npm\` \`run\` \`build\`
- Migrate \`Migrate\`: \`npm\` \`run\` \`db:migrate\`
- Serve \`Serve\`: \`env\` \`NODE_ENV=production\` \`node\` \`server.js\`
- Ready when: \`GET\` \`/health\` returns \`200\`
`
  }),
  sectionSpec({
    name: "staging-data",
    title: "Staging data",
    section: VIBE64_STAGING_DATA_SECTION,
    contract: VIBE64_STAGING_DATA_CONTRACT,
    summary: "What Staging's database holds: a database of its own (empty, or built from a whole or sampled dump of production's) or production's database itself. Without the section Staging has its own empty database.",
    body: `
Entries before any heading, each at most once:
${list(STAGING_DATA_ENTRY_FORMS.section)}

Headings, each at most once, in any order, each followed by its entries:
${list(STAGING_DATA_HEADING_FORMS)}

\`### Tables\` entries, each table once:
${list(STAGING_DATA_ENTRY_FORMS.tables)}

\`### Links\` entries, each from-column once:
${list(STAGING_DATA_ENTRY_FORMS.links)}

\`### Keep together\` entries, each child table and column once:
${list(STAGING_DATA_ENTRY_FORMS.keepTogether)}

\`### Contacts\` entries, each column once, or exactly \`- Nothing.\`:
${list(STAGING_DATA_ENTRY_FORMS.contacts)}

- Database (always) names the database resource of the Stack's \`## Resources\`, of kind \`mysql\` or \`postgresql\`, whose Staging data this is. Mode (always) is one of the phrases above, written without backticks:
${Object.entries(STAGING_DATA_MODES).map(([phrase, mode]) => `  - \`${phrase}\`: ${STAGING_DATA_MODE_MEANINGS[mode]}`).join("\n")}
  Only an own copy, full or sampled, has Source and \`### Contacts\`; only a sampled one has Unlisted tables, \`### Tables\`, \`### Links\` and \`### Keep together\`. Whether Staging holds production's data, or uses its database, is the person's decision: an assistant never chooses a copy or a shared mode on its own; it may draft a sampled recipe from the application's schema for the person to review.
- Source is the application's own command that writes a dump of production's database to the file \`{dump}\` names. A host runs it with the settings it gives the app's Staging, where the database's own settings (such as \`DB_HOST\`) name Staging's own database, so the command reaches production's dump, or production's database, through settings of its own (such as \`PRODUCTION_DUMP_URL\`); the host builds Staging's own database from the file, and Staging itself never connects to production's database. \`{dump}\` is an argument of its own, exactly once, and the command's only placeholder. The dump is, for \`mysql\`, SQL text as \`mariadb-dump\` or \`mysqldump\` writes it, plain or gzip-compressed, of one database's tables (never \`--databases\` or \`--all-databases\`); for \`postgresql\`, \`pg_dump\` custom format (\`-Fc\`).
- Tables: \`all\` keeps every row, \`none\` keeps the table empty, and \`\` recent by \`column\` \`\` keeps the rows whose column is in the last \`n\` days (${STAGING_DATA_LIMITS.days.join(" to ")}), the newest \`n\` rows by that column (${STAGING_DATA_LIMITS.rows.join(" to ")}), or both: the newest \`n\` of the last \`n\` days. Unlisted tables: a table \`### Tables\` doesn't list is copied whole when it has at most \`n\` rows (${STAGING_DATA_LIMITS.unlistedRows.join(" to ")}); a larger one needs a rule of its own.
- A host also keeps every row a kept row refers to, through the database's own foreign keys and \`### Links\`, which names a column that refers to another column without a foreign key saying so. \`### Keep together\` goes the other way: for every kept \`parent\` row, every \`child\` row whose \`column\` refers to it is kept too. A host loads the copy with the database's constraint checks on and checks for orphans after.
- \`### Contacts\` names every column that holds a person's email address or phone number; a host replaces their values in Staging's copy with made-up ones, the same at every build, so that Staging reaches no real person. \`- Nothing.\` says no column holds one.
- Table and column names are 1 to 64 letters, digits and \`_\`, starting with a letter or \`_\`, each in backticks; \`table.column\` joins two with one dot. Keep together's column belongs to its child table.
- A section of only \`- Nothing.\` is refused: declare a mode, or leave the section out.
`,
    example: `
- Database: \`database\`
- Mode: own copy, sampled
- Source: dump written by command with \`nodejs\` in \`.\`: \`node\` \`scripts/production-dump.js\` \`{dump}\`
- Unlisted tables: all up to \`10000\` rows

### Tables

- \`countries\`: all
- \`jobs\`: recent by \`created_at\`, last \`180\` days
- \`job_events\`: recent by \`id\`, newest \`200000\` rows
- \`messages\`: recent by \`sent_at\`, last \`90\` days, newest \`50000\` rows
- \`sessions\`: none

### Links

- \`jobs.vessel_id\` to \`vessels.id\`

### Keep together

- \`invoices\` keeps every \`invoice_lines\` row by \`invoice_id\`

### Contacts

- \`users.email\`: email
- \`users.mobile\`: phone
`
  }),
  sectionSpec({
    name: "packaging",
    title: "Packaging",
    section: VIBE64_PACKAGING_SECTION,
    contract: VIBE64_PACKAGING_CONTRACT,
    summary: "Source facts Vibe64 needs to turn this project into distributable packages: registry packages, static web bundles and generated mobile app shells. Where each package is published (targets, channels, builders) is Vibe64 project state, never this section.",
    body: `
Headings: \`\` ${PACKAGING_HEADING_FORM} \`\`, each followed by entries:
${list(PACKAGING_ENTRY_FORMS)}

- Packers (closed set): ${VIBE64_PACKAGING_PACKERS.map((packer) => `\`${packer}\``).join(", ")}. Package ids are unique lowercase ids with single hyphens.
- \`npm\`: Version from \`package.json\` or \`external\`; Vibe64 runs \`npm pack\` in Workdir after the optional Prepare and Build steps.
- \`python-dist\`: Build (for example \`python\` \`-m\` \`build\`), Output (for example \`dist\`) and Version from \`pyproject.toml\` or \`external\` are required.
- \`web-bundle\`: a static client build used as Content by app packers. Build and Output are required; it has no version of its own.
- \`capacitor\`: Content, Platforms (only \`android\` today), Id, Name, Icon and Version from are required. Content names a \`web-bundle\` package. Id is permanent once published. Icon is a 1024x1024 PNG without alpha. Write one Permission per native capability with the reason people will read. There is no Plugin list: the generated shell installs the Content package's native plugins at its lockfile versions. Native projects are generated per build and are never committed.
- Deep link scheme from and App link domains from name variables declared in \`## Environment defaults\` (for example \`APP_URL_SCHEME\`, \`APP_LINK_DOMAINS\` as a comma-separated list), so the server and the app shell read one value.
- Environment entries are build-time, non-secret values for that package only; credential-shaped names are rejected. Nothing takes placeholders. \`external\` means a release tool such as Changesets owns the version and Vibe64 only reads it. Build numbers are never in source.
- Write this section only when the person adds a first publishing target, from the selected Stack pieces' packaging recipe and the project's actual scripts and manifests.
`,
    example: `
### Package \`web-mobile\`: Mobile web client

- Packer: \`web-bundle\`
- Runtimes: \`nodejs\`
- Prepare \`Install dependencies\`: \`npm\` \`ci\`
- Build \`Build bundled client\`: \`npm\` \`run\` \`build\`
- Environment \`VITE_API_BASE_URL\`: \`https://notes.example.com\`
- Output: \`dist\`

### Package \`app\`: Notes

- Packer: \`capacitor\`
- Content: package \`web-mobile\`
- Platforms: \`android\`
- Id: \`com.example.notes\`
- Name: \`Notes\`
- Icon: \`assets/icon-1024.png\`
- Version from: \`package.json\`
- Deep link scheme from: \`APP_URL_SCHEME\`
- Permission \`camera\`: Take photos to attach to notes.

### Package \`sdk\`: Notes SDK

- Packer: \`npm\`
- Workdir: \`packages/notes-sdk\`
- Runtimes: \`nodejs\`
- Version from: \`package.json\`
`
  }),
  sectionSpec({
    name: "resource-estimates",
    title: "Resource estimates",
    section: VIBE64_RESOURCE_ESTIMATES_SECTION,
    contract: VIBE64_RESOURCE_ESTIMATES_CONTRACT,
    summary: "Optional memory planning hints for Outputs and Workspace setup. They are not observed usage, reservations, minimum requirements or granted limits; the execution host owns those choices.",
    body: `
Headings: \`\` ### Output \`id\` \`\` (an id declared in Outputs) or \`### Workspace setup\` (requires declared setup steps), each followed by fields:
${list([...VIBE64_RESOURCE_ESTIMATE_FIELDS.keys()].map((field) => `- ${field}: \`number\``))}

- An interactive output declares the four Startup and Running fields. A finite output and Workspace setup declare only Typical MiB and High MiB.
- Values are integer MiB from 1 through ${VIBE64_RESOURCE_ESTIMATE_MAX_MIB}; typical never exceeds high. Duplicate operations or fields and unknown fields are rejected. The section is at most 64 KiB and 2048 lines.
- Invalid estimates never change Outputs availability or setup readiness; the host then uses its generic policy. Changing only estimates does not rerun setup.
`,
    example: `
### Output \`app\`

- Startup typical MiB: \`1024\`
- Startup high MiB: \`1536\`
- Running typical MiB: \`768\`
- Running high MiB: \`1536\`

### Workspace setup

- Typical MiB: \`1024\`
- High MiB: \`1536\`
`
  }),
  sectionSpec({
    name: "connected-development",
    title: "Connected development",
    section: VIBE64_CONNECTED_DEVELOPMENT_SECTION,
    contract: VIBE64_CONNECTED_DEVELOPMENT_CONTRACT,
    summary: "How this project consumes the working source of its connected repositories (its own dependencies under development) in a session.",
    body: `
Entries:
${list(CONNECTED_DEVELOPMENT_ENTRY_FORMS)}

- Declare a Default package type, a Sources file, or both. Prepare, Verify and Save entries and a Custom runner need the Sources file. All Prepare entries precede Verify entries, and Save entries come last. Steps run unconditionally (no \`when\`/\`if\`); at most one Custom runner.
- Save entries run when the session is saved, after its connected copies are saved and their pins recorded, before the project's own commit, which takes what they change; one that fails stops that commit. Use them for what Vibe64 does not record itself, such as a custom connection's release state. A \`composition\` connection needs none for its pin: Save writes \`${CONNECTIONS_LOCK_FILE}\` (schema \`${CONNECTIONS_LOCK_SCHEMA}\`: \`{"repositories":[{"name","repository","commit","tree"}]}\`) with each composition's saved commit, in the same commit, so the project's composer reads the pin from there. A typed \`dependency\` has no pin: Save moves the project's own manifest and lock to a newly published version, and Staging and Production install what they name.
- Package types: ${CONNECTED_PACKAGE_TYPES.map(({ value }) => `\`${value}\``).join(", ")}. For every type but \`custom\`, Vibe64 itself puts each \`dependency\` connection in effect in the session (its own step after every Prepare entry) and proves it (its own check after every Verify entry), with no project command; \`- Default package type: <type>\` alone is enough. Project Prepare/Verify entries are for what Vibe64 does not do: a \`composition\` connection needs a Verify entry proving the project assembles it. A \`gradle\` connection needs no flag: every command of the session gets its own Gradle user home, whose init.d includes the connected checkouts.
- The Sources file is a development-only path outside \`.git\`, never tracked; Vibe64 writes it when it prepares the session's connected repositories and excludes it from Git. Its JSON: \`{"schema":"${CONNECTED_SOURCES_CONTRACT}","sessionId":"…","repositories":[{"name":"…","repository":"https://github.com/owner/repo","relationship":"dependency|composition","type":"npm","sourceRoot":"/absolute/session/connected/repo"}]}\`; each \`sourceRoot\` is this session's own copy of that repository, and a custom connection also carries \`"script"\`.
- Custom connections: ${CONNECTED_CUSTOM_RUNNER_CONTRACT}
`,
    example: `
- Default package type: \`npm\`
`
  }),
  sectionSpec({
    name: "project-services",
    title: "Project services",
    section: VIBE64_PROJECT_SERVICES_SECTION,
    contract: VIBE64_PROJECT_SERVICES_CONTRACT,
    summary: "Foreground helper processes (workers, local reference services) that Vibe64 starts before an Output.",
    body: `
Entries:
${list([PROJECT_SERVICE_ENTRY_FORM])}

- Service ids are unique, start with a lowercase letter and use up to 64 lowercase letters, digits and hyphens. Workdir defaults to \`.\`.
- Without \`per session\` all sessions share one instance; with it each session gets its own instance in its own source directory.
- Services run with the project's development Env, stay in the foreground and release everything they own on SIGTERM. Never spawn untracked background work.
- Vibe64 owns process lifetime, not the network protocol: allocate a distinct endpoint (for example bind port 0 and record the address in the session's ignored runtime folder) and check your own instance's readiness. Never assume a shared fixed port.
`,
    example: `
- Start \`worker\` with \`nodejs\` in \`tools\`: \`npm\` \`run\` \`worker\`
- Start \`reference\` per session with \`nodejs\`: \`npm\` \`run\` \`reference:service\`
`
  }),
  sectionSpec({
    name: "integration-setup",
    title: "Integration setup",
    section: VIBE64_INTEGRATION_SETUP_SECTION,
    contract: VIBE64_INTEGRATION_SETUP_CONTRACT,
    summary: "The one application-owned command the editor's Integrations controls call to configure, connect and check the application's external integrations.",
    body: `
Exactly one entry:
${list([INTEGRATION_SETUP_ENTRY_FORM])}

The command's request/response protocol and the \`integrations.json\` usage: \`vibe64-helper spec integration-setup-command\`.
`,
    example: `
- Command with \`nodejs\` in \`.\`: \`node\` \`scripts/integrations.js\`
`
  }),
  sectionSpec({
    name: "architecture-inspection",
    title: "Architecture inspection",
    section: VIBE64_ARCHITECTURE_INSPECTION_SECTION,
    contract: VIBE64_ARCHITECTURE_INSPECTION_CONTRACT,
    summary: "Optional project-owned inspectors that the Architecture view runs to observe the application's structure (pages, routes, entry points).",
    body: `
Headings: \`\` ### Inspector \`id\`: Title \`\`, each followed by fields:
${list(Object.entries(ARCHITECTURE_INSPECTOR_FIELDS).map(([label, [, value]]) => `- ${label}: ${value}`))}

- Every field except Entry files, Required files and Preview locator is required; ids are unique. The Runtime must be selected in the Stack.
- Reading declarations runs nothing. Entry files name application entry points. Required files must exist as regular project files before the inspector runs.
- Preview locator names the technology's script that maps a clicked Preview element to its source component: a project \`.js\` file (it may be under \`node_modules\`), regular, at most ${ARCHITECTURE_PREVIEW_LOCATOR_MAX_BYTES} bytes. The only symlink its path may pass is one linked package folder (\`node_modules/<name>\` or \`node_modules/@scope/<name>\`); the file must stay inside that package's real folder.
- On analysis the command receives one \`jskit.architecture-inspection-input.v1\` JSON request on stdin (files with hashes, packages, package identity, UI discovery, the Stack hash and an optional \`cacheDirectory\`) and must print one \`${ARCHITECTURE_OBSERVATIONS_SCHEMA}\` JSON document; Genesis owns that observation schema.
- \`cacheDirectory\` is an absolute directory for this inspector alone, outside the source; the inspector may read and write only there. When it is absent or unusable, inspect without a cache. Ignore unknown request fields.
`,
    example: `
### Inspector \`ui\`: UI routes

- Runtime: \`nodejs\`
- Directory: \`.\`
- Command: \`node\` \`tools/inspect-ui.mjs\`
- Timeout seconds: \`30\`
- Max output bytes: \`1048576\`
- Entry files: \`src/main.js\`
`
  }),
  sectionSpec({
    name: "architecture-layout",
    title: "Architecture layout",
    section: VIBE64_ARCHITECTURE_LAYOUT_SECTION,
    contract: VIBE64_ARCHITECTURE_LAYOUT_CONTRACT,
    summary: "Presentation groups for the Architecture view. Declarations neither discover subsystems nor change their ownership.",
    body: `
Headings: \`\` ### Group \`id\`: Title \`\`, each followed by:
    - Kind: ${ARCHITECTURE_LAYOUT_KINDS.map((kind) => `\`${kind}\``).join(" or ")}
    - Purpose: \`text\`
    - Subsystem: \`root\` (one or more)

- Every group needs Kind, Purpose and at least one Subsystem. Group ids are unique.
- A Subsystem is a directory root from \`genesis/subsystems.md\`; each root is placed once. A missing root is reported, never invented.
`,
    example: `
### Group \`shared\`: Shared libraries

- Kind: \`libraries\`
- Purpose: \`Code reused by every surface.\`
- Subsystem: \`packages/shared\`
`
  })
]);

export { VIBE64_GENESIS_AGENT_SPECS };
