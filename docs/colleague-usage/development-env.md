# Development credentials for agents and browsers

An installed Elastic Beanstalk runtime uses ID `awsebcli` and command `eb` in
coding and terminal execution. Its installation and AWS credential policy belong
to the host; standalone Vibe64 does not install that CLI or configure credentials
automatically. Use the host's setup instructions when it provides a managed EB
launcher. Development Env reaches it through the same command environment as
other project tools.

Open the project's **Env** view and select **Development**. Enter the variable
name and value, enable **Secret** for credentials, then choose **Add** or
**Replace value**. Existing editable rows also offer **Save**.
Stack defaults are editable fallbacks: saving one creates a project override,
and removing that override reveals the current declared default again. Defaults
are user-owned in Env; platform-injected runtime values remain system-owned and
non-editable, even when Stack declares the same name. Reserved Vibe64-prefixed
names require a Stack declaration before a user can supply them. When a Stack
resource, such as a starter's database, is not yet configured, its bindings that
have a default keep their default row; only the values without one, for example
`DB_PASSWORD`, appear as empty rows to fill, and the setup message lists them
as missing.

Two more resource kinds can appear in a Stack. A **Redis** resource (kind
`redis`) is the address the app's servers share live updates through, such as
`REALTIME_REDIS_URL`; on your own computer you run a Redis-compatible server
yourself, such as Valkey, and enter its address in that row, just as for a
database. A **bucket** (kind `bucket`) is
object storage you hold with an S3-compatible provider. Development never asks
for a bucket's settings: no rows appear for it, the setup message does not list
them, and the app keeps its files in its own default storage, usually its own
disk. To try your real bucket in development, add the same names yourself (for
a JSKIT app `JSKIT_STORAGE_DRIVER` set to `s3`, plus `JSKIT_STORAGE_S3_BUCKET`,
`JSKIT_STORAGE_S3_REGION`, `JSKIT_STORAGE_S3_ENDPOINT`,
`JSKIT_STORAGE_S3_ACCESS_KEY_ID` and `JSKIT_STORAGE_S3_SECRET_ACCESS_KEY`, the
last as **Secret**). A Stack whose Redis or bucket declaration names the wrong
values is refused with a message naming each one; ask the coding agent to fix
the Stack's Resources. Colleague can explain this and open Env; it never
receives the values.

**Download .env**, beside **Refresh** at the top of **Env**, saves every
Development value, secrets included, as one plain file named
`<project>-development.env`. It starts with comments naming the project, the
environment and the download time, then lists **User values** (including linked
rows) and **System values** as `KEY=value` lines; a variable without a value is
written `KEY=`. Simple values stay bare and others are single-quoted, so `$`,
`"` and `\` stay literal; only a value containing `'` or a line break is
double-quoted, with `\n` for each line break. npm `dotenv`, Node's `--env-file`
and Docker Compose read the file alike, except that in a double-quoted value
Compose still expands `$` and Node ends the value at a `"`.
Only the Vibe64 owner can download, and the button shows its progress while the
file is prepared; a refusal or failure appears above the list. The file holds
real secrets: keep it private and never paste it into chat. Colleague cannot
download it or read its values; it opens Env so the person can.

Saved development values are available to the coding agent, its managed browser,
and managed Playwright commands. For an authorized external site, tell the coding
agent which variable names contain its URL and credentials. Values need not be
pasted into chat or copied into source. Presence in Env confirms configuration,
not a successful login. Because the coding agent receives every Development
value, use test credentials there (for example Stripe test or restricted keys);
live credentials do not belong in Development Env.

When the application needs a generated secret, such as an application key, the
coding agent generates it with the framework's own command and stores it as a
**Secret** Development value through `vibe64-helper env set`. It never writes the
value into a generated `.env` file: Vibe64 rewrites that file from Env, so an
edit there would be lost. The key then appears in **Env** with its value hidden.
`vibe64-helper env set`, in Development and Staging alike, stores what is
piped to it without its one final line break, the one `echo` or a generator
such as `openssl rand` prints, so `echo "$KEY" |` stores exactly the key. Every
other character, spaces included, is kept; a value that must end with a line
break is piped with two. Env's **Value** field holds one line and drops a final
line break the same way.

When the host offers saved values, `vibe64-helper env saved` lists their names,
descriptions and fields, never their values. To use one, link it to the
variable the application already reads (`vibe64-helper env link development
STRIPE_SECRET_KEY <id> apiKey`) instead of asking the person to paste a key.
A linked row is not editable; `vibe64-helper env unlink` returns it to an
ordinary empty row. Env shows a linked row as one line with a link icon and
the host's provenance label; on a phone each variable becomes a small card. A
managed resource of the same name still wins.

An application whose first account becomes its owner can name, in its Stack's
`## Deployment`, the Staging Env variable holding the one-time code that first
registration needs (``- Setup code: `NAME` ``). A host that publishes projects
generates that code and shows it to the project owner alone; the Staging
status lists the name, never the code, so the coding agent sends the person to
the host's page that publishes to Staging for it.

When the host publishes projects, `vibe64-helper deployment status` shows the
coding agent the session project's Staging: whether it is published, its
public addresses, the current release with its commit, publish time and recorded
Deployment commands, its Staging Env variable names with their source, and what
is missing before the next publish, and whether the session may use staging
itself. It never shows a value and changes nothing. Where the installation does
not publish projects it says so. Changing a Staging Env value from a session is
the host's decision for the person whose session it is; when the host refuses,
the agent reports the host's message instead of retrying.

Where the host offers it and allows the session, the coding agent can also work
on staging itself, to find out what is wrong there:

- `ssh staging` logs in to the staging host as the live release's own
  application account, in its folder, with the Env it runs with (its database
  connection included). `scp`, `sftp` and `rsync` reach `staging:<path>` the
  same way. Inside, `staging-logs [--lines <n>] [--since <time>]`,
  `staging-status` and `staging-restart` read or restart the app's own
  service, and `staging-enter [command]` runs the command, or a shell, where
  that running service runs: the files it sees, its own mounts included (its
  private `/tmp`, a FUSE volume it mounted), which the login itself does not
  see. It is not root and has no general sudo, since the host may also run
  Vibe64 and other projects.
- `vibe64-helper env get staging <KEY>` prints one value the live release
  runs with, secrets included, and `vibe64-helper env export staging` prints
  them all as shell `export` lines.

The host records each value read and each login's start and end. Each login
also reports the commands it runs, word for word, so secrets belong in Env,
never on a command line. Where the host does not allow the session, both say
why and do nothing. The command's own help asks the agent to
read first (logs, status, read-only commands), to back up before changing data
or files and to say what will change, since staging may hold real people's
data, and to keep staging values out of source, messages and summaries.
Local Vibe64 publishes nothing, so it has no staging to reach.

Each managed shell command reads current Development Env, so the coding agent's
next command receives added or changed values without restarting its conversation.
The agent can use ordinary application commands; it does not need to copy managed
credentials into source or write environment-injection code. An environment-read
failure blocks that command and should be reported for investigation. Provisioning
a newly declared resource and running application migrations remain preparation
steps; configured names alone do not prove either has completed.

A framework mode such as `NODE_ENV` comes only from the project: a Development
Env value (or its Stack default), a launch's own settings, or the command itself
(`NODE_ENV=test npm test`). Vibe64 never passes on the mode it runs in itself, so
Workspace setup installs development dependencies, and terminals, tests and
agent commands run without `NODE_ENV` unless the project sets it. Preview starts
with `NODE_ENV=development`, which a Development Env value or the launch's own
settings may change. Staging's mode belongs on the Stack's Deployment Serve
step. Colleague can explain this and open Env.

`APP_ENV` says where the application runs, and Vibe64 sets it: everything a
session runs (Preview, terminals, tests and agent commands) gets
`APP_ENV=development`, whatever the project's own Env or launch says. An
application that follows the Stack's Deployment contract
(`vibe64-helper spec deployment`) then sends no email, SMS, push notification,
webhook or connector write from there, writes each to its log, uses its
payment provider's sandbox and shows a banner naming the environment. A test
command sets `APP_ENV=test` itself. Env cannot hold `APP_ENV`: saving it is
refused with the reason, and a value saved before can only be removed. Nor can
it hold `SIDE_EFFECTS`, which `APP_ENV` replaced: an application on JSKIT
0.2.84 or later refuses to start while it is set, so Preview would not start.
Saving it is refused with "SIDE_EFFECTS was replaced by APP_ENV; remove it from
Development Env.", and a value saved before can only be removed: choose
**Remove** on its row, or ask the coding agent to run `vibe64-helper env remove
development SIDE_EFFECTS`. A host
that publishes projects gives Staging `APP_ENV=staging`, where email and SMS go
only to `STAGING_EMAIL_TO` and `STAGING_SMS_TO`. A host may also let the
project's owner mark that real people use a Staging, while the project has no
Production; it then gives that Staging `STAGING_REACHES_REAL_PEOPLE=true`, and
its email and SMS go to the people they are for. Only the host gives it: Env
refuses it, with "STAGING_REACHES_REAL_PEOPLE is not an Env value: a host gives
it to a Staging only while the project's owner marks that real people use that
Staging.", a value saved before can only be removed, and a Deployment step,
Generated secret, Setup code or a service's Setting or Reaches cannot name it.
An application on JSKIT refuses to start with it anywhere but Staging.
Colleague can explain this.

The three environments, as Colleague explains them:

|  | Development | Staging | Production |
|---|---|---|---|
| What | sessions, Preview and a developer's own machine | what a host publishes from the workspace, to check it outside development | a separate production deploy that a host offers |
| `APP_ENV` | `development` (`test` in automated test runs) | `staging` | `production` |
| `NODE_ENV` | `development` in Preview | `production` | `production` |
| Settings | Development Env | Staging Env | Production Env |
| Databases | development | staging | production |
| Email and SMS | logged, not sent | sent only to `STAGING_EMAIL_TO` and `STAGING_SMS_TO`; logged when unset; sent to the people they are for when real people use it (`STAGING_REACHES_REAL_PEOPLE=true`, which only the host gives) | sent |
| Push notifications, webhooks, connector writes | logged | logged | real |
| Payments | the provider's sandbox | the provider's sandbox | live |
| Banner on every page | "Development" | "Staging" ("Staging · real people" when real people use it) | none |
| Development shortcuts (development sign-in, relaxed cookies, test databases) | allowed | refused | refused |

For a long-running shell task, the coding agent can request its native tool's
background mode and timeout. Binding the command to the Vibe64 session preserves
those settings; the coding tool still applies its own supported limits. This is
not a promise that the process survives a workspace restart. Use the project's
declared managed outputs/services for persistent application servers. If a task
unexpectedly runs in the foreground or times out, report its requested settings
and returned task ID rather than starting a duplicate or detaching another copy.

The coding agent can read `vibe64-helper session status --json` for current
resource readiness, environment names, declared Workspace setup commands and
managed tool entry points. This read exposes no environment values and starts
no preparation. Repeat it after changing resource declarations. A
`not-prepared` resource requires Workspace setup; it is not a request to invent
credentials. Starting Preview (`vibe64-helper preview ensure --wait`) prepares
the workspace, so the agent rereads the status before reporting preparation. In
the session chat, **Prepare workspace** or **Retry** on a failed preparation
does the same once the assistant has finished. A failed setup is never reused:
a deliberate Preview start, **Retry setup** in the Preview pane or
`vibe64-helper session setup retry` runs it again. Adding a resource
requires preparation even if the dependency-install command has not changed.
An earlier successful preparation does not cover a changed setup recipe or newly
unprepared resources. Preparation retry checks the current requirements before
starting; the session's other work must finish first.
Colleague can inspect preparation and retry it through its existing session
actions when asked; it does not run these shell helpers itself.

The same status names the session's repository commands under `tools`:
`vibe64-helper session update` runs this session's **Update this session
(rebase)**, and `vibe64-helper session save` runs its **Save**, for Main chat's
agent while **Automatically save changes** is on; elsewhere it refuses and says
why. See [The session's AI updates the session itself](github-work.md#the-sessions-ai-updates-the-session-itself)
and [The session's AI saves its finished stages](github-work.md#the-sessions-ai-saves-its-finished-stages).

For a reference application that must remain warm between tests, ask the coding
agent to declare a **per-session supporting service** in the project's Stack.
Starting that session's declared output starts its service; later test runs reuse
it. Each session needs its own endpoint and readiness check. **Stop preview**
stops the displayed app, not these supporting services. Archiving/closing the
session stops its supporting instances, and closing the project stops all of them.
The project command remains responsible for endpoint selection and clean shutdown.
Development Env values are shared across the project, so setting a port there does
not give different sessions different ports. Colleague can explain this and offer
to ask the coding agent to configure it; it cannot run a shell command itself.

Long-running processes retain their startup values. After changing credentials, ask the
coding agent to close its managed browser with `vibe64-helper preview browser
close` before retrying; its next browser command starts a fresh process with the
current values. This also ends that browser's existing login session. Each new
Playwright command reads current values. Saving Env does not restart applications
or existing agent processes.

Colleague can inspect names, whether values are configured, and who owns them.
It opens Env for secret entry or inspection and can ask a coding agent to perform
the authorized browser work. Colleague does not receive stored secret values.
If a configured value is absent in a newly started process, report the affected
command and variable name for investigation; do not ask the person to paste the
secret into chat or assume that their external account is broken.
