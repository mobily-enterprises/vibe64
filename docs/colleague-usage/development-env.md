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
names require a Stack declaration before a user can supply them.

Saved development values are available to the coding agent, its managed browser,
and managed Playwright commands. For an authorized external site, tell the coding
agent which variable names contain its URL and credentials. Values need not be
pasted into chat or copied into source. Presence in Env confirms configuration,
not a successful login.

Each managed shell command reads current Development Env, so the coding agent's
next command receives added or changed values without restarting its conversation.
The agent can use ordinary application commands; it does not need to copy managed
credentials into source or write environment-injection code. An environment-read
failure blocks that command and should be reported for investigation. Provisioning
a newly declared resource and running application migrations remain preparation
steps; configured names alone do not prove either has completed.

The coding agent can read `vibe64-helper session status --json` for current
resource readiness, environment names, declared Workspace setup commands and
managed tool entry points. This read exposes no environment values and starts
no preparation. Repeat it after changing resource declarations. A
`not-prepared` resource requires Workspace setup; it is not a request to invent
credentials. In the session chat, wait for the assistant to finish, then choose
**Prepare workspace**, or **Retry** on a failed preparation. Adding a resource
requires preparation even if the dependency-install command has not changed.
An earlier successful preparation does not cover a changed setup recipe or newly
unprepared resources. Preparation retry checks the current requirements before
starting; the session's other work must finish first.
Colleague can inspect preparation and retry it through its existing session
actions when asked; it does not run these shell helpers itself.

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
