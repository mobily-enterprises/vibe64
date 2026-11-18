# Interpret application deployment

Vibe64 turns a project's opaque Stack Deployment section into a safe,
machine-readable publication plan without AI interpretation or framework
guessing.

## Sources

- `packages/vibe64-genesis/src/server/index.js`
- Main: `packages/vibe64-genesis/src/server/applicationDeployment.js`
- `packages/vibe64-genesis/src/server/deploymentEntries.js`
- `packages/vibe64-genesis/src/server/deploymentServices.js`

## Public contract

`inspectVibe64Deployment()` asks Genesis for the exact composed Stack section
named `Deployment`, validates it under the Vibe64-owned
`vibe64.application-deployment.v2` contract, and combines it with the Stack's
declared resources. The source is strict Markdown; its normalized result
contains exact argument arrays, working directory, runtime requirements,
release-recreation paths, generated secret names, the setup code name, sandbox
allowances, system packages, how many instances a host may run, and success
condition.
Invalid, absent, and competing
declarations remain explicit states.

Commands are exact argument arrays with no placeholder expansion; `{host}` and
`{port}` are rejected. The executor starts the single, last Serve step with its
listen address in the `HOST` and `PORT` environment variables and probes the
Ready when path there. A host may also give Serve, and only Serve, its
runtime's conventional production setting such as `NODE_ENV=production`; a
value the project sets on the Serve step or in the deployment's Env wins.
No step inherits the editor's own `NODE_ENV` or `APP_ENV`.

`- Generated secrets:` names secrets the application needs as a
stable random value. The host stores one strong random value per name once,
when the deployment's Env has no entry with that name; it never replaces
a value someone set.

`- Setup code:` names the one secret of the deployment the application asks for when
its first account registers on the deployment's empty database, so that only the
project owner can create that account. The host generates it like a generated
secret, which is why a name may not be in both entries, and shows its value
only to the project owner. It never prints the value or gives it to an
assistant. A project declares it only when its application reads that variable.

`- Sandbox allows:` names, from the closed set `fuse` and `gvisor`, what the
application's own commands and release service may do beyond the ordinary
sandbox of a deployed application; the result lists them sorted, each at most once. `gvisor`
lets them start gVisor's rootless `runsc`; `fuse` lets them mount a FUSE file
system inside a user and mount namespace of their own. A host grants each only
where its owner permits it and refuses a deploy that needs one it does not grant;
[Workflow accounting](../execution/workflow-accounting.md) says exactly what
each adds to the sandbox.

`- Packages:` names, in backticks, the system packages the application's steps
and service need beyond its runtimes, by their nixpkgs names: an attribute such
as `git` or `python313Packages.pip`, or one output of it after `^`, such as
`gcc-unwrapped^lib`; at most 200, each once, kept in the order given. A host that
builds the deployment's machine from a package collection installs exactly these
beside its runtimes and refuses a name it doesn't have; a host that runs the
deployment on a machine it does not build, such as a workspace's own release
service, ignores the line.

`- Instances: up to` names, in backticks, how many identical copies of the
application a host may run at once behind one address, from 1 to 100; the
result is `instances: { max }`, 1 without the entry. An application declares
more only when no copy keeps anything a later request needs (files on its own
disk, sign-ins in memory or files, a job that must run once): such state
belongs in a declared resource. A host that runs one copy, such as a
workspace's own release service, ignores it; a host never guesses it.

## Services and resources

A Deployment may describe the application's services: each kind of process it
runs, as identical instances from the one build, under a heading
`### Service \`id\`: summary` (1 to 8; an id is a lowercase letter then up to
15 lowercase letters, digits and hyphens). The entries above the first heading
are shared by every service: Workdir, Runtimes, Recreate on restore, Generated
secrets, Setup code, Packages and the Prepare, Build and Migrate steps (one
build serves them all). Under its heading each service says its Exposure
(`public` or `internal`, exactly one public), its Serve step, Ready when and
Instances (`min` to `max`), and may say Needs at least (the smallest machine in
whole vCPUs and GiB), Production (the count Production starts with), Reached
(`each instance` for an internal service whose instances are reached one by
one), Reaches (a service it reaches and the setting that gets its address),
Setting (a non-secret fact of the source), its own Packages and Sandbox allows.
A top-level Serve, Ready when, Instances or Sandbox allows beside services is
refused with the fix; so are a duplicate id, no public service or two, a
Reaches to an unknown service or itself, a setting name used twice or owned by
the host (`APP_ENV`, `HOST`, `PORT`, `APP_PUBLIC_URL`, `TRUSTED_PROXIES`, any
`V64_` name), a generated secret's or the setup code's name, Reached on a public
service, and a Production count outside Instances. Each refusal names its line.

The result always carries `services`: a Deployment without headings is one
public service, `web`, made from its Serve, Ready when, Instances and Sandbox
allows, and its recipe hashes exactly as before. With headings, the top-level
fields a single-service reader uses describe the public service (its Serve
after the shared steps, its health and instances) and every service's sandbox
allowances, which one approval covers.

`### Resource \`id\`` names a resource of `## Resources` and says how
development provides it: `- Development: \`local folder\`` for a bucket the
application keeps in its own folder there, or `\`own bucket\`` (the default).
The result carries these as `deploymentResources`. The inspection, which has
the Stack's resources, refuses a heading for an undeclared resource,
Development on a resource that is not a bucket, and a service's Reaches or
Setting naming a setting a resource binds.

The Deployment guidance for assistants also says where host-level preparation
beyond the package manager and Packages goes: one script per hosting environment,
`scripts/hosting/<host>.sh`, named by the `HOSTING_SCRIPT` environment variable
and run by the Prepare step, and only in an application that needs one. It
never works around Vibe64's rules: what Vibe64 provides, such as a runtime or a
sandbox allowance, is declared in the section, never installed or switched on
by the script, and a host that lacks something makes it fail with one plain
sentence.

`APP_ENV` belongs to the host: it gives every step the environment it deploys
to, `staging` or `production`. The parser refuses a step argument that sets it
(`APP_ENV=...`) and a Generated secrets or Setup code entry naming it, and
refuses `SIDE_EFFECTS`, which `APP_ENV` replaced, in the same places; each
refusal names the fix. The Deployment guidance asks the application to follow
`APP_ENV` at run time through one helper, never `NODE_ENV`, which only picks
optimised builds: in `development` and `test`, email, SMS, push notifications,
webhooks and connector writes are logged; in `staging`, email and SMS go only
to `STAGING_EMAIL_TO` and `STAGING_SMS_TO` (logged when unset), the rest is
logged and payments use the provider's sandbox; only `production` is real, and
every other environment shows a banner naming it. Prepare and Build never need
the database or another managed service, so a host may run them alone, without
those credentials, to check a revision builds.
Vibe64 itself sets no `SIDE_EFFECTS`: its own features read the `APP_ENV` of
the process that starts it, which the execution gateway never passes on to a
project's commands. Its start command (`npx vibe64`, `npm start`, `npm run
server`, all `bin/server.js`) gives an unset `APP_ENV` `production`, with
`NODE_ENV=production`; `npm run dev` and `npm run dev:example` give it
`development`. A value already set wins, so the commands of a Vibe64 session,
which carry `APP_ENV=development`, stay in development.

Genesis does not know what Deployment means. Vibe64 does not infer scripts from
the selected language or framework. The application or technology Stack owns
the scripts and checks; a project-owned section replaces a component proposal
when the real source differs.

## Implementation map

- `parseVibe64DeploymentLines()` — validates the consumer-owned section without shell evaluation.
- `vibe64DeploymentInspection()` — binds the parsed plan to the exact Stack and resource inspection.
- `exactGenesisInspection()` — rejects an unexpected generic Genesis contract identity.
