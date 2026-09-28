# Preview application identities

People can inspect an application as one of a small set of named application
users without turning that convenience into a production sign-in mechanism.

## Sources

- `packages/vibe64-project/src/server/previewApplicationIdentities.js`
- `packages/vibe64-project/src/server/actions.js`
- `packages/vibe64-project/src/server/inputSchemas.js`
- `packages/vibe64-project/src/server/settingsAssistantContracts.js`
- `tests/server/vibe64SettingsActionTools.unit.test.js`
- `packages/vibe64-terminals/src/server/previewIdentityCommand.js`
- `packages/vibe64-terminals/src/server/agentPreviewCommand.js`
- `packages/vibe64-execution/src/server/runtime/agentPlaywrightCommandSource.js`
- `packages/vibe64-execution/src/server/runtime/agentPreviewBrowserWorkerSource.js`
- `packages/vibe64-genesis/src/server/outputs.js`
- `packages/vibe64-terminals/src/server/outputTargetTerminal.js`
- `src/components/studio/PreviewIdentitySettings.vue`

## Public contract

Managed app access stores named selectors in `.vibe64/preview-identities.json`
inside the exact selected source, so session changes follow ordinary Save.
Colleague reads and replaces the same complete ordered list through the canonical
Project actions. The first entry is the default. It preserves unrequested entries,
uses the user's actual identifiers and retains the ordinary project permissions
and source-work locks. Inputs describe name, selector type and value explicitly;
the existing owner validates unique names, supported selectors and the 32-entry
limit. Responses contain selectors without filesystem paths or authentication
secrets. Configuring this list does not prove account existence, application
support or an authenticated browser session.

When a
web-presented Vibe64 Outputs target declares
`vibe64.preview-identity.command.v1`, Vibe64 offers those names and guest mode,
maps the command's declared runtimes, invokes the safe committed
application-owned executable with a fresh per-run secret, and refreshes the
managed browser session. The executable may select an existing application
user by the declared email, login, or user-ID selector. Arbitrary caller
identities are rejected, and Vibe64 never creates users or changes their roles
or data.

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
guidance show route navigation relative to that URL.

After a service restart, stale browser metadata may no longer match the current
control token. Browser recovery uses the execution manager's durable ownership
for the exact project and session, never an execution ID from invalid metadata.
Only a proven empty browser service scope and a dead control socket permit
replacement. Unproven cleanup or an unrelated live listener remains a visible
failure, and a later request can retry recovery. Playwright preparation failures
retain the underlying browser diagnostic rather than claiming authentication
failed before application login was reached.
