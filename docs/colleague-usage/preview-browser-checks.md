# Browser checks from chat

Ask the coding agent in chat to test the running application in a browser and
specify the flow to check. The agent uses the session's managed browser tools;
you do not need to provide an execution ID or change application code to enable
them. Application login may still require your credentials or interaction.
The managed browser keeps its page and login between the coding agent’s tool
commands. Stopping Preview, closing the session, resetting the managed browser
or losing its editor connection can require login again. If it repeatedly loses
login during ordinary checks, ask the coding agent to inspect browser lifecycle
errors; shortening waits is not a recovery for a stopped browser.
If a check reports **Launch preview token is missing or invalid**, use the
current Preview link and the session's managed browser, not a copied link from
an earlier launch. Managed browser code can navigate to `preview.url` using
its existing authenticated context; that URL does not expose the access token.
A persistent token error needs browser-access investigation, not a pool restart.

The coding agent runs managed test suites and live Preview browser checks one
after the other. A suite owns Preview until its cleanup and restoration finish;
the agent can read status and logs while waiting, then confirms there is no
active test run and the restored Preview is ready before live inspection. This
also applies after cancelling a suite. If restoration fails, ask the coding
agent to recover that existing run before another check. **Test Preview**
identifies the test environment while it is selected. Colleague can explain the
sequence and offer coding-agent assistance through the existing chat controls.
While a suite runs in the background, the coding agent waits on its existing
execution and checks logs when output or state changes, rather than repeatedly
reading unchanged logs between short waits.
Where its command tool supports `yield_time_ms`, an empty progress wait uses
`30000`; shorter waits are for interactive input or a specific immediate check.

Ask the coding agent to run browser-owning Node integration tests through
`vibe64-helper playwright npm-run` as well. The project can declare these as
`test:playwright:<name>` npm scripts. They use the host's browser task budget,
which counts all Node and Chromium threads. Colleague can explain this route
and offer coding-agent assistance; it cannot change host resource limits.
Managed suites and their setup include the Git runtime for repository fixtures.
Other tool dependencies still need their own declared runtime support. A fixture
setup failure does not count as a failed application assertion or a passing check.

The coding agent can read `vibe64-helper playwright --help` before a project has
browser tests or a matching test runtime. `vibe64-helper preview --help` (also
`preview browser --help`) works even while the assistant's Preview control is
disconnected; it lists every browser command, including `browser storage-state`,
and the fields of the status, screenshot and eval JSON. Help starts neither
Preview nor a browser.
An actual suite still requires the project's installed Playwright version and a
matching managed runtime. A version error is a test-runtime blocker; interactive
checks can use the existing managed Preview browser. Report the exact required
version to the platform operator instead of installing a separate browser.
On a computer without managed browser runtimes, the agent runs the project's own
Playwright (`npx playwright test`). Interactive Preview checks (screenshot, eval)
use the project's own Playwright, or else the `playwright` command installed on
this computer, so a project in another language needs no Playwright package. If
neither exists, the agent asks you to install Playwright on the computer rather
than adding it to a non-Node.js project. If that browser is missing, the agent reports
it and asks you before running `npx playwright install chromium`; installing it
is your decision.

Before a suite, the coding agent can run `vibe64-helper playwright readiness`.
It distinguishes absent tests, uninstalled dependencies, an unsupported exact
runtime and a supported installed dependency without starting Preview or a
browser. `ready` confirms dependency/runtime availability, not passing tests or
application readiness. `status` separately reports an active test run. Colleague
can explain these outcomes and delegate investigation to the coding chat; it
does not receive shell access through this guide.

If the agent reports “Browser testing requires a live assistant execution owner,”
the browser test did not start. This is an assistant runtime problem. After the
host runtime has been fixed and restarted, send a new chat message asking the
agent to retry the check. Colleague can explain this recovery and inspect Preview
state through its existing actions; it does not receive shell or browser-test
access from this guide.
