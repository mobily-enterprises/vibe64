---
name: genesis-security-pass
description: Close the ways software can be misused through an explicitly requested security pass over the whole app, a named section, or the agent's own changes, covering authorization on every route, action and job, sign-in and sessions, input handling, secrets, production settings, dependencies and outbound requests, each finding proved by sending the input that breaks it and seeing it refused once fixed. Use when asked for a security pass, hardening, a security review that fixes what it finds, or to check who can do what.
---

# Genesis security pass

Make the software refuse what it should refuse, and prove each refusal by
trying to get past it. A security pass is explicit: never run it merely because
implementation finished.

Resolve the invocation before running the first Genesis operation. Do not use a
Genesis operation or `genesis --version` as an availability probe.

1. Read the repository-root `package.json`. Treat Genesis as project-pinned only
   when that manifest's `name` is `genesis-compiler`, or its `dependencies`,
   `devDependencies`, or `optionalDependencies` contain the exact
   `genesis-compiler` key.
2. For a project-pinned repository, invoke every Genesis CLI operation with
   `npm exec --no -- genesis <arguments>`. This runs without fetching another
   package. If the declared package is not installed, report that the project's
   dependencies are not prepared; do not fall back to another Genesis version.
3. Otherwise, do not try `npm exec`. Run `command -v genesis` (or the current
   shell's equivalent `PATH` lookup). When it resolves an executable, invoke
   `genesis <arguments>` directly.
4. When neither source is available, stop and report that Genesis is
   unavailable. Never install or update Genesis merely to satisfy a workflow
   instruction.

Successful invocation resolution is routine. Do not narrate whether Genesis is
project-pinned or on `PATH`, and never describe direct `PATH` use as a fallback.
Mention how the invocation was selected only when resolution fails or the user
explicitly asks.

Follow the configured Collaboration approach for user-facing updates, including
its technical depth and response length. Report concrete progress,
findings, or blockers; do not announce that you are following guidance.

## Load the effective project instructions once

A security pass request may arrive as a complete Genesis-generated prompt or
as a direct request such as `Security pass` or `Security pass the billing
section`.

If the current task already contains `GENESIS CONTEXT` whose task is
`security-pass`, continue with it directly. Do not generate another prompt.

Otherwise, before resolving scope, run the Genesis `prompt --task security-pass`
operation once using the invocation rule above. For a bare `Security pass`
request, pass no request argument. When the user names a section, commits or
your own changes, pass that exact request as one safely quoted argument. Treat
the printed prompt as the instructions for this same turn; do not dispatch it
to another agent and do not generate it again. This step composes the selected
Stack's security pass guidance and any project customization with the portable
contract below.

When the user asks for a deep run of this pass, pass its Deep request,
`Security pass the whole app deeply.`, exactly;
Genesis then adds the run's `DEEP RUN` section.

## Resolve the scope

Inspect `git status --short` and the staged and unstaged diffs before editing.
A dirty worktree is allowed. Preserve the existing index and unrelated work; do
not stage, stash, commit, or discard changes as a prerequisite.

When the prompt has a `PASS RUN` section, the request is one of the pass's own
runs (the whole app, the changes since its last completed run judged against
the whole app, or a deep run) or a run over the changes since a base commit the
request names, and its scope is the one that section states, whatever the
defaults below say. A deep run's prompt also has a `DEEP RUN`
section; follow it with "Deep run" below.

- **The whole app (default).** Every way in: each route, page, command,
  action, message or socket handler, webhook, scheduled or background job,
  file or document the software reads from outside, and every outbound call.
- **A section.** A named area (a module, a route subtree, a subsystem): every
  way into it, touched or not.
- **The changes.** Your own changes for the current task, or explicit commits,
  established and resolved as for Deslop: the ways in they create or change,
  and the checks those depend on.

If the scope is ambiguous, ask which section or changes.

## Map the ways in first

Read the engineering approach and these sections of the sanity checks guide
(`.agents/skills/genesis-project/references/sanity-checks.md`): "Never do
these", "Inputs and access", "Production settings" and "Tests that prove
behavior". They describe what good looks like; this pass applies them across
the whole scope and fixes what they find.

Then list, for the scope, each way in with who may use it (anyone, a signed-in
person, a role, a member of one tenant or workspace, the owner of a record, the
system itself), what it reads and changes, each input it takes and where that
input ends up (a query, a shell command, a template, a file path, a URL the
server fetches, a message sent to someone), and the secrets it uses. List too
the sign-in, sign-up, password reset, invitation and token flows, how sessions
are kept and ended, and how a new deployment gets its first administrator. A
hole is most often a way in that nobody listed, so the map comes first and
every later step works through it.

The areas below are advice with their reasons. Apply the ones that fit the
software: a game without accounts has no password reset, a command-line
program has no cookies, and a single-person tool may have no tenants. Say
which areas do not apply, and why.

## Authorization

Every route, action and job refuses a caller without permission, because a
check that exists only in the interface is skipped by anyone who sends the
request directly.

- **Decide access first.** Check who the caller is and what they may do before
  anything else, including before validation answers. A caller without
  permission who sends a malformed request gets the refusal, not a list of
  field errors, which would describe what the endpoint accepts.
- **Trust only the trusted context.** Who is acting, their role and their
  tenant come from the signed-in session, a verified token or the job's own
  identity, never from an id, role or tenant the client sends. A client-sent id
  says which record is wanted; whether this caller may have it is decided on
  the server every time.
- **Refuse other people's ids.** Another tenant's or another person's ids are
  refused everywhere: reading, changing, deleting, listing, exporting, and
  linking them to your own records. Where possible, scope the query itself by
  the caller's tenant or ownership, so a forgotten check finds nothing rather
  than someone else's data.
- **Fail closed.** A missing value, scope, role, tenant or collaborator (a
  permission service, a policy, a configured list) refuses rather than allows.
  "Nothing configured" must never mean "everyone allowed".
- **Background work too.** A job, queue consumer or scheduled task acting for a
  person carries that person's access and is held to it when it runs. A
  webhook verifies its signature, or another proof of its sender, before it
  trusts its body.
- **Hidden is not protected.** A button that is not shown, an unlinked page or
  a long URL still needs the server's check.

## Authentication and sessions

- **Rate-limit what can be guessed or is costly.** Sign-in, sign-up, password
  reset, verification and one-time codes, invitations, and anything that sends
  email or messages or costs money, limited per account and per source address
  where possible, so guessing and flooding are slow and visible. Behind a
  proxy, make sure the limit counts each client, not the proxy.
- **Don't reveal who has an account.** Sign-in, sign-up and password reset
  answer the same way whether or not the account exists ("If that address has
  an account, we sent a link"), in about the same time.
- **Keep sessions safely.** Where sessions ride on cookies, make them
  `HttpOnly`, `Secure` in production and `SameSite` where the app allows it,
  and protect changing requests against cross-site request forgery. Issue a
  new session at sign-in, end it at sign-out, and expire it. Tokens and reset
  links are random, expire, work once where they should, and are compared in
  constant time.
- **Store passwords for the purpose.** A slow, salted password hash made for
  passwords; never a reversible form, and never in a log.

## Input

- **Validate at the boundary.** Check each input where it enters (type, size,
  range, allowed values) and refuse what does not fit rather than repairing it
  quietly, so the code behind can rely on what it gets.
- **Nothing reaches an interpreter unescaped.** Parameterized queries, argument
  lists instead of shell strings, the template engine's own escaping, and file
  paths resolved and checked to stay inside the directory they belong to.
  Markup a person writes is sanitized with an allow-list before anyone else
  sees it. A value used as a regular expression is escaped or bounded.
- **Uploads.** Check the type from the content as well as the name, cap the
  size before reading the whole body, store files under names the server
  chooses, outside anything served or run as code, and serve them so a browser
  downloads rather than runs them.
- **Cap the expensive.** Request bodies, page sizes, list lengths and costly
  operations have limits, so one request cannot exhaust memory, the database
  or a paid service.

## Secrets

- **None in code, the repository, logs, errors or client bundles.** Search
  source, configuration, fixtures, tests, the repository's history where
  possible, log output, error responses and the built client for keys,
  tokens, passwords and connection strings. Secrets come from the environment
  or a secret store when the software runs; the client gets only values meant
  to be public.
- **A committed secret is exposed.** Deleting it does not unexpose it: it must
  be replaced at its issuer, which usually only the person can do. Report it;
  never copy its value into the report, the chat or a test.
- **Logs leave secrets out.** Passwords, tokens, session ids and personal data
  a log has no need for stay out of logs and error reports.

## Production

- **Never development settings.** Production refuses to start without its
  required settings rather than falling back to a development default: a fixed
  secret, a debug mode, a local host, permissive cross-origin rules or a
  development login. Debug pages, test accounts and sample data are off.
- **The first visitor cannot take it over.** A new deployment gets its first
  administrator from a setup secret only its operator can read, an invitation
  or the deployment's owner, never from whoever signs up first.
- **Errors don't leak.** A failure tells the person what happened in their
  words and logs the details on the server; a response never carries a stack
  trace, a query, a file path or internal versions.
- **Headers fit the software.** A content security policy, transport security,
  no content-type sniffing and framing protection where it serves web pages,
  and cross-origin access only for the origins that need it.

## Dependencies and outbound calls

- **Known-vulnerable packages.** Run the ecosystem's dependency audit. Update a
  vulnerable package to a fixed version, within its declared range where
  possible, and report each one with no fix, saying whether the vulnerable part
  is reachable.
- **Outbound requests a person can aim.** Each request whose address user input
  chooses (a webhook URL, a link preview, an import from a URL, an image
  fetch) is checked against server-side request forgery: an allow-list where
  possible; otherwise refuse loopback, private, link-local and cloud metadata
  addresses after resolving the name and again on every redirect, and cap its
  time and size. A redirect whose target a person chooses is held to the
  software's own origins.

## Try each finding

Reading finds candidates; trying shows which are real. For each risk:

1. Send the input that should break it, against a local or test copy the run
   controls: a request without a session, as a caller without permission,
   with another tenant's id, past the rate limit, with a crafted path, a shell
   or query metacharacter, a script tag, a mistyped or oversized upload, a
   private address as a URL.
2. Record what happened. A finding is that request and the answer that should
   have been a refusal.
3. Fix it where the protection belongs (the shared policy, the query's scope,
   the framework's own protection) rather than in one route, so the next way
   in is protected too.
4. Send the same input again and see it refused, with the status and message
   the software uses for that refusal.
5. Lock it in with a test that sends that input and expects the refusal. Watch
   it fail once without the fix (undo the fix, run the test, restore it), so
   the test is known to guard it.

Also try the protections that already exist: send one input each declared
protection should refuse and see it refused. A protection that is declared but
never enforced is a finding.

## Boundaries

- **Never weaken a protection to make something pass.** Do not loosen a
  permission, rate limit, validation, content security policy, sandbox or
  header to make a test, build, deployment or feature work. When a protection
  blocks something the person needs, explain the conflict and let them decide.
- The pass changes how the software checks, refuses, escapes, stores secrets
  and runs in production. It adds no feature and does not change who the
  product means to allow to do what; when that intent is unclear (may a member
  see another member's records?), ask the person and keep the stricter
  behavior meanwhile.
- Attacks are tried only against copies the run controls: local servers, test
  databases and test accounts it creates. Never probe a production deployment,
  a real person's account or another party's service, and never send real
  email, messages or payments.
- **Report what it can't fix.** A secret to replace, a product decision, a
  hosting setting, a vulnerable dependency with no fix: each is reported with
  what it needs and who must act. When the framework itself blocks a fix,
  report the exact framework change instead of working around it in the app
  (**fix at the owner**).
- The selected Stack's security pass guidance names where its technology
  decides access, scopes rows, limits requests, keeps sessions and secrets and
  switches to production; follow it.
- You may edit source, configuration, messages and tests in scope; every
  existing behavior assertion stays. Update dependencies through the package
  manager. Do not edit `.genesis/`, Git metadata, dependency directories,
  generated build output, retained migration history, or external resources.

Leave the pass as ordinary uncommitted work for review and a later normal
commit. Never amend or rewrite selected commits. Summarize the resolved scope,
the map of ways in, each finding with the input that broke it and the refusal
seen after the fix, the test guarding each fix and its failing run without the
fix, the protections tried that already held, the areas that do not apply and
why, the dependency audit, files changed, checks actually run, and everything
left unfixed with what it needs and who must act.

When the prompt ends with a `PASS RECORD` step, take it once the pass has
finished: the Genesis `passes done security-pass` operation records it in `genesis/passes.json`,
an uncommitted change that lands in the pass's own commit. Genesis adds that
step only to the pass's own runs, whose requests it writes itself, so a security pass
of a section, commits or your own changes is never recorded as the pass;
neither is a pass that stopped early, was abandoned or still has failing
checks.

## Deep run

When the prompt has a `DEEP RUN` section, follow it: it says how the checklist,
evidence, chunks, commits and report work for every pass. This pass adds to the
checklist:

- every way in from the map (each route, page, command, action, handler,
  webhook, job, file read from outside and outbound call), every sign-in,
  session and token flow, and every secret;
- the cross-subsystem item: one resource guarded differently on different
  ways in, and a protection applied on some ways in but not on others.
