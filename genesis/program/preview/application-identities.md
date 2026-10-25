# Preview application identities

People can inspect an application as one of a small set of named application
users without turning that convenience into a production sign-in mechanism.

## Sources

- Main: `packages/vibe64-project/src/server/previewApplicationIdentities.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `tests/server/vibe64SettingsActionTools.unit.test.js`
- `packages/vibe64-terminals/src/server/previewIdentityCommand.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewWrapperSource.js`
- `packages/vibe64-execution/src/server/runtime/agentPlaywrightCommandSource.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewBrowserWorkerSource.js`
- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-core/src/server/previewAuth.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `src/components/studio/PreviewIdentitySettings.vue`
- `packages/vibe64-project/src/shared/onboardingRequest.js`
- `packages/vibe64-genesis/src/server/promptContext.js`

## Public contract

Existing-project adoption and inspection requests initiate the identity
conversation for authenticated web applications. Managed-preview session guidance
also covers an existing project whose login blocks inspection. The agent reuses
known answers, asks for existing development account selectors and their intended
roles/default, and waits before configuring access. It offers the existing
application-owned adapter and App access settings rather than demanding passwords.
Public/non-web projects need no identity setup; deferral remains explicit while
independent setup proceeds. Account names and the Vibe64 viewer grant no roles,
and configured selectors still require rendered authentication/access evidence.

Managed app access stores named selectors in `.vibe64/preview-identities.json`
inside the exact selected source, so session changes follow ordinary Save.
Colleague reads and replaces the same complete ordered list through the canonical
Project actions. A session's coding agent does the same with
`vibe64-helper preview identities [save]`: the preview command service scopes it
to the session's bound project and source, accepts only selector types its Stack
declares under `#### Preview identity`, and calls the same Project save. The agent
saves only names and accounts the person asked for or confirmed, never creates
application accounts or changes roles, and then verifies each name in Preview. The first entry is the default. It preserves unrequested entries,
uses the user's actual identifiers and retains the ordinary project permissions
and source-work locks. Inputs describe name, selector type and value explicitly;
the existing owner validates unique names, supported selectors and the 32-entry
limit. Responses contain selectors without filesystem paths or authentication
secrets. Configuring this list does not prove account existence, application
support or an authenticated browser session.
App access keeps an unsaved draft per project source (project and selected
session). A newer saved list from another tab, Colleague or the agent replaces
the draft only while it has no edits; under edits the page shows that the saved
identities changed, disables Save and offers **Reload saved identities**
(`tests/client/previewIdentitySettings.vitest.js`).

When a
web-presented Vibe64 Outputs target declares
`vibe64.preview-identity.command.v1`, Vibe64 offers those names and guest mode,
maps the command's declared runtimes, invokes the safe committed
application-owned executable with a fresh per-run secret, and refreshes the
managed browser session. The executable may select an existing application
user by the declared email, login, or user-ID selector. Arbitrary caller
identities are rejected, and Vibe64 never creates users or changes their roles
or data. The Outputs parser is the only validator of that command contract
(protocol, executable, identity types, environment names, runtimes and
timeout); launch, Preview auth and the command runner use its result as given.
This command is Preview's only authentication mode; a terminal recorded with any
other mode gets no Preview authentication.

Managed-browser identity selection always exchanges its grant at the canonical
Preview proxy URL. If earlier browser navigation left that origin, selection
returns the existing page to Preview first, without resetting the browser.
Navigation within Preview retains its current route. An exchange must return
explicit success; malformed responses fail with their HTTP status without
printing the response body or grant.

Preview status names only the proxy as the browser endpoint and uses it for the
observed page URL. The direct application endpoint is explicitly nested under
diagnostics for machine probes and the existing native application test runner.
`inspect-url` fails when the proxy is unavailable; it never substitutes the raw
application address. Browser eval exposes the canonical proxy as `preview.url`,
even after code has navigated the page elsewhere. Command help and session
guidance show route navigation relative to that URL. The preview wrapper owns
its help text and prints it without the control socket; the session command
service reuses that one text. When no identity is configured, status names the
helper save route.

After a service restart, stale browser metadata may no longer match the current
control token. Browser recovery uses the execution manager's durable ownership
for the exact project and session, never an execution ID from invalid metadata.
Only a proven empty browser service scope and a dead control socket permit
replacement. Unproven cleanup or an unrelated live listener remains a visible
failure, and a later request can retry recovery. Playwright preparation failures
retain the underlying browser diagnostic rather than claiming authentication
failed before application login was reached.
