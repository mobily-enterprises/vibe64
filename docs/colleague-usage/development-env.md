# Development credentials for agents and browsers

Open the project's **Env** view and select **Development**. Enter the variable
name and value, enable **Secret** for credentials, then choose **Add** or
**Replace value**. Existing editable rows also offer **Save**.

Saved development values are available to the coding agent, its managed browser,
and managed Playwright commands. For an authorized external site, tell the coding
agent which variable names contain its URL and credentials. Values need not be
pasted into chat or copied into source. Presence in Env confirms configuration,
not a successful login.

Processes receive values when they start. After changing credentials, ask the
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
