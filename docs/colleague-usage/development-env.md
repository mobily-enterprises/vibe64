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
production credentials do not belong in Development Env.

When the application needs a generated secret, such as an application key, the
coding agent generates it with the framework's own command and stores it as a
**Secret** Development value through `vibe64-helper env set`. It never writes the
value into a generated `.env` file: Vibe64 rewrites that file from Env, so an
edit there would be lost. The key then appears in **Env** with its value hidden.

When the host offers saved values, `vibe64-helper env saved` lists their names,
descriptions and fields, never their values. To use one, link it to the
variable the application already reads (`vibe64-helper env link development
STRIPE_SECRET_KEY <id> apiKey`) instead of asking the person to paste a key.
A linked row is not editable; `vibe64-helper env unlink` returns it to an
ordinary empty row. Env shows a linked row as one line with a link icon and
the host's provenance label; on a phone each variable becomes a small card. A
managed resource of the same name still wins.

Each managed shell command reads current Development Env, so the coding agent's
next command receives added or changed values without restarting its conversation.
The agent can use ordinary application commands; it does not need to copy managed
credentials into source or write environment-injection code. An environment-read
failure blocks that command and should be reported for investigation. Provisioning
a newly declared resource and running application migrations remain preparation
steps; configured names alone do not prove either has completed.

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
