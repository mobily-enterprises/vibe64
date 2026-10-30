// Agent-readable specs of every Vibe64-owned Stack section, printed by
// `vibe64 spec <name>`. Entry forms and limits come from the parsers' own tables,
// and a focused test parses every example below with its real parser.
import { ARCHITECTURE_OBSERVATIONS_SCHEMA } from "genesis-compiler";

import {
  DEPLOYMENT_ENTRY_FORMS,
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
  VIBE64_WORKSPACE_SETUP_CONTRACT,
  VIBE64_WORKSPACE_SETUP_SECTION,
  WORKSPACE_SETUP_ENTRY_FORM
} from "./workspaceSetup.js";
import {
  CONNECTED_CUSTOM_RUNNER_CONTRACT,
  CONNECTED_PACKAGE_TYPES,
  CONNECTED_SOURCES_CONTRACT
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
- Steps run in order through managed execution with the session's development Env. Vibe64 records success against the exact recipe; changing any step runs setup again, and Outputs stay pending until it succeeds. Keep every step repeatable and non-destructive.
`,
    example: `
- Prepare \`Install dependencies\` with \`nodejs\`: \`npm\` \`ci\`
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
    summary: "The commands that turn a project revision into a running production application.",
    body: `
Entries:
${list(DEPLOYMENT_ENTRY_FORMS)}

- Steps are ordered ${DEPLOYMENT_STEP_ROLES.join(", ")}; exactly one Serve step comes last. Serve starts the long-running application, which listens on the address given by the \`HOST\` and \`PORT\` environment variables. Arguments are passed literally (no \`{host}\` or \`{port}\` placeholders), so a server that takes its address only as arguments needs a committed project script that reads them.
- Every step runs exactly as declared with the project's production environment. Vibe64 never sets a framework's production mode, such as \`NODE_ENV=production\`. Declare it on the Serve step, for example \`env\` \`NODE_ENV=production\` \`node\` \`server.js\`, not in the production environment or Prepare, where it can make package installation skip the build tools a later step needs.
- One Ready when entry is required (status 200 through 399). Workdir defaults to \`.\`. Each other entry appears at most once.
- Recreate on restore lists project-relative globs (only \`*\` and \`**\`) that a restored deployment rebuilds with its Prepare step, such as installed dependencies. It requires a Prepare step.
- Migrate applies pending migrations without destroying data.
`,
    example: `
- Runtimes: \`nodejs\`
- Recreate on restore: \`node_modules\`
- Prepare \`Install\`: \`npm\` \`ci\`
- Build \`Build\`: \`npm\` \`run\` \`build\`
- Migrate \`Migrate\`: \`npm\` \`run\` \`db:migrate\`
- Serve \`Serve\`: \`env\` \`NODE_ENV=production\` \`node\` \`server.js\`
- Ready when: \`GET\` \`/health\` returns \`200\`
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
    summary: "How this project consumes the working source of connected projects (its own dependencies under development) in a session.",
    body: `
Entries:
${list(CONNECTED_DEVELOPMENT_ENTRY_FORMS)}

- Declare a Default package type alone, or a Sources file with Verify entries or a Custom runner (keeping any Default package type). All Prepare entries precede Verify entries. Steps run unconditionally (no \`when\`/\`if\`); at most one Custom runner.
- Package types: ${CONNECTED_PACKAGE_TYPES.map(({ value }) => `\`${value}\``).join(", ")}. A type is a declared label: Vibe64 never runs a package manager for it. This project's own Prepare/Verify commands give each connected source its ecosystem's treatment, and Verify must prove that the source is consumed.
- The Sources file is a development-only path outside \`.git\`, never tracked; Vibe64 writes it when it prepares connected sources and excludes it from Git. Its JSON: \`{"contract":"${CONNECTED_SOURCES_CONTRACT}","sessionId":"…","projects":[{"name":"…","repository":"https://github.com/owner/repo","relationship":"dependency|composition","type":"npm","sourceRoot":"/absolute/receiving/source","contributionId":"…"}]}\`; a custom connection also carries \`"script"\`.
- Custom connections: ${CONNECTED_CUSTOM_RUNNER_CONTRACT}
`,
    example: `
- Default package type: \`npm\`
- Sources file: \`.connected-sources.json\`
- Prepare \`Link connected packages\` with \`nodejs\`: \`node\` \`tools/link-connected.mjs\`
- Verify \`Check connected packages\` with \`nodejs\`: \`node\` \`tools/verify-connected.mjs\`
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
- On analysis the command receives one \`vibe64.architecture-inspection-input.v1\` JSON request on stdin (files with hashes, packages, package identity, UI discovery, the Stack hash and an optional \`cacheDirectory\`) and must print one \`${ARCHITECTURE_OBSERVATIONS_SCHEMA}\` JSON document; Genesis owns that observation schema.
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
