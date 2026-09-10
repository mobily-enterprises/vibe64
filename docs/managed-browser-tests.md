# Browser tests with a separate Preview target

Use a declared test target when browser tests write fixtures or reset data that
must stay separate from the ordinary application's working data. This works
through the same Vibe64 commands for Codex and OpenCode, on any host that supplies
the project's declared runtimes and resources.

```sh
vibe64-preview targets --json
vibe64-playwright --target test-app test --config playwright.test.config.mjs
# Or run an existing package script containing the project's Playwright command:
vibe64-playwright --target test-app npm-run test:e2e
```

The target id is project-defined; `test-app` is an example, not a reserved name.
Vibe64 waits for that target, creates browser login state using its declared
Preview identity command, and supplies `PLAYWRIGHT_BASE_URL` to the suite.
It restores the previously running target after success, failure, timeout or
assistant cancellation. If Preview was stopped, it stops the test target again.
Restoration failure makes the command fail and identifies the remaining work.
Stopping or closing the session takes precedence over restoring its application.

While the suite owns Preview, another target change or restart is refused. The
person sees the test application in Preview during the run. Other sessions have
their own target selection; shared resources still require application-level
coordination. Do not run two suites that reset the same test database at once.

If the host offers approval for a marginal memory fit, this same command can
wait for up to five minutes after restoring the normal Preview. Chat shows
Waiting for memory approval. The owner can use Review memory to Start anyway
or Cancel test; closing the dialog or reloading the page does not cancel it.
Approval rechecks current capacity and the original assistant owner before
resuming the same suite. Do not start a replacement command while it waits.
Cancellation or expiry means tests were not run, not that assertions failed.
An ended command cannot be resumed later; retry it explicitly only after the
reported constraint has been addressed. Hard safety failures cannot be approved.

After a host service restart, inspect `vibe64-preview status --json`; the terminated
service cannot run its cleanup. Select the normal target explicitly if necessary:

```sh
vibe64-preview ensure --target app --wait --json
```

This command deliberately leaves its chosen target running. Use the scoped
`vibe64-playwright --target ...` command when automatic restoration is wanted.

## Application setup

Keep the normal target as the default. Add another web target to the existing
`## Outputs` section in `genesis/stack.md`, using scripts that actually exist:

```markdown
### Target `test-app`: Test Preview

- Mode: `interactive`
- Runtimes: `nodejs`
- Run `Start test application`: `node` `tests/support/start-test-app.mjs`

#### Presentation

- Kind: `web`
- URL path: `/`
- Ready when: `GET` `/api/health` returns `200`
```

The command above is an example of a portable application-owned launcher, not
a command provided by Vibe64. Adapt the runtime, path and readiness endpoint to
the project. Use the host's supplied `HOST` and `PORT`, or the Outputs contract's
`{host}` and `{port}` arguments, rather than starting another fixed-port server.

The application launcher must:

1. Validate the exact disposable test resource before resetting anything. When
   `TEST_DB_NAME` is supplied, use that exact database; do not derive another name.
   Check that it differs from the ordinary database before selecting it for the
   server process. Preserve any existing reset safeguards.
2. Prepare only that database and its fixtures. Choose its connection for the
   test server process without editing managed Env or generated `.env` files.
   Account for every connection alternative the application understands, such
   as `DATABASE_URL` taking precedence over `DB_NAME`.
3. Disable or replace real email, invoice delivery, payment requests and other
   external effects using the application's test controls. Changing the database
   alone does not disable those effects.
4. Report readiness only after fixtures and the server are ready. The suite must
   verify the actual server's test identity before sending destructive requests;
   the test runner's own environment and a target named “test” are not proof.

If login is required, declare the existing Preview identity protocol beneath
this target. Its application-owned identity executable must select the same test
database before resolving identities or producing cookies. Do not reuse an
identity executable that still reads the normal database.

The Playwright configuration must use `PLAYWRIGHT_BASE_URL` and
`VIBE64_PLAYWRIGHT_STORAGE_STATE` when supplied, and omit its own `webServer` in
that case. Keep standalone execution working with the application's own setup.
Do not overwrite `DB_NAME` in the test runner just to satisfy a safety check:
that cannot prove which database the independently running server uses.

When test resources, an isolated identity flow, or external-effect controls are
missing, report the specific missing prerequisite. Vibe64 manages the declared
processes; it cannot invent a safe testing contract for an arbitrary application.

The shared assistant session instructions include this workflow. New or refreshed
provider contexts receive updated instructions through their normal lifecycle;
an already active conversation may need an explicit instruction to read this
guide and run `vibe64-preview targets --json`.
