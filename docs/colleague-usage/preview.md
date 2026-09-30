# Previewing a web application

Open the project's **Preview** tab. On mobile, use **Show project** from chat,
then **Show preview controls** to expand the toolbar. If the selected output needs settings,
choose **Preview options**, fill the required fields and choose **Run**.
**Remember for this project** saves those ordinary settings in this browser for
future sessions. **Cancel** leaves the current run alone.

If the previewed application shows its own login screen, enter that application's
credentials. Its login and realtime connection run through the Preview address.
HTTPS previews retain the HTTPS scheme for applications that use it to set
secure login cookies and redirects.
In the local editor, Preview keeps the editor's loopback hostname through login
and page navigation, so opening the editor on `localhost` also works. If a tab
shows an expired Preview access error after a restart, use **Reload preview**
to obtain its current address.

Preview lets the application request your microphone and play audio. Use its
microphone control and allow access when your browser asks. Permission is still
your choice; embedding an app does not grant it automatically. Use HTTPS for
remote previews or localhost on your own machine. If you denied access, change
the site's microphone permission in the browser and retry. Colleague can explain
these steps but cannot grant browser permission or record on your behalf.

**Reload preview** refreshes the embedded page. **Restart preview** starts the
application again. If startup fails, inspect the message and **Show run output**
before retrying. Hiding run output closes only the terminal view; it does not
stop the application.
Stopping or restarting a hosted Preview includes processes in its child groups,
that are owned by that output. Wait for cleanup to finish before starting
another run. If cleanup fails, open **Resources** for the reported operation
and retry only after its running work has been stopped.

Colleague can inspect the selected output and its logs, explain required fields,
and start or stop it through existing authorized actions. It must inspect current
state before starting and verify readiness afterward. An application's login
screen still requires the person's interaction or an explicitly authorized coding
agent; Colleague does not receive passwords from usage knowledge.

Independent temporary editors may contain the same example project/session yet
have separate Preview addresses. Use the current editor’s **Preview** controls;
an address from a discarded environment is no longer valid. No namespace or port
field is required. Colleague uses the current Preview result rather than
constructing an address.
If two temporary editors show the same address, their host routing configuration
needs correction. Restart the affected Previews after the host update; changing
an application's listening port is not required.

Some projects declare shared development services. Starting an output starts them
once for the project; subsequent sessions share them. Stopping an individual
Preview leaves these services available. Where your host provides project **Close**,
use it to stop all project work, including shared services. In a local directory
editor, shut down the editor normally. Hiding Preview, navigating away or closing a
browser tab does not perform project Close. Ordinary inactivity shutdown also
stops them. Shared services remain subject to hosted resource limits while idle.

If another branch changes a running service declaration, startup asks you to Close
and reopen the project. Save work as needed before doing so; this stops the other
sessions’ running tools too. A failed Close reports cleanup failure. Do not claim
resources were released until Close succeeds. Colleague can explain the result
and use the existing authorized project-close action; it does not execute shell
commands or invent application-specific teardown steps.
